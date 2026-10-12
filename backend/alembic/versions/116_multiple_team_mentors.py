"""Allow several staff members in every student-team role."""
from alembic import op

revision = "116"
down_revision = "114"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP INDEX IF EXISTS uq_mentor_assignment_active_role")
    op.execute("DROP INDEX IF EXISTS uq_mentor_assignment_active_country")
    # Only duplicate assignments of the SAME person are redundant.
    op.execute("""
        UPDATE mentor_assignments AS ma SET is_active = false, assignment_status = 'replaced'
        FROM (SELECT id, row_number() OVER (
            PARTITION BY student_id, role, mentor_id ORDER BY assigned_at DESC, id DESC
        ) AS rn FROM mentor_assignments WHERE is_active AND mentor_id IS NOT NULL) ranked
        WHERE ma.id = ranked.id AND ranked.rn > 1
    """)
    op.execute("""CREATE UNIQUE INDEX uq_mentor_assignment_active_person
        ON mentor_assignments (student_id, role, mentor_id)
        WHERE is_active AND mentor_id IS NOT NULL""")


def downgrade():
    # Preserve teams: refuse rollback until incompatible assignments are resolved.
    op.execute("""CREATE UNIQUE INDEX uq_mentor_assignment_active_role
        ON mentor_assignments (student_id, role)
        WHERE is_active AND mentor_id IS NOT NULL AND role <> 'country'""")
    op.execute("""CREATE UNIQUE INDEX uq_mentor_assignment_active_country
        ON mentor_assignments (student_id, role, country_scope) NULLS NOT DISTINCT
        WHERE is_active AND mentor_id IS NOT NULL AND role = 'country'""")
    op.execute("DROP INDEX IF EXISTS uq_mentor_assignment_active_person")
