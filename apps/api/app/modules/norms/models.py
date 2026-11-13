from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.core.database import utc_now


class LegalNorm(SQLModel, table=True):
    """Official legal norm and educational reference with downloadable PDF key."""

    __tablename__ = "legal_norms"

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(max_length=200)
    summary_text: str = Field(sa_type=sa.Text)
    pdf_object_key: str | None = Field(default=None, max_length=500)
    is_active: bool = Field(default=True, index=True)
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_type=sa.DateTime(timezone=True),
    )
