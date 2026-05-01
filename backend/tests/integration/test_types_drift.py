"""Pydantic <-> TypeScript drift gate.

Regenerates `add-in/src/types/generated.ts` into a tmp location and compares
byte-for-byte with the committed file. Drift = test fails. The same check
runs in CI; this is the developer-side mirror.

Skipped automatically if `json2ts` isn't installed locally — the CI job has
its own enforcement, so a missing local toolchain doesn't break dev loops.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"
_GENERATOR = _BACKEND / "scripts" / "generate_ts_types.py"
_COMMITTED = _REPO_ROOT / "add-in" / "src" / "types" / "generated.ts"


def _json2ts_available() -> bool:
    # Honor whatever PATH the test env has; on Windows, ensure %APPDATA%\npm is searched.
    npm_global = Path(os.environ.get("APPDATA", "")) / "npm"
    extra = os.pathsep + str(npm_global) if npm_global.is_dir() else ""
    os.environ["PATH"] = os.environ.get("PATH", "") + extra
    return shutil.which("json2ts.cmd") is not None or shutil.which("json2ts") is not None


@pytest.mark.skipif(not _json2ts_available(), reason="json2ts CLI not installed locally")
def test_generated_ts_matches_committed(tmp_path: Path):
    """Run generator → tmp; diff against committed copy."""
    assert _GENERATOR.exists(), f"generator missing: {_GENERATOR}"
    assert _COMMITTED.exists(), (
        f"committed types file missing: {_COMMITTED}\n"
        f"Run `make types` (or python scripts/generate_ts_types.py) and commit the result."
    )

    # Run the generator with VENA_TS_OUTPUT redirected to tmp.
    # The script writes to a fixed path; we copy aside, regenerate, compare, restore.
    tmp_committed = tmp_path / "generated_baseline.ts"
    shutil.copy(_COMMITTED, tmp_committed)

    result = subprocess.run(
        [sys.executable, str(_GENERATOR)],
        cwd=_BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(
            f"generator exited {result.returncode}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )

    regenerated = _COMMITTED.read_text(encoding="utf-8")
    baseline = tmp_committed.read_text(encoding="utf-8")

    if regenerated != baseline:
        # Restore committed baseline before failing so we don't pollute the working tree.
        shutil.copy(tmp_committed, _COMMITTED)
        pytest.fail(
            "Pydantic <-> TypeScript drift detected.\n"
            "The committed add-in/src/types/generated.ts is out of date.\n"
            "Regenerate with `make types` (or python scripts/generate_ts_types.py) "
            "and commit the result."
        )
