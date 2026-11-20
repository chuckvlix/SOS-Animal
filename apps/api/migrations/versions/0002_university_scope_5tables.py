"""university_scope_5tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-20 11:42:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop campaigns and legal_norms tables and tighten enums to university-only scope."""
    op.drop_index(op.f("ix_campaigns_start_date"), table_name="campaigns")
    op.drop_index(op.f("ix_campaigns_created_by"), table_name="campaigns")
    op.drop_index(op.f("ix_campaigns_campaign_type"), table_name="campaigns")
    op.drop_table("campaigns")

    op.drop_index(op.f("ix_legal_norms_is_active"), table_name="legal_norms")
    op.drop_table("legal_norms")

    op.execute(sa.text("UPDATE users SET role = 'ciudadano' WHERE role = 'gestor_cemzoo'"))
    op.execute(
        sa.text(
            "UPDATE complaints SET status = 'ENVIADA' "
            "WHERE status IN ('EN_ATENCION_CEMZOO', 'CERRADA')"
        )
    )
    op.execute(sa.text("DELETE FROM complaint_evidences WHERE evidence_type <> 'FOTO'"))

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint("userrole", "users", type_="check")
        op.create_check_constraint("userrole", "users", "role IN ('ciudadano', 'admin')")

        op.drop_constraint("complaintstatus", "complaints", type_="check")
        op.create_check_constraint(
            "complaintstatus", "complaints", "status IN ('BORRADOR', 'ENVIADA')"
        )

        op.drop_constraint("evidencetype", "complaint_evidences", type_="check")
        op.create_check_constraint("evidencetype", "complaint_evidences", "evidence_type IN ('FOTO')")


def downgrade() -> None:
    """Restore campaigns and legal_norms tables and prior enum constraints."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint("evidencetype", "complaint_evidences", type_="check")
        op.create_check_constraint(
            "evidencetype",
            "complaint_evidences",
            "evidence_type IN ('FOTO', 'VIDEO', 'DOCUMENTO')",
        )

        op.drop_constraint("complaintstatus", "complaints", type_="check")
        op.create_check_constraint(
            "complaintstatus",
            "complaints",
            "status IN ('BORRADOR', 'ENVIADA', 'EN_ATENCION_CEMZOO', 'CERRADA')",
        )

        op.drop_constraint("userrole", "users", type_="check")
        op.create_check_constraint(
            "userrole",
            "users",
            "role IN ('ciudadano', 'gestor_cemzoo', 'admin')",
        )

    op.create_table(
        "legal_norms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("pdf_object_key", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_legal_norms_is_active"), "legal_norms", ["is_active"], unique=False)

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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_campaigns_campaign_type"), "campaigns", ["campaign_type"], unique=False
    )
    op.create_index(op.f("ix_campaigns_created_by"), "campaigns", ["created_by"], unique=False)
    op.create_index(op.f("ix_campaigns_start_date"), "campaigns", ["start_date"], unique=False)
