"""Slice request/response schemas. Decimals serialize as JSON strings on the wire."""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field, field_serializer

from .dimensions import DimFilter, DimName


class SliceRequest(BaseModel):
    filters: dict[DimName, DimFilter] = Field(default_factory=dict)


class FactRow(BaseModel):
    account: str
    entity: str
    costcenter: str
    period: str
    scenario: str
    version: str
    value: Decimal

    @field_serializer("value")
    def _serialize_value(self, v: Decimal) -> str:
        return format(v, "f")


class SliceResponse(BaseModel):
    rows: list[FactRow]
    total: int
