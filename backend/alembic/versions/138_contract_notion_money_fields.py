"""Договор: Сумм УП, PAID УП, Профориентация, IELTS exam fee, PAID (Mentors).

Раньше эти колонки Notion жили только в снимке пайплайна, на платформе их
нельзя было вписать. Теперь это поля договора с двусторонним обменом.

Один раз переносим уже заполненные значения из последнего снимка Notion в
договор (только привязанные студенты с одним договором в тенге). Иначе первая
сверка завела бы сотни «конфликтов» вида «на платформе пусто, в Notion есть».
"""
from alembic import op
import sqlalchemy as sa

revision = '138'
down_revision = '137'
branch_labels = None
depends_on = None

FIELDS = ("up_sum", "up_paid", "proforientation_sum", "ielts_exam_fee", "mentor_paid")


def upgrade():
    for field in FIELDS:
        op.add_column('contracts', sa.Column(field, sa.Numeric(18, 2), nullable=True))
    sets = ",\n            ".join(
        f"{f} = CASE WHEN jsonb_typeof(n.normalized_data->'{f}') = 'number' "
        f"THEN (n.normalized_data->>'{f}')::numeric END"
        for f in FIELDS
    )
    op.execute(f"""
        UPDATE contracts c SET
            {sets}
        FROM notion_snapshots n
        WHERE n.student_id = c.student_id
          AND n.status = 'linked'
          AND coalesce(upper(c.currency), 'KZT') = 'KZT'
          AND (SELECT count(*) FROM contracts c2 WHERE c2.student_id = c.student_id) = 1
          AND (SELECT count(*) FROM notion_snapshots n2
               WHERE n2.student_id = c.student_id AND n2.status = 'linked') = 1
    """)


def downgrade():
    for field in reversed(FIELDS):
        op.drop_column('contracts', field)
