"""FastAPI dependency providers.

`get_cube` / `get_metadata` are process-wide singletons. `get_dim_model` and
`get_calc_engine` reload on every request because Slice 5 (`/scenarios/copy`)
and Slice 6 (`/drivers/define`) mutate that state at runtime.

Both reload-on-call providers take their store via `Depends(get_metadata)` so
test overrides on `get_metadata` cascade through naturally — without that, a
test that swaps the metadata store would still get a CalcEngine / DimModel
loaded from the global singleton.
"""
from __future__ import annotations

from fastapi import Depends

from ..calc.engine import CalcEngine
from ..config import cube_path, metadata_path
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import SQLiteMetadataStore

_cube: DuckDBCubeStore | None = None
_metadata: SQLiteMetadataStore | None = None


def get_cube() -> DuckDBCubeStore:
    global _cube
    if _cube is None:
        _cube = DuckDBCubeStore(cube_path())
    return _cube


def get_metadata() -> SQLiteMetadataStore:
    global _metadata
    if _metadata is None:
        _metadata = SQLiteMetadataStore(metadata_path())
    return _metadata


def get_dim_model(
    metadata: SQLiteMetadataStore = Depends(get_metadata),
) -> DimModel:
    return DimModel.from_store(metadata)


def get_calc_engine(
    metadata: SQLiteMetadataStore = Depends(get_metadata),
) -> CalcEngine:
    return CalcEngine.from_store(metadata)
