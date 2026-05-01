"""DuckDB-backed cube store. Append-only writes; reads always go through `facts_current`.

DuckDB single-writer constraint: one writer per database file at a time. For
v1 the FastAPI process holds a single shared connection. The `transaction()`
context manager wraps an explicit BEGIN/COMMIT so submit batches are atomic
on the cube side; coordinated commit with the SQLite audit store happens at
the API layer.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

import duckdb

from ..schemas.dimensions import DIM_NAMES, DimFilter, DimName
from ..schemas.slice import FactRow

_SCHEMA_SQL = (Path(__file__).parent / "schema.sql").read_text()

_COLUMN_BY_DIM: dict[DimName, str] = {
    "account": "account_id",
    "entity": "entity_id",
    "costcenter": "costcenter_id",
    "period": "period_id",
    "scenario": "scenario_id",
    "version": "version_id",
}

# (account, entity, costcenter, period, scenario, version)
IntersectionKey = tuple[str, str, str, str, str, str]


class DuckDBCubeStore:
    """Open or create a cube file at `path`. Schema migration is idempotent."""

    def __init__(self, path: str | Path) -> None:
        self._path = str(path)
        self._conn = duckdb.connect(self._path)
        self._conn.execute(_SCHEMA_SQL)

    def bulk_insert(
        self,
        rows: Iterable[tuple[str, str, str, str, str, str, object]],
        source: str = "manual",
    ) -> None:
        """Append rows to `facts`. Each row: (account, entity, costcenter, period,
        scenario, version, value). `loaded_at` defaults to NOW().
        """
        rows_list = [(*r, source) for r in rows]
        if not rows_list:
            return
        self._conn.executemany(
            """
            INSERT INTO facts (account_id, entity_id, costcenter_id, period_id,
                               scenario_id, version_id, value, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_list,
        )

    def slice(self, filters: dict[DimName, DimFilter]) -> list[FactRow]:
        """Return facts matching the filter set. `members=None` for a dim = no filter.

        Reads from `facts_current` (the dedupe view), never raw `facts`. All filter
        values are bound as parameters — never string-concatenated into SQL.
        """
        select_cols = [_COLUMN_BY_DIM[d] for d in DIM_NAMES] + ["value"]
        where_clauses: list[str] = []
        params: list[object] = []
        for dim, f in filters.items():
            if f.members is None:
                continue
            if not f.members:
                # Empty list = filter that matches nothing.
                return []
            col = _COLUMN_BY_DIM[dim]
            placeholders = ", ".join(["?"] * len(f.members))
            where_clauses.append(f"{col} IN ({placeholders})")
            params.extend(f.members)

        sql = f"SELECT {', '.join(select_cols)} FROM facts_current"
        if where_clauses:
            sql += " WHERE " + " AND ".join(where_clauses)
        sql += " ORDER BY " + ", ".join(_COLUMN_BY_DIM[d] for d in DIM_NAMES)

        rows = self._conn.execute(sql, params).fetchall()
        return [
            FactRow(
                account=r[0],
                entity=r[1],
                costcenter=r[2],
                period=r[3],
                scenario=r[4],
                version=r[5],
                value=r[6],  # DuckDB DECIMAL → Python Decimal
            )
            for r in rows
        ]

    def lookup_current_values(
        self, intersections: list[IntersectionKey]
    ) -> dict[IntersectionKey, Decimal | None]:
        """Return current value (latest loaded_at) for each intersection, or None
        if no row exists. Used to populate audit_log.before_value.
        """
        if not intersections:
            return {}

        # OR-of-AND tuple match. DuckDB supports the row-tuple IN (VALUES ...) form,
        # but escaping the VALUES clause robustly is fiddly across versions; an OR
        # chain over executemany-friendly placeholders is more portable.
        clause = " OR ".join(
            ["(account_id=? AND entity_id=? AND costcenter_id=? "
             "AND period_id=? AND scenario_id=? AND version_id=?)"]
            * len(intersections)
        )
        params: list[object] = [item for tpl in intersections for item in tpl]
        sql = (
            "SELECT account_id, entity_id, costcenter_id, period_id, scenario_id, "
            f"version_id, value FROM facts_current WHERE {clause}"
        )
        rows = self._conn.execute(sql, params).fetchall()
        found: dict[IntersectionKey, Decimal] = {tuple(r[:6]): r[6] for r in rows}  # type: ignore[misc]
        return {tpl: found.get(tpl) for tpl in intersections}

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self._conn.execute("BEGIN")
        try:
            yield
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        else:
            self._conn.execute("COMMIT")

    def close(self) -> None:
        self._conn.close()
