import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock3, Gavel, Inbox, MessageSquareWarning, Plus, Save, Send, ShieldAlert } from 'lucide-react'
import { complaintsApi, Complaint, ComplaintStatus } from '@/api/complaints'
import { usersApi } from '@/api'
import { getErrorMessage } from '@/lib/errorMessage'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { AppButton, EmptyState, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { CreateComplaintDialog } from '@/components/shared/CreateComplaintDialog'
import { QueryState } from '@/components/shared/QueryState'

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  new: 'Новое',
  in_progress: 'В работе',
  answered: 'Отвечено',
  closed: 'Закрыто',
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  mzk_manager: 'МЗК',
  mentor: 'Ментор',
}

const CATEGORY_LABELS: Record<string, string> = {
  student: 'Студент', parent: 'Родитель', deadline: 'Сроки', quality: 'Качество',
  specialist_change: 'Смена специалиста', communication: 'Коммуникация', refund: 'Возврат',
  suggestion: 'Предложение', other: 'Другое',
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const WorkspaceComplaintsPage: React.FC = () => {
  const { can } = useAuth()
  const isManager = can('complaints', 'manage')
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [mineOnly, setMineOnly] = useState(false)
  const [creating, setCreating] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'complaints', statusFilter, mineOnly],
    queryFn: () =>
      complaintsApi.list({
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        // "me" is resolved server-side, so the client needn't know its user id.
        ...(mineOnly ? { assigned_to: 'me' } : {}),
      }),
  })
  const complaints = data?.items ?? []
  const openCount = complaints.filter((complaint) => complaint.status === 'new' || complaint.status === 'in_progress').length
  const overdueCount = complaints.filter((complaint) => complaint.is_sla_breached).length
  const highRiskCount = complaints.filter((complaint) => complaint.risk_level === 'high').length

  const { data: detail } = useQuery({
    queryKey: ['workspace', 'complaint', selectedId],
    queryFn: () => complaintsApi.get(selectedId as string),
    enabled: Boolean(selectedId),
  })

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-w-accentText">Контроль качества</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-w-ink">Книга обращений</h1>
          <p className="mt-2 max-w-[620px] text-sm leading-6 text-w-muted">Одна очередь для жалоб и рекомендаций: сначала просроченные и рискованные кейсы, затем обычные обращения.</p>
        </div>
        {/* Писать может любая роль — ментор в том числе, и про своего студента. */}
        <AppButton colorPrefix="w" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Создать обращение
        </AppButton>
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Открытые', value: openCount, hint: 'требуют действия', icon: <Inbox className="h-4 w-4" />, tone: 'text-w-accentText' },
          { label: 'Просроченные', value: overdueCount, hint: 'SLA больше 24 часов', icon: <Clock3 className="h-4 w-4" />, tone: overdueCount ? 'text-w-danger' : 'text-w-muted' },
          { label: 'Юр. риск', value: highRiskCount, hint: 'нужна эскалация', icon: <ShieldAlert className="h-4 w-4" />, tone: highRiskCount ? 'text-w-danger' : 'text-w-muted' },
          { label: 'В выборке', value: complaints.length, hint: 'по текущему фильтру', icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-w-ink' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-card border border-w-line bg-w-panel px-4 py-3">
            <div className="flex items-center justify-between text-w-muted2">
              <span className="text-2xs font-black uppercase tracking-[0.16em]">{stat.label}</span>
              <span className={stat.tone}>{stat.icon}</span>
            </div>
            <p className={`mt-2 font-display text-2xl font-black ${stat.tone}`}>{stat.value}</p>
            <p className="mt-0.5 text-2xs text-w-muted2">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-card border border-w-line bg-w-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs
          colorPrefix="w"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as ComplaintStatus | 'all')}
          tabs={[
            { value: 'all', label: 'Все' },
            { value: 'new', label: 'Новые' },
            { value: 'in_progress', label: 'В работе' },
            { value: 'answered', label: 'Отвечено' },
            { value: 'closed', label: 'Закрыто' },
          ]}
        />
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          className={`h-9 rounded-ctl border px-3 text-xs font-bold transition ${
            mineOnly
              ? 'border-w-accent bg-w-accent text-black'
              : 'border-w-line bg-w-panel2 text-w-muted hover:text-w-ink'
          }`}
        >
          Назначено мне
        </button>
      </div>

      {/* У обращений SLA 24 часа: «Обращений нет» вместо ошибки означает, что
          человек спокойно закрыл вкладку, пока срок горел. */}
      <QueryState
        colorPrefix="w"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={complaints.length === 0}
        empty={<EmptyState colorPrefix="w" icon={<MessageSquareWarning className="h-5 w-5" />} title="Обращений нет" />}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {complaints.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={`rounded-card border bg-w-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-w-accentDim hover:shadow-lg hover:shadow-black/10 ${
                c.is_sla_breached || c.risk_level === 'high' ? 'border-w-danger/40' : 'border-w-line'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-2xs font-black uppercase tracking-[0.14em] text-w-muted2">
                    <span>{c.kind === 'complaint' ? 'Жалоба' : 'Рекомендация'}</span>
                    <span>·</span>
                    <span>{CATEGORY_LABELS[c.category] ?? c.category}</span>
                  </div>
                  <h3 className="font-bold text-w-ink">{c.subject}</h3>
                  {c.student_name && <p className="mt-0.5 text-xs text-w-muted">{c.student_name}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.is_sla_breached && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-w-danger/15 px-2 py-0.5 text-2xs font-bold text-w-danger">
                      <AlertTriangle className="h-3 w-3" /> SLA
                    </span>
                  )}
                  {c.risk_level === 'high' && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-w-danger/15 px-2 py-0.5 text-2xs font-bold text-w-danger">
                      <Gavel className="h-3 w-3" /> Юр. риск
                    </span>
                  )}
                  <span className="rounded-pill bg-w-line px-2 py-0.5 text-2xs font-bold text-w-muted">
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-w-muted">{c.body}</p>
              <p className="mt-2 text-2xs text-w-muted2">{fmt(c.created_at)}{c.author_name ? ` · ${c.author_name}` : ''}</p>
              {c.assignee_name && (
                <p className="mt-1 text-2xs font-bold text-w-accentText">
                  Передано: {c.assignee_name}
                </p>
              )}
            </button>
          ))}
        </div>
      </QueryState>

      {selectedId && detail && (
        <ComplaintDialog complaint={detail} isManager={isManager} onClose={() => setSelectedId(null)} />
      )}

      <CreateComplaintDialog
        open={creating}
        onOpenChange={setCreating}
        withStudentPicker
        colorPrefix="w"
        invalidateKeys={[['workspace', 'complaints']]}
      />
    </div>
  )
}

const ComplaintDialog: React.FC<{ complaint: Complaint; isManager: boolean; onClose: () => void }> = ({ complaint, isManager, onClose }) => {
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')
  const [workflow, setWorkflow] = useState({
    intermediate_answer: complaint.intermediate_answer ?? '',
    final_answer: complaint.final_answer ?? '',
    decision: complaint.decision ?? '',
    confirmation: complaint.confirmation ?? '',
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'complaints'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'complaint', complaint.id] })
  }

  const replyMutation = useMutation({
    mutationFn: () => complaintsApi.reply(complaint.id, reply.trim()),
    onSuccess: () => { setReply(''); invalidate() },
    onError: () => toast({ title: 'Не удалось отправить ответ', variant: 'destructive' }),
  })

  const workflowMutation = useMutation({
    mutationFn: (status?: ComplaintStatus) => complaintsApi.update(complaint.id, { ...workflow, ...(status ? { status } : {}) }),
    onSuccess: invalidate,
    onError: (err) => toast({ title: 'Не удалось сохранить обращение', description: getErrorMessage(err), variant: 'destructive' }),
  })

  // One unfiltered request rather than three by role: /users recomputes the
  // agreement status per call, so three calls would triple that work.
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: isManager,
  })
  const staff = allUsers.filter((u) => u.is_active && u.role !== 'student')

  const assignMutation = useMutation({
    mutationFn: (assigned_to: string | null) => complaintsApi.update(complaint.id, { assigned_to }),
    onSuccess: (_data, assigned_to) => {
      invalidate()
      toast({ title: assigned_to ? 'Обращение передано' : 'Назначение снято' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось передать обращение', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="portal max-h-[85vh] max-w-lg overflow-y-auto border-w-line bg-w-panel text-w-ink">
        <DialogHeader>
          <DialogTitle>{complaint.subject}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-w-ink">{complaint.body}</p>
          <div className="flex flex-wrap gap-2 text-2xs font-bold text-w-muted">
            <span className="rounded-pill bg-w-line px-2 py-1">{CATEGORY_LABELS[complaint.category] ?? complaint.category}</span>
            <span className="rounded-pill bg-w-line px-2 py-1">Заявитель: {complaint.applicant_type}</span>
          </div>
          {(complaint.replies ?? []).map((r) => (
            <div key={r.id} className="rounded-panel border border-w-line bg-w-panel2 p-3">
              <p className="text-xs font-bold text-w-muted">{r.author_name ?? 'Персонал'} · {fmt(r.created_at)}</p>
              <p className="mt-1 text-sm text-w-ink">{r.body}</p>
            </div>
          ))}
          {isManager && (
            <div className="border-t border-w-line pt-3">
              <div className="space-y-2">
                {([
                  ['intermediate_answer', 'Промежуточный ответ'],
                  ['final_answer', 'Итоговый ответ'],
                  ['decision', 'Решение'],
                  ['confirmation', 'Подтверждение'],
                ] as const).map(([field, label]) => (
                  <label key={field} className="block">
                    <span className="mb-1 block text-2xs font-black uppercase tracking-widest text-w-muted2">{label}</span>
                    <textarea
                      value={workflow[field]}
                      onChange={(e) => setWorkflow((current) => ({ ...current, [field]: e.target.value }))}
                      rows={field === 'confirmation' ? 2 : 3}
                      className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink outline-none focus:border-w-accentDim"
                    />
                  </label>
                ))}
                <AppButton colorPrefix="w" disabled={workflowMutation.isPending} onClick={() => workflowMutation.mutate(undefined)}>
                  <Save className="h-4 w-4" /> Сохранить реквизиты
                </AppButton>
              </div>
            </div>
          )}
          {isManager && (
            <div className="border-t border-w-line pt-3">
              <label className="block">
                <span className="mb-1 block text-2xs font-black uppercase tracking-widest text-w-muted2">
                  Передать сотруднику
                </span>
                <select
                  value={complaint.assigned_to ?? ''}
                  disabled={assignMutation.isPending}
                  onChange={(e) => assignMutation.mutate(e.target.value || null)}
                  className="h-9 w-full rounded-ctl border border-w-line bg-w-panel2 px-2.5 text-sm font-bold text-w-ink outline-none"
                >
                  <option value="">Не назначено</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {ROLE_LABELS[u.role] ?? u.role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {isManager && (
            <div className="flex flex-wrap gap-2 border-t border-w-line pt-3">
              {(['new', 'in_progress', 'answered', 'closed'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => workflowMutation.mutate(status)}
                  disabled={workflowMutation.isPending}
                  className={`rounded-full border px-3 py-1 text-2xs font-bold transition ${
                    complaint.status === status
                      ? 'border-w-accent bg-w-accent text-black'
                      : 'border-w-line text-w-muted hover:text-w-ink'
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Ответ…"
              className="h-11 flex-1 rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
            />
            <AppButton colorPrefix="w" disabled={!reply.trim() || replyMutation.isPending} onClick={() => replyMutation.mutate()}>
              <Send className="h-4 w-4" />
            </AppButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
