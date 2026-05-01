"""Driver definition schemas (Slice 6)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class DriverDefineRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    account: str = Field(min_length=1, max_length=128)
    formula: str = Field(min_length=1, max_length=2048)


class DriverDefineResponse(BaseModel):
    request_id: str
    account: str
    formula: str
    references: list[str]
    initial_computed_count: int


class DriverInfo(BaseModel):
    account: str
    formula: str


class DriverListResponse(BaseModel):
    drivers: list[DriverInfo]
