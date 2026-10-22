"""Store the experience type of every activity explicitly.

Until now an empty `experience_type` was derived from the free-text `kind` on
every read. From here on `kind` is only a subtitle, so the derived value is
written once. Activities that already have a type keep it.
"""
from alembic import op
import sqlalchemy as sa

from app.services.experience import experience_type

revision = '122'
down_revision = '121'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT id, kind FROM activities WHERE experience_type IS NULL')).all()
    for row in rows:
        conn.execute(sa.text('UPDATE activities SET experience_type = :value WHERE id = :id'),
                     {'value': experience_type(row.kind), 'id': row.id})


def downgrade():
    # Derived values are indistinguishable from chosen ones; reading code still
    # falls back to `kind` for NULL, so keeping them is harmless.
    pass
