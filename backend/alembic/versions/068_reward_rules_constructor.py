"""Reward rules as data + freeze applied rates on accruals.

Ставки вознаграждений были литералами в enum-свойствах моделей: изменить
процент этапа или сумму штрафа можно было только правкой кода и деплоем.
Здесь появляется таблица `reward_rules` (конструктор админа) — засеянная
ровно теми значениями, что были в коде, поэтому расчёт в день миграции не
меняется ни на тенге.

Вторая половина миграции важнее первой. Из четырёх видов ставок замороженными
были только две: `mentor_stage_rewards.computed_amount` и
`mzk_quality_scores.bonus_amount` — настоящие колонки. Суммы штрафов и
возвратных кейсов считались на лету при сериализации, то есть правка ставки
молча переписала бы выплаты по всем прошлым записям. Добавляем колонки-снимки
и заполняем их литералами, действовавшими на момент начисления.

`stage_pct_applied` заодно чинит расхождение в UI: карточка показывала процент
из enum, а сумму — сохранённую, так что после смены ставки они разъезжались.

Revision ID: 068
Revises: 067
Create Date: 2026-08-06
"""
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None

# Литералы из регламента — те же, что лежали в коде до миграции.
STAGE_PCT = {"pre_admission": 30, "admission": 40, "post_admission": 30}
TASK_PENALTY = {"yellow": 2_500, "orange": 5_000, "red": 7_500}
REFUND_BONUS = {"yellow": 10_000, "orange": 15_000, "red": 25_000}
MZK_TIERS = [{"min_score_pct": 90, "amount": 20_000}, {"min_score_pct": 80, "amount": 10_000}]

# Далеко в прошлом: любое существующее начисление попадает в интервал
# действия сида, поэтому rules_as_of() отвечает и по исторической строке.
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _sql_case(column: str, mapping: dict[str, int]) -> str:
    whens = " ".join(f"WHEN '{key}' THEN {value}" for key, value in mapping.items())
    return f"CASE {column}::text {whens} END"


def upgrade() -> None:
    kind_enum = sa.Enum(
        "mentor_stage_pct",
        "mentor_task_penalty",
        "mzk_quality_bonus",
        "refund_case_bonus",
        name="reward_rule_kind",
    )
    kind_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "reward_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # create_type=False: тип уже создан строкой выше (и мог остаться от
        # create_tables.py на дев-базе) — иначе create_table повторит CREATE
        # TYPE и упадёт на DuplicateObject.
        sa.Column(
            "kind",
            postgresql.ENUM(
                "mentor_stage_pct",
                "mentor_task_penalty",
                "mzk_quality_bonus",
                "refund_case_bonus",
                name="reward_rule_kind",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("rule_key", sa.String(length=50), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_reward_rules_kind", "reward_rules", ["kind"])
    op.create_index("ix_reward_rules_kind_key_from", "reward_rules", ["kind", "rule_key", "effective_from"])
    # Действующая ставка на слот ровно одна — гарантия на уровне базы.
    op.create_index(
        "uq_reward_rules_active",
        "reward_rules",
        ["kind", "rule_key"],
        unique=True,
        postgresql_where=sa.text("superseded_at IS NULL"),
    )

    rules = sa.table(
        "reward_rules",
        sa.column("id", sa.Uuid()),
        # Тип колонки — enum, поэтому и в literal-таблице он должен быть enum:
        # sa.String() улетел бы как varchar и упал на DatatypeMismatch.
        sa.column(
            "kind",
            postgresql.ENUM(name="reward_rule_kind", create_type=False),
        ),
        sa.column("rule_key", sa.String()),
        sa.column("payload", postgresql.JSONB()),
        sa.column("version", sa.Integer()),
        sa.column("effective_from", sa.DateTime(timezone=True)),
        sa.column("note", sa.Text()),
    )

    seed_note = "Сид из регламента (миграция 068)"
    rows: list[dict] = []
    for key, pct in STAGE_PCT.items():
        rows.append(dict(kind="mentor_stage_pct", rule_key=key, payload={"pct": pct}))
    for key, amount in TASK_PENALTY.items():
        rows.append(dict(kind="mentor_task_penalty", rule_key=key, payload={"amount": amount}))
    for key, amount in REFUND_BONUS.items():
        rows.append(dict(kind="refund_case_bonus", rule_key=key, payload={"amount": amount}))
    rows.append(dict(kind="mzk_quality_bonus", rule_key="default", payload={"tiers": MZK_TIERS}))

    op.bulk_insert(
        rules,
        [
            dict(row, id=uuid.uuid4(), version=1, effective_from=EPOCH, note=seed_note)
            for row in rows
        ],
    )

    # --- Колонки-снимки: сначала nullable, затем backfill, затем NOT NULL. ---
    op.add_column("mentor_stage_rewards", sa.Column("stage_pct_applied", sa.Integer(), nullable=True))
    op.add_column("mentor_task_penalties", sa.Column("amount", sa.Integer(), nullable=True))
    op.add_column("refund_cases", sa.Column("bonus_amount", sa.Integer(), nullable=True))

    op.execute(
        f"UPDATE mentor_stage_rewards SET stage_pct_applied = {_sql_case('stage', STAGE_PCT)}"
    )
    op.execute(
        f"UPDATE mentor_task_penalties SET amount = {_sql_case('color', TASK_PENALTY)}"
    )
    # Уровень возвратного кейса может быть не утверждён — тогда суммы нет.
    op.execute(
        f"UPDATE refund_cases SET bonus_amount = {_sql_case('level', REFUND_BONUS)} WHERE level IS NOT NULL"
    )

    op.alter_column("mentor_stage_rewards", "stage_pct_applied", nullable=False)
    op.alter_column("mentor_task_penalties", "amount", nullable=False)
    # refund_cases.bonus_amount остаётся nullable — до утверждения уровня пусто.


def downgrade() -> None:
    op.drop_column("refund_cases", "bonus_amount")
    op.drop_column("mentor_task_penalties", "amount")
    op.drop_column("mentor_stage_rewards", "stage_pct_applied")
    op.drop_index("uq_reward_rules_active", table_name="reward_rules")
    op.drop_index("ix_reward_rules_kind_key_from", table_name="reward_rules")
    op.drop_index("ix_reward_rules_kind", table_name="reward_rules")
    op.drop_table("reward_rules")
    sa.Enum(name="reward_rule_kind").drop(op.get_bind(), checkfirst=True)
