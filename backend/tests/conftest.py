"""Shared pytest fixtures. Each test gets fresh DuckDB + SQLite files under tmp_path."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.hierarchy_seed import hierarchy_seed
from vena_lite.metadata.dim_model import DimModel
from vena_lite.metadata.store import SQLiteMetadataStore
from vena_lite.seed import iter_seed


@pytest.fixture
def cube_path(tmp_path: Path) -> Path:
    return tmp_path / "cube.duckdb"


@pytest.fixture
def metadata_path(tmp_path: Path) -> Path:
    return tmp_path / "metadata.sqlite"


@pytest.fixture
def empty_store(cube_path: Path) -> Iterator[DuckDBCubeStore]:
    store = DuckDBCubeStore(cube_path)
    try:
        yield store
    finally:
        store.close()


@pytest.fixture
def seeded_store(cube_path: Path) -> Iterator[DuckDBCubeStore]:
    store = DuckDBCubeStore(cube_path)
    store.bulk_insert(iter_seed(), source="seed")
    try:
        yield store
    finally:
        store.close()


@pytest.fixture
def metadata_store(metadata_path: Path) -> Iterator[SQLiteMetadataStore]:
    store = SQLiteMetadataStore(metadata_path)
    try:
        yield store
    finally:
        store.close()


@pytest.fixture
def hierarchy_seeded_metadata(metadata_path: Path) -> Iterator[SQLiteMetadataStore]:
    store = SQLiteMetadataStore(metadata_path)
    store.bulk_insert_dim_members(hierarchy_seed())
    try:
        yield store
    finally:
        store.close()


@pytest.fixture
def dim_model() -> DimModel:
    """Hierarchy built directly from `hierarchy_seed()` — bypasses SQLite for speed."""
    rows = [(d, m, p, op, ord_) for d, m, p, op, ord_ in hierarchy_seed()]
    return DimModel(rows)
