import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Plus } from 'lucide-react'
import { refundCasesApi, RefundCase, RefundLevel, RefundCaseStatus } from '@/api/refundCases'
import { usersApi } from '@/api'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton, EmptyState, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { QueryState } from '@/components/shared/QueryState'

const LEVEL_LABELS: Record<RefundLevel, string> = {
  yellow: 'Жёлтый · 10 000₸',
  orange: 'Оранжевый · 15 000₸',
  red: 'Красный · 25 000₸',
}

const LEVEL_COLORS: Record<RefundLevel, string> = {
  yellow: 'border-amber-400/60 bg-amber-400/10 text-amber-300',
  orange: 'border-orange-400/60 bg-orange-400/10 text-orange-300',
  red: 'border-red-400/60 bg-red-400/10 text-red-300',
}

const STATUS_LABELS: Record<RefundCaseStatus, string> = {
  draft: 'Черновик', submitted: 'Подано', registered: 'Зарегистрирован', under_review: 'На проверке',
  awaiting_documents: 'Ожидает документы', awaiting_approval: 'Ожидает утверждения', negotiation: 'Переговоры',
  decision_made: 'Решение принято', awaiting_execution: 'Ожидает исполнения', executed: 'Исполнен',
  closed: 'Закрыт',
  rejected: 'Отклонён',
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const WorkspaceRefundCasesPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<RefundCaseStatus | 'all'>('all')
  const [selected, setSelected] = useState<RefundCase | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['refund-cases', statusFilter],
    queryFn: () => refundCasesApi.list(statusFilter === 'all' ? undefined : statusFilter),
  })
  const cases = data?.items ?? []

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-w-accentText">Возвраты</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-w-ink">Возвратные кейсы</h1>
          <p className="mt-2 max-w-[560px] text-sm text-w-muted">
            Уровень сложности утверждается вручную (не по времени). Бонус МЗК: жёлтый 10 000₸, оранжевый 15 000₸, красный 25 000₸.
          </p>
        </div>
        <AppButton colorPrefix="w" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Новый кейс
        </AppButton>
      </div>

      <div className="mb-5">
        <SegmentedTabs
          colorPrefix="w"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as RefundCaseStatus | 'all')}
          tabs={[
            { value: 'all', label: 'Все' },
            { value: 'under_review', label: 'На проверке' },
            { value: 'awaiting_approval', label: 'На утверждении' },
            { value: 'closed', label: 'Закрытые' },
            { value: 'rejected', label: 'Отклонённые' },
          ]}
        />
      </div>

      <QueryState
        colorPrefix="w"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={cases.length === 0}
        empty={(
          <EmptyState colorPrefix="w" icon={<Banknote className="h-5 w-5" />} title="Возвратных кейсов нет" />
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {cases.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className="rounded-card border border-w-line bg-w-panel p-4 text-left transition hover:border-w-accentDim"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-w-ink">{c.mzk_manager_name ?? 'Без МЗК'}</h3>
                  {c.amount != null && (
                    <p className="mt-0.5 text-xs text-w-muted">{new Intl.NumberFormat('ru-RU').format(c.amount)} ₸</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.level && (
                    <span className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-2xs font-bold ${LEVEL_COLORS[c.level]}`}>
                      {LEVEL_LABELS[c.level]}
                    </span>
                  )}
                  <span className="rounded-pill bg-w-line px-2 py-0.5 text-2xs font-bold text-w-muted">
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-2xs text-w-muted2">Открыт {fmt(c.opened_at)}</p>
            </button>
          ))}
        </div>
      </QueryState>

      {createOpen && <CreateRefundCaseDialog onClose={() => setCreateOpen(false)} />}
      {selected && <RefundCaseDialog refundCase={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

const CreateRefundCaseDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const queryClient = useQueryClient()
  const [studentId, setStudentId] = useState('')
  const [amount, setAmount] = useState('')

  const { data: mzkManagers = [] } = useQuery({
    queryKey: ['users', 'mzk_manager'],
    queryFn: () => usersApi.list({ role: 'mzk_manager' }),
  })
  const [mzkManagerId, setMzkManagerId] = useState('')

  const mutation = useMutation({
    mutationFn: () => refundCasesApi.create({
      student_id: studentId || undefined,
      mzk_manager_id: mzkManagerId || undefined,
      amount: amount ? Number(amount) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refund-cases'] })
      toast({ title: 'Кейс создан' })
      onClose()
    },
    onError: () => toast({ title: 'Не удалось создать кейс', variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="portal max-w-md border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle>Новый возвратный кейс</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="ID студента (опционально)"
            className="h-11 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2"
          />
          <Select value={mzkManagerId} onValueChange={setMzkManagerId}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Ответственный МЗК" /></SelectTrigger>
            <SelectContent>
              {mzkManagers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма возврата, ₸"
            type="number"
            className="h-11 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2"
          />
          <AppButton colorPrefix="w" className="w-full" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Создать
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const RefundCaseDialog: React.FC<{ refundCase: RefundCase; onClose: () => void }> = ({ refundCase, onClose }) => {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [summary, setSummary] = useState(refundCase.resolution_summary ?? '')
  const [decision, setDecision] = useState(refundCase.decision ?? '')
  const [approvalNote, setApprovalNote] = useState(refundCase.approval_note ?? '')
  const [executionConfirmation, setExecutionConfirmation] = useState(refundCase.execution_confirmation ?? '')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['refund-cases'] })

  const levelMutation = useMutation({
    mutationFn: (level: RefundLevel) => refundCasesApi.setLevel(refundCase.id, level),
    onSuccess: invalidate,
    onError: () => toast({ title: 'Не удалось утвердить уровень', variant: 'destructive' }),
  })

  const resolveMutation = useMutation({
    mutationFn: () => refundCasesApi.resolve(refundCase.id, summary.trim(), decision.trim(), executionConfirmation.trim()),
    onSuccess: () => { invalidate(); onClose() },
    onError: () => toast({ title: 'Не удалось закрыть кейс', variant: 'destructive' }),
  })
  const approveMutation = useMutation({
    mutationFn: () => refundCasesApi.approve(refundCase.id, decision.trim(), approvalNote.trim()),
    onSuccess: invalidate,
    onError: () => toast({ title: 'Не удалось утвердить решение', variant: 'destructive' }),
  })
  const bonusPaidMutation = useMutation({
    mutationFn: () => refundCasesApi.markBonusPaid(refundCase.id),
    onSuccess: () => { invalidate(); onClose(); toast({ title: 'Бонус отмечен как выплаченный' }) },
    onError: () => toast({ title: 'Не удалось подтвердить выплату бонуса', variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="portal max-w-md border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle>{refundCase.mzk_manager_name ?? 'Кейс'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs font-bold text-w-muted">Уровень сложности (утверждается вручную)</p>
          <div className="flex flex-wrap gap-2">
            {(['yellow', 'orange', 'red'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => levelMutation.mutate(level)}
                disabled={levelMutation.isPending}
                className={`rounded-full border px-3 py-1 text-2xs font-bold transition ${
                  refundCase.level === level ? LEVEL_COLORS[level] : 'border-w-line text-w-muted hover:text-w-ink'
                }`}
              >
                {LEVEL_LABELS[level]}
              </button>
            ))}
          </div>
          {refundCase.status !== 'closed' && (
            <>
              <textarea value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Решение" rows={2} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" />
              <textarea value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} placeholder="Письменное согласование администратора" rows={2} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" />
              {!refundCase.approved_at && <AppButton colorPrefix="w" className="w-full" disabled={!decision.trim() || !approvalNote.trim() || approveMutation.isPending} onClick={() => approveMutation.mutate()}>Утвердить решение</AppButton>}
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Как решён кейс…"
                rows={3}
                className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink outline-none placeholder:text-w-muted2"
              />
              <textarea value={executionConfirmation} onChange={(e) => setExecutionConfirmation(e.target.value)} placeholder="Подтверждение исполнения" rows={2} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" />
              <AppButton
                colorPrefix="w"
                className="w-full"
                disabled={!refundCase.level || !refundCase.approved_at || !executionConfirmation.trim() || resolveMutation.isPending}
                onClick={() => resolveMutation.mutate()}
              >
                Закрыть кейс
              </AppButton>
              {!refundCase.level && (
                <p className="text-2xs text-w-muted2">Сначала утвердите уровень сложности.</p>
              )}
            </>
          )}
          {refundCase.status === 'closed' && refundCase.bonus_paid_at && (
            <p className="rounded-ctl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
              Бонус выплачен {fmt(refundCase.bonus_paid_at)}
            </p>
          )}
          {user?.role === 'admin' && refundCase.status === 'closed' && !refundCase.bonus_paid_at && (
            <AppButton colorPrefix="w" className="w-full" disabled={bonusPaidMutation.isPending} onClick={() => bonusPaidMutation.mutate()}>
              {bonusPaidMutation.isPending ? 'Подтверждение…' : `Подтвердить выплату бонуса${refundCase.bonus_amount ? ` · ${refundCase.bonus_amount.toLocaleString('ru-RU')} ₸` : ''}`}
            </AppButton>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
