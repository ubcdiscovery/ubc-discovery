from pydantic import BaseModel

import uuid
from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.audit_actor import AuditActorType
from app.models.event_audit import EventAuditAction

class ConnectedUser(BaseModel):
    user_uuid : uuid
    preferred_name : str
    created_at : datetime

class ConnectRequest(BaseModel):
    id : uuid
    user_uuid : uuid
    preferred_name : str
    created_at : datetime