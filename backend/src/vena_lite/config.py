"""Application configuration. v1: env var overrides for the cube + metadata files."""

from __future__ import annotations

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]


def cube_path() -> Path:
    """Filesystem path to the DuckDB cube file. Override via VENA_CUBE_PATH."""
    env = os.environ.get("VENA_CUBE_PATH")
    return Path(env) if env else _REPO_ROOT / "cube.duckdb"


def metadata_path() -> Path:
    """Filesystem path to the SQLite metadata DB (audit log + future hierarchies).
    Override via VENA_METADATA_PATH.
    """
    env = os.environ.get("VENA_METADATA_PATH")
    return Path(env) if env else _REPO_ROOT / "metadata.sqlite"
