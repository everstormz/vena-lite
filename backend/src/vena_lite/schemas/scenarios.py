"""Scenario / version copy schemas (Slice 5)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ScenarioRef(BaseModel):
    scenario: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=128)


class CreatedDimMember(BaseModel):
    dim: str
    member: str


class ScenarioCopyRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    source: ScenarioRef
    target: ScenarioRef


class ScenarioCopyResponse(BaseModel):
    request_id: str
    source: ScenarioRef
    target: ScenarioRef
    copied_count: int
    created_members: list[CreatedDimMember]
