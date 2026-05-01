"""SQLite metadata store. Holds audit log + dim hierarchy.

Decimals in `audit_log` are stored as TEXT (SQLite REAL is lossy IEEE-754).
All callers must pre-stringify via `format(d, 'f')`.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path

_SCHEMA_SQL = (Path(__file__).parent / "schema.sql").read_text()

# (submit_request_id, who, account, entity, costcenter, period, scenario, version,
#  before_value_or_None, after_value, source)
AuditRow = tuple[str, str, str, str, str, str, str, str, str | None, str, str]

# (dim_name, member_id, parent_member_id_or_None, rollup_op, ordinal)
DimMemberRow = tuple[str, str, str | None, str, int]


class SQLiteMetadataStore:
    def __init__(self, path: str | Path) -> None:
        self._path = str(path)
        self._conn = sqlite3.connect(
            self._path, isolation_level=None, check_same_thread=False
        )
        self._conn.executescript(_SCHEMA_SQL)

    # --- audit log ---------------------------------------------------

    def append_audit_rows(self, rows: Iterable[AuditRow]) -> int:
        rows_list = list(rows)
        if not rows_list:
            return 0
        self._conn.executemany(
            """
            INSERT INTO audit_log
              (submit_request_id, who, account_id, entity_id, costcenter_id,
               period_id, scenario_id, version_id, before_value, after_value, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_list,
        )
        return len(rows_list)

    def count_rows_for_request(self, submit_request_id: str) -> int:
        cur = self._conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE submit_request_id = ?",
            (submit_request_id,),
        )
        return int(cur.fetchone()[0])

    def fetch_rows_for_request(self, submit_request_id: str) -> list[sqlite3.Row]:
        self._conn.row_factory = sqlite3.Row
        try:
            cur = self._conn.execute(
                "SELECT * FROM audit_log WHERE submit_request_id = ? ORDER BY id",
                (submit_request_id,),
            )
            return cur.fetchall()
        finally:
            self._conn.row_factory = None

    # --- dim_member (Slice 4) ----------------------------------------

    def bulk_insert_dim_members(self, rows: Iterable[DimMemberRow]) -> int:
        rows_list = list(rows)
        if not rows_list:
            return 0
        self._conn.executemany(
            """
            INSERT OR REPLACE INTO dim_member
              (dim_name, member_id, parent_member_id, rollup_op, ordinal)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows_list,
        )
        return len(rows_list)

    def fetch_dim_members(self) -> list[DimMemberRow]:
        cur = self._conn.execute(
            "SELECT dim_name, member_id, parent_member_id, rollup_op, ordinal "
            "FROM dim_member ORDER BY dim_name, ordinal, member_id"
        )
        return [(r[0], r[1], r[2], r[3], r[4]) for r in cur.fetchall()]

    def count_dim_members(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM dim_member").fetchone()[0])

    # --- driver (Slice 6) --------------------------------------------

    def upsert_driver(self, account_id: str, formula: str) -> None:
        self._conn.execute(
            """
            INSERT INTO driver (account_id, formula)
            VALUES (?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
              formula = excluded.formula,
              defined_at = CURRENT_TIMESTAMP
            """,
            (account_id, formula),
        )

    def fetch_drivers(self) -> list[tuple[str, str]]:
        cur = self._conn.execute(
            "SELECT account_id, formula FROM driver ORDER BY account_id"
        )
        return [(r[0], r[1]) for r in cur.fetchall()]

    # --- transactions ------------------------------------------------

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
