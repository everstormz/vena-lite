"""Pydantic schema correctness — validation, decimal precision, JSON wire format."""
from __future__ import annotations

import json
from decimal import Decimal

import pytest
from pydantic import ValidationError

from vena_lite.schemas.dimensions import DIM_NAMES, DimFilter
from vena_lite.schemas.slice import FactRow, SliceRequest, SliceResponse


def test_dim_filter_accepts_none_members():
    f = DimFilter(members=None)
    assert f.members is None


def test_dim_filter_accepts_empty_list():
    f = DimFilter(members=[])
    assert f.members == []


def test_slice_request_default_filters_is_empty_dict():
    req = SliceRequest()
    assert req.filters == {}


def test_slice_request_accepts_known_dim_names():
    for name in DIM_NAMES:
        req = SliceRequest(filters={name: DimFilter(members=["x"])})
        assert name in req.filters


def test_slice_request_rejects_unknown_dim_name():
    with pytest.raises(ValidationError):
        SliceRequest(filters={"not_a_dim": DimFilter(members=["x"])})  # type: ignore[dict-item]


def test_fact_row_value_is_decimal_after_construction():
    row = FactRow(
        account="A",
        entity="E",
        costcenter="C",
        period="2026-01",
        scenario="Actual",
        version="v1",
        value=Decimal("123.456789"),
    )
    assert isinstance(row.value, Decimal)
    assert row.value == Decimal("123.456789")


def test_fact_row_serializes_value_as_json_string():
    row = FactRow(
        account="A",
        entity="E",
        costcenter="C",
        period="2026-01",
        scenario="Actual",
        version="v1",
        value=Decimal("123.456789"),
    )
    payload = json.loads(row.model_dump_json())
    assert payload["value"] == "123.456789"
    assert isinstance(payload["value"], str)


def test_fact_row_six_decimal_places_round_trip_via_json():
    """If anything coerces to float in (de)serialization, this round-trip drifts."""
    original = FactRow(
        account="A",
        entity="E",
        costcenter="C",
        period="2026-01",
        scenario="Actual",
        version="v1",
        value=Decimal("0.123456"),
    )
    payload = original.model_dump_json()
    parsed = FactRow.model_validate_json(payload)
    assert parsed.value == Decimal("0.123456")


def test_slice_response_round_trip():
    resp = SliceResponse(
        rows=[
            FactRow(
                account="A",
                entity="E",
                costcenter="C",
                period="2026-01",
                scenario="Actual",
                version="v1",
                value=Decimal("1.234567"),
            )
        ],
        total=1,
    )
    payload = json.loads(resp.model_dump_json())
    assert payload["total"] == 1
    assert payload["rows"][0]["value"] == "1.234567"
