import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { mzkQualityApi } from '@/api/mzkQuality'
import { usersApi } from '@/api'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AppButton, AppInput, EmptyState, PageHeader } from '@/components/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'

const MONTH_LABELS = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

/** Последние 12 отчётных периодов, свежий первым. Будущие бэкенд отклоняет (422). */
function recentPeriods(now: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  return out
}

const periodKey = (p: { year: number; month: number }) => `${p.year}-${p.month}`

interface Props {
  colorPrefix?: AdminColorPrefix
  /** false — режим «только свои баллы» для МЗК-менеджера: без выбора человека и без выставления оценок. */
  canManage?: boolean
}

export const MzkQualityManager: React.FC<Props> = ({ colorPrefix = 'w', canManage = true }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const now = useMemo(() => new Date(), [])
  const periods = useMemo(() => recentPeriods(now), [now])

  const [mzkManagerId, setMzkManagerId] = useState('')
  const [period, setPeriod] = useState(periodKey(periods[0]))
  const [invalidating, setInvalidating] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [sourceKey, setSourceKey] = useState('')

  const { data: mzkManagers = [] } = useQuery({
    queryKey: ['users', 'mzk_manager'],
    queryFn: () => usersApi.list({ role: 'mzk_manager' }),
    enabled: canManage,
  })

  // Для МЗК-менеджера бэкенд сам скоупит выдачу на него — параметр игнорируется.
  const { data: scoresData } = useQuery({
    queryKey: ['mzk-quality', 'scores', mzkManagerId],
    queryFn: () => mzkQualityApi.listScores(mzkManagerId || undefined),
  })
  const scores = scoresData?.items ?? []

  const { data: reviewsData } = useQuery({
    queryKey: ['mzk-quality', 'reviews', mzkManagerId],
    queryFn: () => mzkQualityApi.listReviews(mzkManagerId || undefined),
    enabled: canManage && Boolean(mzkManagerId),
  })
  const reviews = reviewsData?.items ?? []

  const reviewMutation = useMutation({
    mutationFn: (is_positive: boolean) => {
      const [year, month] = period.split('-').map(Number)
      return mzkQualityApi.createReview({
        mzk_manager_id: mzkManagerId,
        period_year: year,
        period_month: month,
        is_positive,
        source_kind: 'manual',
        source_key: sourceKey.trim(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mzk-quality'] })
      toast({ title: 'Оценка сохранена' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось сохранить оценку'), variant: 'destructive' }),
  })

  const invalidateMutation = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => mzkQualityApi.invalidateReview(id, why),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mzk-quality'] })
      setInvalidating(null)
      setReason('')
      toast({ title: 'Оценка аннулирована' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось изменить оценку'), variant: 'destructive' }),
  })

  const [selectedYear, selectedMonth] = period.split('-')

  return (
    <div className="animate-fade-in">
      <PageHeader
        colorPrefix={colorPrefix}
        eyebrow="ОКК"
        title={canManage ? 'Ежемесячная оценка качества МЗК' : 'Моя оценка качества'}
        description="% положительных оценок за месяц. Бонус: ≥90% — 20 000₸, 80–89.99% — 10 000₸, ниже — без бонуса."
      />

      {canManage && (
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="min-w-[240px] max-w-xs flex-1">
            <Select value={mzkManagerId} onValueChange={setMzkManagerId}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Выберите МЗК" /></SelectTrigger>
              <SelectContent>
                {mzkManagers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Период" /></SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={periodKey(p)} value={periodKey(p)}>
                    {MONTH_LABELS[p.month]} {p.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {canManage && mzkManagerId && (
        <div className={cn('mb-6 p-4', t.card)}>
          <p className={cn('mb-2 text-sm font-bold', t.ink)}>
            Поставить оценку за {MONTH_LABELS[Number(selectedMonth)]} {selectedYear}
          </p>
          <div className="flex gap-2">
            <AppInput value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} placeholder="ID источника" className="max-w-xs" />
            <AppButton colorPrefix={colorPrefix} disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate(true)}>
              <ThumbsUp className="h-4 w-4" /> Положительная
            </AppButton>
            <AppButton colorPrefix={colorPrefix} disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate(false)}>
              <ThumbsDown className="h-4 w-4" /> Отрицательная
            </AppButton>
          </div>
          {reviews.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {reviews.map((r) => (
                <div key={r.id} className={cn('flex items-center justify-between gap-3 px-3 py-2 text-sm', t.row)}>
                  <span className={r.is_valid ? (r.is_positive ? t.good : t.danger) : cn(t.muted2, 'line-through')}>
                    {r.is_positive ? 'Положительная' : 'Отрицательная'} · {MONTH_LABELS[r.period_month]} {r.period_year}
                    {!r.is_valid && r.invalidated_reason && (
                      <span className={cn('ml-2 no-underline', t.muted2)}>({r.invalidated_reason})</span>
                    )}
                  </span>
                  {r.is_valid && (
                    <button
                      type="button"
                      onClick={() => { setInvalidating(r.id); setReason('') }}
                      className={cn('shrink-0 text-2xs font-bold', t.muted, t.dangerHover)}
                    >
                      Признать недействительной
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {scores.length === 0 ? (
        <EmptyState
          colorPrefix={colorPrefix}
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Расчётов ОКК ещё нет"
          description="Появятся автоматически в начале следующего месяца, если есть оценки за прошедший."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {scores.map((s) => (
            <div key={s.id} className={cn('p-4', t.card)}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {/* Без имени карточки за один месяц у разных людей неотличимы. */}
                  {s.mzk_manager_name && (
                    <p className={cn('truncate text-2xs font-bold uppercase tracking-wider', t.muted2)}>
                      {s.mzk_manager_name}
                    </p>
                  )}
                  <h3 className={cn('font-bold', t.ink)}>{MONTH_LABELS[s.period_month]} {s.period_year}</h3>
                </div>
                {s.disqualified ? (
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-bold', t.dangerSoftBg, t.danger)}>
                    <XCircle className="h-3 w-3" /> Дисквалифицирован
                  </span>
                ) : (
                  <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-2xs font-bold', t.line, t.muted)}>
                    {s.bonus_amount > 0 ? `+${new Intl.NumberFormat('ru-RU').format(s.bonus_amount)}₸` : 'Без бонуса'}
                  </span>
                )}
              </div>
              <p className={cn('mt-2 text-2xl font-black', t.ink)}>{Number(s.score_pct).toFixed(1)}%</p>
              <p className={cn('text-2xs', t.muted2)}>
                {s.positive_reviews_count} из {s.valid_reviews_count} действительных оценок
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(invalidating)} onOpenChange={(open) => { if (!open) setInvalidating(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Аннулировать оценку</DialogTitle></DialogHeader>
          <p className={cn('text-sm', t.muted)}>
            п.7.8 регламента: повтор, самооценка, давление и подобное. Основание сохранится в записи.
          </p>
          <AppInput
            colorPrefix={colorPrefix}
            label="Причина"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: повторная оценка от того же клиента"
          />
          <DialogFooter>
            <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={() => setInvalidating(null)}>Отмена</AppButton>
            <AppButton
              colorPrefix={colorPrefix}
              disabled={!reason.trim() || invalidateMutation.isPending}
              onClick={() => invalidating && invalidateMutation.mutate({ id: invalidating, why: reason.trim() })}
            >
              Аннулировать
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
