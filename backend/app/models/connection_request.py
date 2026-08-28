import uuid
from datetime import datetime

from nanoid import generate
from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, DateTime, String, Text, false, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.database import Base

class Connection(Base):
    __tablename__="connection_reqeuest"