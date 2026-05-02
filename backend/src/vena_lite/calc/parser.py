"""Tiny formula language for driver definitions (Slice 6).

Grammar:
  expr   := term ((PLUS | MINUS) term)*
  term   := factor ((MUL | DIV) factor)*
  factor := NUMBER | IDENT | LPAREN expr RPAREN | (PLUS | MINUS) factor

No eval, no functions, no string literals. Identifiers are account ids.
Decimal literals support `123` and `123.456`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal


class FormulaError(ValueError):
    """Tokenize, parse, or evaluation failure."""


# --- tokenizer -------------------------------------------------------

# IDENT must come BEFORE NUMBER so that account ids like `4000_Revenue` (which
# start with digits but contain an underscore + alpha) are not split into a
# NUMBER and a partial IDENT. The IDENT pattern requires at least one non-digit
# character, so pure numeric literals still fall through to NUMBER.
_TOKEN_PATTERNS: list[tuple[str, str]] = [
    ("IDENT", r"[A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*"),
    ("NUMBER", r"\d+(?:\.\d+)?"),
    ("PLUS", r"\+"),
    ("MINUS", r"-"),
    ("MUL", r"\*"),
    ("DIV", r"/"),
    ("LPAREN", r"\("),
    ("RPAREN", r"\)"),
]
_TOKEN_RE = re.compile("|".join(f"(?P<{n}>{p})" for n, p in _TOKEN_PATTERNS))


Token = tuple[str, str]


def tokenize(s: str) -> list[Token]:
    tokens: list[Token] = []
    pos = 0
    while pos < len(s):
        if s[pos].isspace():
            pos += 1
            continue
        m = _TOKEN_RE.match(s, pos)
        if not m:
            raise FormulaError(f"Unexpected character at position {pos}: {s[pos]!r}")
        for typ, _ in _TOKEN_PATTERNS:
            v = m.group(typ)
            if v is not None:
                tokens.append((typ, v))
                break
        pos = m.end()
    return tokens


# --- AST -------------------------------------------------------------


@dataclass(frozen=True)
class Number:
    value: Decimal

    def evaluate(self, ctx: Mapping[str, Decimal]) -> Decimal:
        return self.value

    def references(self) -> set[str]:
        return set()


@dataclass(frozen=True)
class Ident:
    name: str

    def evaluate(self, ctx: Mapping[str, Decimal]) -> Decimal:
        if self.name not in ctx:
            raise FormulaError(f"Undefined identifier in context: {self.name!r}")
        return ctx[self.name]

    def references(self) -> set[str]:
        return {self.name}


@dataclass(frozen=True)
class BinOp:
    op: str  # 'PLUS' | 'MINUS' | 'MUL' | 'DIV'
    left: Expr
    right: Expr

    def evaluate(self, ctx: Mapping[str, Decimal]) -> Decimal:
        lhs = self.left.evaluate(ctx)
        rhs = self.right.evaluate(ctx)
        if self.op == "PLUS":
            return lhs + rhs
        if self.op == "MINUS":
            return lhs - rhs
        if self.op == "MUL":
            return lhs * rhs
        if self.op == "DIV":
            if rhs == 0:
                raise FormulaError("Division by zero in driver formula")
            return lhs / rhs
        raise FormulaError(f"Unknown binary op: {self.op}")

    def references(self) -> set[str]:
        return self.left.references() | self.right.references()


@dataclass(frozen=True)
class UnaryOp:
    op: str  # 'PLUS' | 'MINUS'
    operand: Expr

    def evaluate(self, ctx: Mapping[str, Decimal]) -> Decimal:
        v = self.operand.evaluate(ctx)
        return -v if self.op == "MINUS" else v

    def references(self) -> set[str]:
        return self.operand.references()


Expr = Number | Ident | BinOp | UnaryOp


# --- parser ----------------------------------------------------------


class _Parser:
    def __init__(self, tokens: list[Token]) -> None:
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> Token | None:
        return self._tokens[self._pos] if self._pos < len(self._tokens) else None

    def _peek_type(self) -> str | None:
        tok = self._peek()
        return tok[0] if tok else None

    def _advance(self) -> Token:
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok

    def parse(self) -> Expr:
        if not self._tokens:
            raise FormulaError("Empty formula")
        e = self._expr()
        if self._pos != len(self._tokens):
            raise FormulaError(f"Unexpected token at position {self._pos}: {self._peek()}")
        return e

    def _expr(self) -> Expr:
        left = self._term()
        while self._peek_type() in ("PLUS", "MINUS"):
            op = self._advance()[0]
            right = self._term()
            left = BinOp(op, left, right)
        return left

    def _term(self) -> Expr:
        left = self._factor()
        while self._peek_type() in ("MUL", "DIV"):
            op = self._advance()[0]
            right = self._factor()
            left = BinOp(op, left, right)
        return left

    def _factor(self) -> Expr:
        tok = self._peek()
        if tok is None:
            raise FormulaError("Unexpected end of formula")
        typ, val = tok
        if typ == "NUMBER":
            self._advance()
            return Number(Decimal(val))
        if typ == "IDENT":
            self._advance()
            return Ident(val)
        if typ == "LPAREN":
            self._advance()
            inner = self._expr()
            if self._peek_type() != "RPAREN":
                raise FormulaError(f"Expected ')' at position {self._pos}")
            self._advance()
            return inner
        if typ in ("PLUS", "MINUS"):
            self._advance()
            return UnaryOp(typ, self._factor())
        raise FormulaError(f"Unexpected token: {tok}")


def parse_formula(s: str) -> Expr:
    return _Parser(tokenize(s)).parse()


def references_of(formula: str) -> Iterable[str]:
    return parse_formula(formula).references()
