"""Tokenizer + parser + AST evaluator for the driver formula language."""
from __future__ import annotations

from dataclasses import FrozenInstanceError
from decimal import Decimal

import pytest

from vena_lite.calc.parser import (
    BinOp,
    FormulaError,
    Ident,
    Number,
    UnaryOp,
    parse_formula,
    references_of,
    tokenize,
)

# --- tokenizer -------------------------------------------------------


def test_tokenize_simple_arithmetic():
    assert tokenize("1 + 2") == [("NUMBER", "1"), ("PLUS", "+"), ("NUMBER", "2")]


def test_tokenize_idents_and_decimals():
    toks = tokenize("4000_Revenue * 0.5")
    assert toks == [
        ("IDENT", "4000_Revenue"),
        ("MUL", "*"),
        ("NUMBER", "0.5"),
    ]


def test_tokenize_unknown_char_raises():
    with pytest.raises(FormulaError, match="Unexpected character"):
        tokenize("1 & 2")


# --- parser & evaluator ----------------------------------------------


def test_parse_number_literal():
    expr = parse_formula("42")
    assert isinstance(expr, Number)
    assert expr.value == Decimal("42")


def test_parse_addition():
    expr = parse_formula("1 + 2")
    assert isinstance(expr, BinOp)
    assert expr.evaluate({}) == Decimal("3")


def test_parse_precedence_mul_over_add():
    """1 + 2 * 3 == 7  (not 9)."""
    assert parse_formula("1 + 2 * 3").evaluate({}) == Decimal("7")


def test_parse_left_associativity():
    """1 - 2 - 3 == -4  (not 2)."""
    assert parse_formula("1 - 2 - 3").evaluate({}) == Decimal("-4")


def test_parens_override_precedence():
    assert parse_formula("(1 + 2) * 3").evaluate({}) == Decimal("9")


def test_unary_minus():
    assert parse_formula("-5").evaluate({}) == Decimal("-5")
    assert parse_formula("-5 + 10").evaluate({}) == Decimal("5")


def test_identifier_lookup_in_context():
    expr = parse_formula("Headcount * AvgSalary")
    assert isinstance(expr, BinOp)
    ctx = {"Headcount": Decimal("100"), "AvgSalary": Decimal("50000")}
    assert expr.evaluate(ctx) == Decimal("5000000")


def test_undefined_identifier_raises():
    expr = parse_formula("a + b")
    with pytest.raises(FormulaError, match="Undefined identifier"):
        expr.evaluate({"a": Decimal("1")})


def test_division_preserves_decimal_precision():
    # 1 / 4 = 0.25 exactly in Decimal
    assert parse_formula("1 / 4").evaluate({}) == Decimal("0.25")


def test_division_by_zero_raises():
    with pytest.raises(FormulaError, match="Division by zero"):
        parse_formula("1 / 0").evaluate({})


def test_complex_expression():
    """TotalComp = Headcount * AvgSalary * (1 + Benefits)"""
    expr = parse_formula("Headcount * AvgSalary * (1 + Benefits)")
    ctx = {
        "Headcount": Decimal("10"),
        "AvgSalary": Decimal("100000"),
        "Benefits": Decimal("0.30"),
    }
    assert expr.evaluate(ctx) == Decimal("1300000.00")


def test_empty_formula_raises():
    with pytest.raises(FormulaError, match="Empty formula"):
        parse_formula("")


def test_unbalanced_parens_raises():
    with pytest.raises(FormulaError, match=r"Expected '\)'"):
        parse_formula("(1 + 2")


def test_trailing_token_raises():
    with pytest.raises(FormulaError, match="Unexpected token at position"):
        parse_formula("1 + 2 3")


def test_references_of_collects_all_idents():
    refs = set(references_of("a + b * (c - a) / d"))
    assert refs == {"a", "b", "c", "d"}


def test_references_excludes_numbers():
    assert set(references_of("1.5 * 2 + 3")) == set()


def test_unary_does_not_create_phantom_reference():
    assert set(references_of("-x")) == {"x"}


def test_ast_node_dataclasses_are_immutable():
    n = Number(Decimal("1"))
    with pytest.raises(FrozenInstanceError):
        n.value = Decimal("2")  # type: ignore[misc]
    i = Ident("x")
    with pytest.raises(FrozenInstanceError):
        i.name = "y"  # type: ignore[misc]
    u = UnaryOp("MINUS", n)
    with pytest.raises(FrozenInstanceError):
        u.operand = i  # type: ignore[misc]
