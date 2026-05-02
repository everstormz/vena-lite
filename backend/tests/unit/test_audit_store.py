"""SQLite audit store: row insertion, transaction commit/rollback, decimal-as-text."""

from __future__ import annotations

import sqlite3

import pytest

from vena_lite.metadata.store import SQLiteMetadataStore


def _row(req: str = "req-1", before: str | None = "100.000000", after: str = "200.000000") -> tuple:
    return (
        req,
        "local",
        "4000_Revenue",
        "E001_US",
        "CC100_Sales",
        "2026-01",
        "Actual",
        "v1",
        before,
        after,
        "submit",
        None,
    )


def test_append_one_row_returns_count(metadata_store: SQLiteMetadataStore):
    n = metadata_store.append_audit_rows([_row()])
    assert n == 1
    assert metadata_store.count_rows_for_request("req-1") == 1


def test_append_multiple_rows_count_matches(metadata_store: SQLiteMetadataStore):
    rows = [_row(req="req-A"), _row(req="req-A"), _row(req="req-A")]
    n = metadata_store.append_audit_rows(rows)
    assert n == 3
    assert metadata_store.count_rows_for_request("req-A") == 3


def test_append_empty_iterable_is_noop(metadata_store: SQLiteMetadataStore):
    assert metadata_store.append_audit_rows([]) == 0
    assert metadata_store.count_rows_for_request("anything") == 0


def test_decimal_text_round_trip_preserves_precision(metadata_store: SQLiteMetadataStore):
    metadata_store.append_audit_rows([_row(before="123.456789", after="987.654321")])
    rows = metadata_store.fetch_rows_for_request("req-1")
    assert len(rows) == 1
    assert rows[0]["before_value"] == "123.456789"
    assert rows[0]["after_value"] == "987.654321"


def test_null_before_value_supported(metadata_store: SQLiteMetadataStore):
    metadata_store.append_audit_rows([_row(before=None, after="1.000000")])
    rows = metadata_store.fetch_rows_for_request("req-1")
    assert rows[0]["before_value"] is None


def test_transaction_commits_on_success(metadata_store: SQLiteMetadataStore):
    with metadata_store.transaction():
        metadata_store.append_audit_rows([_row(req="tx-ok")])
    assert metadata_store.count_rows_for_request("tx-ok") == 1


def test_transaction_rolls_back_on_exception(metadata_store: SQLiteMetadataStore):
    class BoomError(Exception):
        pass

    with pytest.raises(BoomError):
        with metadata_store.transaction():
            metadata_store.append_audit_rows([_row(req="tx-rollback")])
            raise BoomError()

    assert metadata_store.count_rows_for_request("tx-rollback") == 0


def test_audit_row_with_details_round_trip(metadata_store: SQLiteMetadataStore):
    """Slice 9: details column carries kind-specific JSON."""
    row = (
        "dim-r1",
        "local",
        "account",
        "4000_Revenue",
        "",
        "",
        "",
        "",
        None,
        "Marketing",
        "dim_change",
        '{"field":"create"}',
    )
    metadata_store.append_audit_rows([row])
    rows = metadata_store.fetch_rows_for_request("dim-r1")
    assert rows[0]["source"] == "dim_change"
    assert rows[0]["details"] == '{"field":"create"}'


def test_audit_row_tuple_len_is_12(metadata_store: SQLiteMetadataStore):
    """Pin the row shape so an accidental 11-tuple call site fails loudly."""
    eleven_tuple = ("req", "local", "a", "e", "c", "p", "s", "v", None, "1", "submit")
    with pytest.raises((TypeError, sqlite3.ProgrammingError)):
        metadata_store.append_audit_rows([eleven_tuple])  # type: ignore[arg-type]


def test_audit_table_persists_to_file(metadata_path):
    """Open a fresh connection on the same file — rows must survive."""
    store1 = SQLiteMetadataStore(metadata_path)
    store1.append_audit_rows([_row(req="persist-1")])
    store1.close()

    raw = sqlite3.connect(str(metadata_path))
    cur = raw.execute("SELECT submit_request_id FROM audit_log")
    requests = [r[0] for r in cur.fetchall()]
    raw.close()
    assert "persist-1" in requests
