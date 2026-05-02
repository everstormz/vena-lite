"""CalcEngine: driver registry + cycle detection + topo-sorted recompute order.

Pure: no I/O at this layer. The /submit and /drivers endpoints orchestrate
cube/audit writes around what the engine returns.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..metadata.store import SQLiteMetadataStore
from .parser import Expr, FormulaError, parse_formula


class CycleError(FormulaError):
    """Defining the new driver would create a dependency cycle."""


@dataclass(frozen=True)
class Driver:
    account: str
    formula: str
    ast: Expr

    def references(self) -> set[str]:
        return self.ast.references()


class CalcEngine:
    def __init__(self, drivers: list[Driver]) -> None:
        self._drivers: dict[str, Driver] = {d.account: d for d in drivers}

    @classmethod
    def from_store(cls, store: SQLiteMetadataStore) -> CalcEngine:
        rows = store.fetch_drivers()
        return cls([Driver(a, f, parse_formula(f)) for a, f in rows])

    def has_driver(self, account: str) -> bool:
        return account in self._drivers

    def get(self, account: str) -> Driver:
        return self._drivers[account]

    def all_driver_accounts(self) -> list[str]:
        return list(self._drivers)

    def would_cycle(self, new_account: str, new_refs: set[str]) -> bool:
        """True if defining `new_account` with the given references would create
        a cycle in the dependency graph (existing drivers + this new one).
        """
        # Walk the transitive closure of new_refs through existing drivers.
        # If we ever hit `new_account`, we have a cycle.
        if new_account in new_refs:
            return True
        visited: set[str] = set()
        stack: list[str] = list(new_refs)
        while stack:
            cur = stack.pop()
            if cur == new_account:
                return True
            if cur in visited:
                continue
            visited.add(cur)
            existing = self._drivers.get(cur)
            if existing is not None:
                stack.extend(existing.references())
        return False

    def affected_in_topo_order(self, changed_accounts: set[str]) -> list[str]:
        """Driver accounts whose value depends (directly or transitively) on
        any account in `changed_accounts`, in dependency order — inputs before
        outputs — so a single pass suffices to recompute correctly.
        """
        # 1. Collect transitively-affected drivers.
        affected: set[str] = set()
        frontier: list[str] = list(changed_accounts)
        while frontier:
            cur = frontier.pop()
            for d_acc, drv in self._drivers.items():
                if cur in drv.references() and d_acc not in affected:
                    affected.add(d_acc)
                    frontier.append(d_acc)

        # 2. Topological sort restricted to `affected`.
        in_degree: dict[str, int] = {a: 0 for a in affected}
        for a in affected:
            for ref in self._drivers[a].references():
                if ref in affected:
                    in_degree[a] += 1

        ready = sorted(a for a, d in in_degree.items() if d == 0)
        out: list[str] = []
        while ready:
            cur = ready.pop(0)
            out.append(cur)
            for other in sorted(affected):
                if cur in self._drivers[other].references():
                    in_degree[other] -= 1
                    if in_degree[other] == 0:
                        ready.append(other)
            ready.sort()

        if len(out) != len(affected):
            # Shouldn't happen — would_cycle blocks cycle creation at definition.
            raise CycleError("Cycle detected in driver dependency graph")
        return out
