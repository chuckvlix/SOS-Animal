"""campaigns_module

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-21 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Recreate the campaigns table dropped by revision 0002."""
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column(
            "campaign_type",
            sa.Enum(
                "CALENDARIO_VACUNACION",
                "CAMPANA_ESTERILIZACION",
                "ATENCION_EMERGENCIA",
                "PROXIMA_JORNADA",
                name="campaigntype",
                native_enum=False,
                length=48,
            ),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("requirements", sa.Text(), nullable=True),
        sa.Column("location_address", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("institution", sqlmodel.sql.sqltypes.AutoString(length=150), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_campaigns_campaign_type"), "campaigns", ["campaign_type"], unique=False
    )
    op.create_index(op.f("ix_campaigns_created_by"), "campaigns", ["created_by"], unique=False)
    op.create_index(op.f("ix_campaigns_start_date"), "campaigns", ["start_date"], unique=False)


def downgrade() -> None:
    """Drop the campaigns table and its indexes."""
    op.drop_index(op.f("ix_campaigns_start_date"), table_name="campaigns")
    op.drop_index(op.f("ix_campaigns_created_by"), table_name="campaigns")
    op.drop_index(op.f("ix_campaigns_campaign_type"), table_name="campaigns")
    op.drop_table("campaigns")
