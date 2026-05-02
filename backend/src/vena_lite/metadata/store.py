"""SQLite metadata store. Holds audit log + dim hierarchy + driver definitions.

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
#  before_value_or_None, after_value, source, details_json_or_None)
AuditRow = tuple[str, str, str, str, str, str, str, str, str | None, str, str, str | None]

# (dim_name, member_id, parent_member_id_or_None, rollup_op, ordinal, display_name_or_None)
DimMemberRow = tuple[str, str, str | None, str, int, str | None]


class SQLiteMetadataStore:
    def __init__(self, path: str | Path) -> None:
        self._path = str(path)
        self._conn = sqlite3.connect(self._path, isolation_level=None, check_same_thread=False)
        self._conn.executescript(_SCHEMA_SQL)
        self._apply_migrations()

    def _apply_migrations(self) -> None:
        """Apply additive ALTER TABLE migrations for existing dbs.

        Fresh installs hit the CREATE TABLE statements which already include the
        new columns; existing dbs need ALTER TABLE. PRAGMA-introspect to make
        the operation idempotent.
        """
        if "display_name" not in self._table_columns("dim_member"):
            self._conn.execute("ALTER TABLE dim_member ADD COLUMN display_name TEXT")
        if "details" not in self._table_columns("audit_log"):
            self._conn.execute("ALTER TABLE audit_log ADD COLUMN details TEXT")

    def _table_columns(self, table: str) -> set[str]:
        # PRAGMA does not accept parameter binding; `table` comes only from internal callers.
        cur = self._conn.execute(f"PRAGMA table_info({table})")  # noqa: S608
        return {row[1] for row in cur.fetchall()}

    # --- audit log ---------------------------------------------------

    def append_audit_rows(self, rows: Iterable[AuditRow]) -> int:
        rows_list = list(rows)
        if not rows_list:
            return 0
        self._conn.executemany(
            """
            INSERT INTO audit_log
              (submit_request_id, who, account_id, entity_id, costcenter_id,
               period_id, scenario_id, version_id, before_value, after_value,
               source, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_list,
        )
        return len(rows_list)

    def last_audit_id(self) -> int:
        cur = self._conn.execute("SELECT last_insert_rowid()")
        return int(cur.fetchone()[0])

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

    # --- dim_member (Slice 4 + Slice 9) -------------------------------

    def bulk_insert_dim_members(self, rows: Iterable[DimMemberRow]) -> int:
        """Upsert dim members. Used by seeds and scenarios.copy auto-registration."""
        rows_list = list(rows)
        if not rows_list:
            return 0
        self._conn.executemany(
            """
            INSERT OR REPLACE INTO dim_member
              (dim_name, member_id, parent_member_id, rollup_op, ordinal, display_name)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows_list,
        )
        return len(rows_list)

    def insert_dim_member(self, row: DimMemberRow) -> None:
        """Strict insert (Slice 9). Raises sqlite3.IntegrityError on PK collision."""
        self._conn.execute(
            """
            INSERT INTO dim_member
              (dim_name, member_id, parent_member_id, rollup_op, ordinal, display_name)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            row,
        )

    def update_dim_member(
        self, dim: str, member: str, fields: dict[str, object]
    ) -> dict[str, tuple[object, object]]:
        """Update only the keys present in `fields`. Returns {field: (before, after)}
        for fields whose value actually changed.

        Recognized keys: 'display_name' (str | None — empty/None clears the alias)
        and 'ordinal' (int). Unknown keys are ignored.
        """
        current = self.fetch_dim_member(dim, member)
        if current is None:
            raise KeyError(f"dim_member not found: ({dim!r}, {member!r})")
        # current = (dim, member, parent, rollup_op, ordinal, display_name)
        before = {"display_name": current[5], "ordinal": current[4]}
        after = dict(before)
        changes: dict[str, tuple[object, object]] = {}

        if "display_name" in fields:
            v = fields["display_name"]
            normalized = v if v else None
            if normalized != before["display_name"]:
                changes["display_name"] = (before["display_name"], normalized)
                after["display_name"] = normalized
        if "ordinal" in fields:
            v = fields["ordinal"]
            if v != before["ordinal"]:
                changes["ordinal"] = (before["ordinal"], v)
                after["ordinal"] = v

        if changes:
            self._conn.execute(
                """
                UPDATE dim_member
                   SET display_name = ?, ordinal = ?
                 WHERE dim_name = ? AND member_id = ?
                """,
                (after["display_name"], after["ordinal"], dim, member),
            )
        return changes

    def delete_dim_members(self, dim: str, members: list[str]) -> int:
        if not members:
            return 0
        placeholders = ",".join("?" * len(members))
        cur = self._conn.execute(
            f"DELETE FROM dim_member WHERE dim_name = ? AND member_id IN ({placeholders})",  # noqa: S608
            (dim, *members),
        )
        return cur.rowcount

    def fetch_dim_members(self) -> list[DimMemberRow]:
        cur = self._conn.execute(
            "SELECT dim_name, member_id, parent_member_id, rollup_op, ordinal, display_name "
            "FROM dim_member ORDER BY dim_name, ordinal, member_id"
        )
        return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in cur.fetchall()]

    def fetch_dim_member(self, dim: str, member: str) -> DimMemberRow | None:
        cur = self._conn.execute(
            "SELECT dim_name, member_id, parent_member_id, rollup_op, ordinal, display_name "
            "FROM dim_member WHERE dim_name = ? AND member_id = ?",
            (dim, member),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return (row[0], row[1], row[2], row[3], row[4], row[5])

    def count_dim_members(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM dim_member").fetchone()[0])

    # --- driver (Slice 6 + Slice 9) ----------------------------------

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
        cur = self._conn.execute("SELECT account_id, formula FROM driver ORDER BY account_id")
        return [(r[0], r[1]) for r in cur.fetchall()]

    def fetch_driver(self, account_id: str) -> str | None:
        """Return the formula for `account_id`, or None if not defined."""
        cur = self._conn.execute("SELECT formula FROM driver WHERE account_id = ?", (account_id,))
        row = cur.fetchone()
        return None if row is None else row[0]

    def delete_driver(self, account_id: str) -> str | None:
        """Delete the driver row. Returns the previous formula or None if absent."""
        prior = self.fetch_driver(account_id)
        if prior is None:
            return None
        self._conn.execute("DELETE FROM driver WHERE account_id = ?", (account_id,))
        return prior

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
