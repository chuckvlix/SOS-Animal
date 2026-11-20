"""drop_attention_centers

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-20 15:35:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop attention_centers table and its indexes."""
    op.drop_index(op.f("ix_attention_centers_name"), table_name="attention_centers")
    op.drop_index(op.f("ix_attention_centers_is_active"), table_name="attention_centers")
    op.drop_index(op.f("ix_attention_centers_is_24_hours"), table_name="attention_centers")
    op.drop_index(op.f("ix_attention_centers_category"), table_name="attention_centers")
    op.drop_table("attention_centers")


def downgrade() -> None:
    """Recreate attention_centers table and its indexes."""
    op.create_table(
        "attention_centers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=150), nullable=False),
        sa.Column(
            "category",
            sa.Enum("ZOONOSIS", "VETERINARIA", name="centercategory", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("address", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("phone", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column("opening_hours", sqlmodel.sql.sqltypes.AutoString(length=150), nullable=False),
        sa.Column("is_24_hours", sa.Boolean(), nullable=False),
        sa.Column("services", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_attention_centers_category"), "attention_centers", ["category"], unique=False
    )
    op.create_index(
        op.f("ix_attention_centers_is_24_hours"), "attention_centers", ["is_24_hours"], unique=False
    )
    op.create_index(
        op.f("ix_attention_centers_is_active"), "attention_centers", ["is_active"], unique=False
    )
    op.create_index(op.f("ix_attention_centers_name"), "attention_centers", ["name"], unique=False)
