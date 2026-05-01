"""In-memory dimension hierarchy. Built from `dim_member` rows; queried by the
slice/submit endpoints to validate members and expand parents to leaves.

v1 only honors `rollup_op='sum'` — other operators are stored but ignored.
"""
from __future__ import annotations

from .store import DimMemberRow, SQLiteMetadataStore


class DimModel:
    """A snapshot of the hierarchy. Cheap to rebuild; not thread-mutated."""

    def __init__(self, rows: list[DimMemberRow]) -> None:
        self._members: dict[tuple[str, str], dict] = {}
        self._children: dict[tuple[str, str], list[str]] = {}

        for dim_name, member_id, parent_id, rollup_op, ordinal in rows:
            self._members[(dim_name, member_id)] = {
                "parent": parent_id,
                "rollup_op": rollup_op,
                "ordinal": ordinal,
            }
        # Build children index in a second pass so we don't depend on row order.
        for (dim_name, member_id), rec in self._members.items():
            parent = rec["parent"]
            if parent is not None:
                self._children.setdefault((dim_name, parent), []).append(member_id)

    @classmethod
    def from_store(cls, store: SQLiteMetadataStore) -> DimModel:
        return cls(store.fetch_dim_members())

    def is_known(self, dim: str, member: str) -> bool:
        return (dim, member) in self._members

    def is_leaf(self, dim: str, member: str) -> bool:
        return (dim, member) in self._members and (dim, member) not in self._children

    def get_leaves(self, dim: str, member: str) -> list[str]:
        """All leaf descendants of `member` (or `member` itself if it's a leaf).
        Returns [] if the member is unknown."""
        if not self.is_known(dim, member):
            return []
        if self.is_leaf(dim, member):
            return [member]
        out: list[str] = []
        # Iterative DFS — keeps stack small even for deep hierarchies, and avoids
        # Python's recursion limit blowing up on a pathological seed.
        stack: list[str] = [member]
        seen: set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            kids = self._children.get((dim, cur))
            if kids is None:
                # leaf
                if cur != member:  # don't include the parent itself
                    out.append(cur)
            else:
                stack.extend(kids)
        return out

    def all_leaves(self, dim: str) -> list[str]:
        return [m for (d, m) in self._members if d == dim and self.is_leaf(d, m)]

    def all_members(self, dim: str) -> list[str]:
        return [m for (d, m) in self._members if d == dim]
