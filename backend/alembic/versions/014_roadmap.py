"""Roadmap feature: templates + live per-student roadmaps

Revision ID: 014
Revises: 013
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None

priority_vals = ("required", "recommended", "optional")
audience_vals = ("applicant", "coordinator")
item_status_vals = ("planned", "in_progress", "done")
roadmap_status_vals = ("active", "archived")


def _enum(name, vals):
    return sa.Enum(*vals, name=name, create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum(*priority_vals, name="task_priority").create(bind, checkfirst=True)
    sa.Enum(*audience_vals, name="task_audience").create(bind, checkfirst=True)
    sa.Enum(*item_status_vals, name="roadmap_item_status").create(bind, checkfirst=True)
    sa.Enum(*roadmap_status_vals, name="roadmap_status").create(bind, checkfirst=True)

    op.create_table(
        "roadmap_templates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("country_name", sa.String(200), nullable=True),
        sa.Column("country_ref_id", sa.Uuid(), sa.ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True),
        sa.Column("degree", sa.String(40), nullable=False, server_default="bachelors"),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "template_stages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("template_id", sa.Uuid(), sa.ForeignKey("roadmap_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_template_stages_template_id", "template_stages", ["template_id"])

    op.create_table(
        "template_tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("stage_id", sa.Uuid(), sa.ForeignKey("template_stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("priority", _enum("task_priority", priority_vals), nullable=False, server_default="required"),
        sa.Column("audience", _enum("task_audience", audience_vals), nullable=False, server_default="applicant"),
        sa.Column("due_offset_days", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_template_tasks_stage_id", "template_tasks", ["stage_id"])

    op.create_table(
        "template_subtasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("template_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_template_subtasks_task_id", "template_subtasks", ["task_id"])

    op.create_table(
        "roadmaps",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_id", sa.Uuid(), sa.ForeignKey("roadmap_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("country_name", sa.String(200), nullable=True),
        sa.Column("degree", sa.String(40), nullable=False, server_default="bachelors"),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("status", _enum("roadmap_status", roadmap_status_vals), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_roadmaps_student_id", "roadmaps", ["student_id"])

    op.create_table(
        "stages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("roadmap_id", sa.Uuid(), sa.ForeignKey("roadmaps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", _enum("roadmap_item_status", item_status_vals), nullable=False, server_default="planned"),
    )
    op.create_index("ix_stages_roadmap_id", "stages", ["roadmap_id"])

    op.create_table(
        "roadmap_tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("stage_id", sa.Uuid(), sa.ForeignKey("stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("roadmap_id", sa.Uuid(), sa.ForeignKey("roadmaps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("assignee_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("priority", _enum("task_priority", priority_vals), nullable=False, server_default="required"),
        sa.Column("audience", _enum("task_audience", audience_vals), nullable=False, server_default="applicant"),
        sa.Column("status", _enum("roadmap_item_status", item_status_vals), nullable=False, server_default="planned"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_roadmap_tasks_stage_id", "roadmap_tasks", ["stage_id"])
    op.create_index("ix_roadmap_tasks_roadmap_id", "roadmap_tasks", ["roadmap_id"])

    op.create_table(
        "roadmap_subtasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("roadmap_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("is_done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_roadmap_subtasks_task_id", "roadmap_subtasks", ["task_id"])


def downgrade() -> None:
    op.drop_table("roadmap_subtasks")
    op.drop_table("roadmap_tasks")
    op.drop_table("stages")
    op.drop_table("roadmaps")
    op.drop_table("template_subtasks")
    op.drop_table("template_tasks")
    op.drop_table("template_stages")
    op.drop_table("roadmap_templates")
    for name in ("roadmap_status", "roadmap_item_status", "task_audience", "task_priority"):
        op.execute(f"DROP TYPE IF EXISTS {name}")
