"""CLI entry: `python -m vena_lite.cli {seed} ...`. Idempotent."""

from __future__ import annotations

import sys
from pathlib import Path

from vena_lite.config import metadata_path as default_metadata_path
from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.hierarchy_seed import hierarchy_seed
from vena_lite.metadata.store import SQLiteMetadataStore
from vena_lite.seed import iter_seed


def _cmd_seed(args: list[str]) -> int:
    if not args:
        print(
            "usage: python -m vena_lite.cli seed CUBE_PATH [METADATA_PATH]",
            file=sys.stderr,
        )
        return 2
    cube_path = Path(args[0])
    md_path = Path(args[1]) if len(args) > 1 else default_metadata_path()

    # Cube: skip if already seeded (so existing user edits aren't reset).
    cube_store = DuckDBCubeStore(cube_path)
    seed_count = int(
        cube_store._conn.execute(  # noqa: SLF001  (CLI-only access)
            "SELECT COUNT(*) FROM facts WHERE source = 'seed'"
        ).fetchone()[0]
    )
    if seed_count == 0:
        rows = list(iter_seed())
        cube_store.bulk_insert(rows, source="seed")
        print(f"seeded {len(rows)} facts -> {cube_path}")
    else:
        print(f"cube already has {seed_count} seed rows; skipping cube seed")
    cube_store.close()

    # Hierarchy: always upsert (INSERT OR REPLACE in dim_member is idempotent).
    md_store = SQLiteMetadataStore(md_path)
    hier_rows = hierarchy_seed()
    md_store.bulk_insert_dim_members(hier_rows)
    md_store.close()
    print(f"upserted {len(hier_rows)} dim_members -> {md_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: python -m vena_lite.cli {seed} ...", file=sys.stderr)
        return 2
    cmd, *rest = argv
    if cmd == "seed":
        return _cmd_seed(rest)
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
