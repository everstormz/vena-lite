"""CalcEngine: cycle detection + affected-in-topo-order."""

from __future__ import annotations

from vena_lite.calc.engine import CalcEngine, CycleError, Driver
from vena_lite.calc.parser import parse_formula


def _drv(account: str, formula: str) -> Driver:
    return Driver(account, formula, parse_formula(formula))


# --- would_cycle -----------------------------------------------------


def test_would_cycle_self_reference():
    e = CalcEngine([])
    assert e.would_cycle("OpEx", {"OpEx"})


def test_would_cycle_no_existing_drivers():
    e = CalcEngine([])
    assert not e.would_cycle("OpEx", {"Revenue"})


def test_would_cycle_indirect():
    """A = B; defining B = A is a cycle."""
    e = CalcEngine([_drv("A", "B")])
    assert e.would_cycle("B", {"A"})


def test_would_cycle_two_hops():
    """A = B; B = C; defining C = A is a cycle."""
    e = CalcEngine([_drv("A", "B"), _drv("B", "C")])
    assert e.would_cycle("C", {"A"})


def test_would_cycle_diamond_no_cycle():
    """A = B + C, both leaves. New driver D = A is fine."""
    e = CalcEngine([_drv("A", "B + C")])
    assert not e.would_cycle("D", {"A"})


def test_redefine_existing_driver_with_new_refs_is_fine():
    """Redefining the SAME account is allowed if the new refs don't cycle back."""
    e = CalcEngine([_drv("A", "B")])
    assert not e.would_cycle("A", {"C"})


# --- affected_in_topo_order ------------------------------------------


def test_affected_empty_when_no_drivers_consume_changed():
    e = CalcEngine([_drv("A", "B")])
    assert e.affected_in_topo_order({"X"}) == []


def test_affected_single_driver_direct():
    e = CalcEngine([_drv("OpEx", "Revenue * 0.5")])
    assert e.affected_in_topo_order({"Revenue"}) == ["OpEx"]


def test_affected_transitive_chain():
    """A = B; X = A.  Changing B affects A then X."""
    e = CalcEngine([_drv("A", "B"), _drv("X", "A")])
    assert e.affected_in_topo_order({"B"}) == ["A", "X"]


def test_affected_topo_inputs_before_outputs():
    """X = A + B; A = C.  Changing C must yield [A, X], never [X, A]."""
    e = CalcEngine([_drv("X", "A + B"), _drv("A", "C")])
    assert e.affected_in_topo_order({"C"}) == ["A", "X"]


def test_affected_two_drivers_share_input_no_dependency_between_them():
    e = CalcEngine([_drv("A", "X"), _drv("B", "X")])
    out = e.affected_in_topo_order({"X"})
    assert sorted(out) == ["A", "B"]
    # A and B don't depend on each other, so any order is valid; we sort for
    # deterministic output.
    assert out == ["A", "B"]


def test_affected_changed_driver_account_propagates():
    """Changing a driver's OUTPUT (e.g., its formula was redefined) means we
    treat it as a changed input for downstream drivers."""
    e = CalcEngine([_drv("A", "B"), _drv("X", "A")])
    assert e.affected_in_topo_order({"A"}) == ["X"]


# --- has_driver / from_store / accounts -----------------------------


def test_has_driver_and_get():
    e = CalcEngine([_drv("OpEx", "Revenue * 0.5")])
    assert e.has_driver("OpEx")
    assert not e.has_driver("Revenue")
    assert e.get("OpEx").references() == {"Revenue"}


def test_all_driver_accounts():
    e = CalcEngine([_drv("A", "B"), _drv("C", "D")])
    assert sorted(e.all_driver_accounts()) == ["A", "C"]


def test_topo_sort_raises_on_cycle_in_existing_graph():
    """Pathological case: bad data already in the store. affected_in_topo_order
    must surface this rather than loop infinitely."""
    # We can't actually construct a CalcEngine with a cycle through the public
    # API (would_cycle blocks it), so we craft one by hand.
    a = Driver("A", "B", parse_formula("B"))
    b = Driver("B", "A", parse_formula("A"))
    e = CalcEngine([a, b])
    try:
        e.affected_in_topo_order({"A"})
    except CycleError:
        pass
    else:
        raise AssertionError("expected CycleError")
