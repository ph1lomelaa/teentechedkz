import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { History, Info, Plus, Trash2 } from 'lucide-react'
import {
  MzkTier,
  RewardRuleKind,
  RewardRulePayload,
  rewardRulesApi,
} from '@/api/rewardRules'
import { useRewardRules, formatTenge } from '@/hooks/useRewardRules'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { AppButton, AppInput } from '@/components/ui'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'

const STAGE_TITLES: Record<string, string> = {
  pre_admission: 'Pre-Admission',
  admission: 'Admission',
  post_admission: 'Post-Admission',
}

const COLOR_TITLES: Record<string, string> = {
  yellow: 'Жёлтый',
  orange: 'Оранжевый',
  red: 'Красный',
}

/** Конструктор ставок вознаграждений — только для админа.
 *
 * Ставки перестали быть константами в коде: здесь админ собирает логику сам.
 * Правка создаёт новую версию ставки, а уже начисленные суммы хранят ту, по
 * которой их посчитали, — поэтому история не переписывается.
 */
export const RewardRulesConstructor: React.FC<{ colorPrefix?: AdminColorPrefix }> = ({
  colorPrefix = 'w',
}) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const { rules, isLoading, stagePctSum, mzkTiers } = useRewardRules()

  const saveMutation = useMutation({
    mutationFn: ({
      kind,
      ruleKey,
      payload,
      note,
    }: {
      kind: RewardRuleKind
      ruleKey: string
      payload: RewardRulePayload
      note?: string
    }) => rewardRulesApi.update(kind, ruleKey, payload, note),
    onSuccess: () => {
      // Подписи на карточках начислений берутся из этих же данных.
      queryClient.invalidateQueries({ queryKey: ['reward-rules'] })
      toast({ title: 'Ставка обновлена' })
    },
    onError: (e) =>
      toast({ title: getErrorMessage(e, 'Не удалось сохранить ставку'), variant: 'destructive' }),
  })

  if (isLoading) {
    return <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка ставок…</div>
  }

  return (
    <div className="grid gap-4">
      {/* Без этой строки админ боится трогать ставки: непонятно, что случится
          с уже начисленным. */}
      <div className={cn('flex items-start gap-2 p-3 text-xs', t.card, t.muted)}>
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Изменение ставок влияет только на новые начисления. Уже начисленные суммы
          пересчёту не подлежат — каждая хранит ставку, по которой её посчитали.
        </span>
      </div>

      <RuleCard
        title="Проценты по этапам"
        description="Доли вознаграждения за Pre-Admission / Admission / Post-Admission."
        colorPrefix={colorPrefix}
        warning={
          stagePctSum !== 100
            ? `Сумма долей — ${stagePctSum}%, а не 100%. Это допустимо, но проверьте, не опечатка ли.`
            : null
        }
      >
        {Object.keys(STAGE_TITLES).map((key) => (
          <NumberRuleRow
            key={key}
            label={STAGE_TITLES[key]}
            suffix="%"
            value={rules?.mentor_stage_pct?.[key]?.pct ?? 0}
            colorPrefix={colorPrefix}
            isPending={saveMutation.isPending}
            onSave={(value, note) =>
              saveMutation.mutate({
                kind: 'mentor_stage_pct',
                ruleKey: key,
                payload: { kind: 'mentor_stage_pct', pct: value },
                note,
              })
            }
            onHistory={() => showHistory('mentor_stage_pct', key)}
          />
        ))}
      </RuleCard>

      <RuleCard
        title="Штрафы по задачам"
        description="Санкции по цветовым статусам просроченных задач."
        colorPrefix={colorPrefix}
      >
        {Object.keys(COLOR_TITLES).map((key) => (
          <NumberRuleRow
            key={key}
            label={COLOR_TITLES[key]}
            suffix="₸"
            value={rules?.mentor_task_penalty?.[key]?.amount ?? 0}
            colorPrefix={colorPrefix}
            isPending={saveMutation.isPending}
            onSave={(value, note) =>
              saveMutation.mutate({
                kind: 'mentor_task_penalty',
                ruleKey: key,
                payload: { kind: 'mentor_task_penalty', amount: value },
                note,
              })
            }
            onHistory={() => showHistory('mentor_task_penalty', key)}
          />
        ))}
      </RuleCard>

      <RuleCard
        title="Бонус ОКК МЗК"
        description="Ежемесячная премия по проценту положительных проверок."
        colorPrefix={colorPrefix}
      >
        <TierEditor
          tiers={mzkTiers}
          colorPrefix={colorPrefix}
          isPending={saveMutation.isPending}
          onSave={(tiers, note) =>
            saveMutation.mutate({
              kind: 'mzk_quality_bonus',
              ruleKey: 'default',
              payload: { kind: 'mzk_quality_bonus', tiers },
              note,
            })
          }
        />
      </RuleCard>

      <RuleCard
        title="Возвратные кейсы"
        description="Суммы по уровням сложности возвратного кейса."
        colorPrefix={colorPrefix}
      >
        {Object.keys(COLOR_TITLES).map((key) => (
          <NumberRuleRow
            key={key}
            label={COLOR_TITLES[key]}
            suffix="₸"
            value={rules?.refund_case_bonus?.[key]?.amount ?? 0}
            colorPrefix={colorPrefix}
            isPending={saveMutation.isPending}
            onSave={(value, note) =>
              saveMutation.mutate({
                kind: 'refund_case_bonus',
                ruleKey: key,
                payload: { kind: 'refund_case_bonus', amount: value },
                note,
              })
            }
            onHistory={() => showHistory('refund_case_bonus', key)}
          />
        ))}
      </RuleCard>
    </div>
  )

  async function showHistory(kind: RewardRuleKind, ruleKey: string) {
    try {
      const rows = await rewardRulesApi.history(kind, ruleKey)
      const lines = rows
        .slice(0, 8)
        .map((r) => {
          const value =
            typeof r.payload.pct === 'number'
              ? `${r.payload.pct}%`
              : typeof r.payload.amount === 'number'
                ? formatTenge(r.payload.amount as number)
                : JSON.stringify(r.payload)
          const when = new Date(r.effective_from).toLocaleDateString('ru-RU')
          return `v${r.version} · ${value} · с ${when}${r.note ? ` — ${r.note}` : ''}`
        })
        .join('\n')
      toast({ title: 'История ставки', description: lines || 'Изменений не было' })
    } catch (e) {
      toast({ title: getErrorMessage(e, 'Не удалось загрузить историю'), variant: 'destructive' })
    }
  }
}

const RuleCard: React.FC<{
  title: string
  description: string
  colorPrefix: AdminColorPrefix
  warning?: string | null
  children: React.ReactNode
}> = ({ title, description, colorPrefix, warning, children }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  return (
    <section className={cn('p-4', t.card)}>
      <h3 className={cn('font-bold', t.ink)}>{title}</h3>
      <p className={cn('mt-0.5 text-xs', t.muted)}>{description}</p>
      {warning && (
        <p className="mt-2 rounded-ctl border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-2xs font-bold text-amber-600 dark:text-amber-300">
          {warning}
        </p>
      )}
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  )
}

const NumberRuleRow: React.FC<{
  label: string
  suffix: string
  value: number
  colorPrefix: AdminColorPrefix
  isPending: boolean
  onSave: (value: number, note?: string) => void
  onHistory: () => void
}> = ({ label, suffix, value, colorPrefix, isPending, onSave, onHistory }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [draft, setDraft] = useState(String(value))
  const [note, setNote] = useState('')

  // Значение может обновиться после сохранения или инвалидации — подхватываем.
  useEffect(() => setDraft(String(value)), [value])

  const parsed = Number(draft)
  const changed = draft !== String(value)
  const valid = Number.isFinite(parsed) && parsed >= 0 && (suffix !== '%' || parsed <= 100)

  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-ctl border p-2', t.borderLine)}>
      <span className={cn('min-w-[120px] flex-1 text-sm font-bold', t.ink)}>{label}</span>
      <AppInput
        colorPrefix={colorPrefix}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-9 w-28"
      />
      <span className={cn('text-xs', t.muted2)}>{suffix}</span>
      <AppInput
        colorPrefix={colorPrefix}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Почему меняем"
        className="h-9 w-full sm:w-44"
      />
      <button
        type="button"
        onClick={onHistory}
        title="История изменений"
        className={cn('rounded-ctl border p-2', t.borderLine, t.muted, 'hover:opacity-80')}
      >
        <History className="h-3.5 w-3.5" />
      </button>
      <AppButton
        colorPrefix={colorPrefix}
        disabled={!changed || !valid || isPending}
        onClick={() => {
          onSave(parsed, note || undefined)
          setNote('')
        }}
      >
        Сохранить
      </AppButton>
    </div>
  )
}

/** Пороги бонуса ОКК: список «от X% — Y ₸», редактируется целиком. */
const TierEditor: React.FC<{
  tiers: MzkTier[]
  colorPrefix: AdminColorPrefix
  isPending: boolean
  onSave: (tiers: MzkTier[], note?: string) => void
}> = ({ tiers, colorPrefix, isPending, onSave }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [draft, setDraft] = useState<MzkTier[]>(tiers)
  const [note, setNote] = useState('')

  useEffect(() => setDraft(tiers), [tiers])

  const thresholds = draft.map((tier) => tier.min_score_pct)
  const hasDuplicates = new Set(thresholds).size !== thresholds.length
  const valid =
    draft.length > 0 &&
    !hasDuplicates &&
    draft.every(
      (tier) =>
        Number.isFinite(tier.min_score_pct) &&
        tier.min_score_pct >= 0 &&
        tier.min_score_pct <= 100 &&
        Number.isFinite(tier.amount) &&
        tier.amount >= 0
    )

  const update = (index: number, patch: Partial<MzkTier>) =>
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <div className="grid gap-2">
      {draft.map((tier, index) => (
        <div
          key={index}
          className={cn('flex flex-wrap items-center gap-2 rounded-ctl border p-2', t.borderLine)}
        >
          <span className={cn('text-xs', t.muted)}>от</span>
          <AppInput
            colorPrefix={colorPrefix}
            type="number"
            value={String(tier.min_score_pct)}
            onChange={(e) => update(index, { min_score_pct: Number(e.target.value) })}
            className="h-9 w-24"
          />
          <span className={cn('text-xs', t.muted2)}>%</span>
          <span className={cn('text-xs', t.muted)}>→</span>
          <AppInput
            colorPrefix={colorPrefix}
            type="number"
            value={String(tier.amount)}
            onChange={(e) => update(index, { amount: Number(e.target.value) })}
            className="h-9 w-32"
          />
          <span className={cn('text-xs', t.muted2)}>₸</span>
          <button
            type="button"
            onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
            disabled={draft.length === 1}
            className={cn('ml-auto rounded-ctl border p-2 disabled:opacity-40', t.borderLine, t.muted)}
            title={draft.length === 1 ? 'Нужен хотя бы один порог' : 'Удалить порог'}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {hasDuplicates && (
        <p className="text-2xs font-bold text-red-500">
          Пороги не должны повторяться — иначе неясно, какая сумма сработает.
        </p>
      )}
      <p className={cn('text-2xs', t.muted2)}>
        Результат ниже самого маленького порога бонуса не даёт.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDraft((rows) => [...rows, { min_score_pct: 0, amount: 0 }])}
          disabled={draft.length >= 10}
          className={cn(
            'inline-flex items-center gap-1 rounded-ctl border px-3 py-2 text-xs font-bold disabled:opacity-40',
            t.borderLine,
            t.muted
          )}
        >
          <Plus className="h-3.5 w-3.5" /> Добавить порог
        </button>
        <AppInput
          colorPrefix={colorPrefix}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Почему меняем"
          className="h-9 w-full sm:w-44"
        />
        <AppButton
          colorPrefix={colorPrefix}
          disabled={!valid || isPending}
          onClick={() => {
            onSave(draft, note || undefined)
            setNote('')
          }}
        >
          Сохранить пороги
        </AppButton>
      </div>
    </div>
  )
}
