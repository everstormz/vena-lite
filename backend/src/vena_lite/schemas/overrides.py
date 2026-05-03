"""Override request/response schemas (Slice 11).

An override is a manual write to a driver-controlled account intersection.
The override sticks until released; downstream drivers consuming the
overridden account see the override value via `facts_current`. Recalc skips
overridden intersections so a later /submit upstream does not overwrite.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .submit import SubmittedCell


class OverrideRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    cells: list[SubmittedCell] = Field(min_length=1)


class OverrideIntersection(BaseModel):
    account: str
    entity: str
    costcenter: str
    period: str
    scenario: str
    version: str


class OverrideReleaseRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    cells: list[OverrideIntersection] = Field(min_length=1)


class OverrideResponse(BaseModel):
    request_id: str
    accepted_count: int
