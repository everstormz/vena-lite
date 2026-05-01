# Vena-lite task runner (Windows-native equivalent of Makefile).
# Usage: .\tasks.ps1 <task>
param([Parameter(Position=0)] [string]$Task = "help")

# winget doesn't propagate PATH to existing shells; refresh from registry.
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

$Backend = Join-Path $PSScriptRoot "backend"
$CubePath = Join-Path $PSScriptRoot "cube.duckdb"

function Run-Backend([scriptblock]$cmd) {
    Push-Location $Backend
    try { & $cmd } finally { Pop-Location }
}

switch ($Task) {
    "dev"   { Run-Backend { uv run uvicorn vena_lite.main:app --reload --host 127.0.0.1 --port 8000 } }
    "test"  { Run-Backend { uv run pytest } }
    "test-cov" { Run-Backend { uv run pytest --cov=vena_lite --cov-report=term-missing } }
    "types" { Run-Backend { uv run python scripts/generate_ts_types.py } }
    "seed"  { if (Test-Path $CubePath) { Remove-Item $CubePath }; Run-Backend { uv run python -m vena_lite.cli seed $CubePath } }
    "lint"  { Run-Backend { uv run ruff check . } }
    "fmt"   { Run-Backend { uv run ruff format . } }
    "clean" { if (Test-Path $CubePath) { Remove-Item $CubePath } }
    "help"  { Write-Output "Tasks: dev | test | test-cov | types | seed | lint | fmt | clean" }
    default { Write-Error "Unknown task: $Task. Run '.\tasks.ps1 help'."; exit 2 }
}
