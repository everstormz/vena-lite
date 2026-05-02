"""Slice 1 seed data: 96 hardcoded facts (2*2*2*12*1*1).

Lives in production code (not tests) because the `seed` CLI command imports it
to bootstrap a demo cube.
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

ACCOUNTS = ["4000_Revenue", "5000_OpEx"]
ENTITIES = ["E001_US", "E002_UK"]
COSTCENTERS = ["CC100_Sales", "CC200_Eng"]
PERIODS = [f"2026-{m:02d}" for m in range(1, 13)]
SCENARIOS = ["Actual"]
VERSIONS = ["v1"]

EXPECTED_FACT_COUNT = (
    len(ACCOUNTS) * len(ENTITIES) * len(COSTCENTERS) * len(PERIODS) * len(SCENARIOS) * len(VERSIONS)
)
assert EXPECTED_FACT_COUNT == 96


def deterministic_value(account: str, entity: str, costcenter: str, period: str) -> Decimal:
    """Per-cell value derived from indices so tests can assert exact sums.

    Six decimal places: deliberately exercises the DECIMAL(20,6) precision path
    end-to-end. If anything in the chain coerces to float, the trailing
    `.123456` will round to `.123455` or `.123457` and tests will catch it.
    """
    a = ACCOUNTS.index(account)
    e = ENTITIES.index(entity)
    c = COSTCENTERS.index(costcenter)
    p = int(period.split("-")[1])  # 1..12
    return Decimal(f"{(a * 1000 + e * 100 + c * 10 + p):d}.123456")


def iter_seed() -> Iterator[tuple[str, str, str, str, str, str, Decimal]]:
    """Yield (account, entity, costcenter, period, scenario, version, value) tuples."""
    for a in ACCOUNTS:
        for e in ENTITIES:
            for c in COSTCENTERS:
                for p in PERIODS:
                    for s in SCENARIOS:
                        for v in VERSIONS:
                            yield (a, e, c, p, s, v, deterministic_value(a, e, c, p))
