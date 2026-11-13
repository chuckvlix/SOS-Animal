from collections.abc import Generator
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated

import sqlalchemy as sa
from fastapi import Depends
from sqlmodel import Session, create_engine

from app.core.config import settings


def utc_now() -> datetime:
    """Return current timezone-aware UTC datetime."""
    return datetime.now(UTC)


def str_enum_type(enum_cls: type[StrEnum], *, length: int = 32) -> sa.Enum:
    """Create a portable SQLAlchemy Enum storing StrEnum values instead of member names."""
    return sa.Enum(
        enum_cls,
        values_callable=lambda members: [member.value for member in members],
        native_enum=False,
        length=length,
    )


engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.ENVIRONMENT == "development",
    pool_pre_ping=True,
)


def get_session() -> Generator[Session, None, None]:
    """Provide a transactional database session per request."""
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
