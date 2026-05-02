"""Submit Pydantic schema validation."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest
from pydantic import ValidationError

from vena_lite.schemas.submit import SubmitRequest, SubmitResponse, SubmittedCell


def _cell(**overrides):
    base = dict(
        account="4000_Revenue",
        entity="E001_US",
        costcenter="CC100_Sales",
        period="2026-01",
        scenario="Actual",
        version="v1",
        value=Decimal("123.456789"),
    )
    base.update(overrides)
    return SubmittedCell(**base)


def test_submitted_cell_value_is_decimal():
    c = _cell()
    assert isinstance(c.value, Decimal)


def test_submitted_cell_serializes_value_as_string():
    c = _cell(value=Decimal("0.123456"))
    payload = json.loads(c.model_dump_json())
    assert payload["value"] == "0.123456"
    assert isinstance(payload["value"], str)


def test_submit_request_requires_at_least_one_cell():
    with pytest.raises(ValidationError):
        SubmitRequest(request_id="req-1", cells=[])


def test_submit_request_requires_non_empty_request_id():
    with pytest.raises(ValidationError):
        SubmitRequest(request_id="", cells=[_cell()])


def test_submit_request_round_trip():
    req = SubmitRequest(request_id="req-42", cells=[_cell(), _cell(period="2026-02")])
    payload = json.loads(req.model_dump_json())
    parsed = SubmitRequest.model_validate(payload)
    assert parsed.request_id == "req-42"
    assert len(parsed.cells) == 2
    assert parsed.cells[0].value == Decimal("123.456789")


def test_submit_response_round_trip():
    r = SubmitResponse(request_id="req-99", accepted_count=7)
    parsed = SubmitResponse.model_validate(json.loads(r.model_dump_json()))
    assert parsed.accepted_count == 7
