"""Single-cell value lookup schema (Slice 11).

Powers the `=VENA(...)` Office.js custom function and the OverridePanel's
"current value" display. Same Decimal-as-string convention as /slice.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, field_serializer


class ValueResponse(BaseModel):
    account: str
    entity: str
    costcenter: str
    period: str
    scenario: str
    version: str
    value: Decimal
    source: str
    loaded_at: str

    @field_serializer("value")
    def _serialize_value(self, v: Decimal) -> str:
        return format(v, "f")
