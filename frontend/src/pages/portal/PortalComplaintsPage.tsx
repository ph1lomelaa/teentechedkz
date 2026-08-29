import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, MessageSquareWarning, Plus, Send, X } from 'lucide-react'
import { complaintsApi, Complaint, ComplaintKind } from '@/api/complaints'
import { toast } from '@/hooks/use-toast'
import { PageShell } from '@/components/shared/PageShell'
import { QueryState } from '@/components/shared/QueryState'
import { AppButton, EmptyState } from '@/components/ui'
import { cn } from '@/lib/utils'

const KIND_LABELS: Record<ComplaintKind, string> = {
  complaint: 'Жалоба',
  recommendation: 'Рекомендация',
}

const STATUS_LABELS: Record<Complaint['status'], string> = {
  new: 'Новое',
  in_progress: 'В работе',
  answered: 'Отвечено',
  closed: 'Закрыто',
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

export const PortalComplaintsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal', 'complaints'],
    queryFn: () => complaintsApi.list(),
  })
  const complaints = data?.items ?? []
  const activeCount = complaints.filter((complaint) => complaint.status !== 'closed').length
  const answeredCount = complaints.filter((complaint) => complaint.status === 'answered').length

  const { data: detail } = useQuery({
    queryKey: ['portal', 'complaint', selectedId],
    queryFn: () => complaintsApi.get(selectedId as string),
    enabled: Boolean(selectedId),
  })

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Поддержка</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Мои обращения</h1>
          <p className="mt-2 max-w-[560px] text-sm leading-6 text-p-muted">Здесь хранится история общения с командой. Мы ответим в этом же обращении.</p>
        </div>
        <AppButton onClick={() => setCreating(true)} size="sm" colorPrefix="p">
          <Plus className="w-4 h-4" /> Новое обращение
        </AppButton>
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        <div className="rounded-panel border border-p-line bg-p-panel px-4 py-3">
          <p className="text-2xs font-black uppercase tracking-[0.16em] text-p-muted2">Всего</p>
          <p className="mt-2 font-display text-2xl font-black text-p-text">{complaints.length}</p>
        </div>
        <div className="rounded-panel border border-p-line bg-p-panel px-4 py-3">
          <div className="flex items-center justify-between"><p className="text-2xs font-black uppercase tracking-[0.16em] text-p-muted2">В работе</p><Clock3 className="h-4 w-4 text-p-accent" /></div>
          <p className="mt-2 font-display text-2xl font-black text-p-text">{activeCount}</p>
        </div>
        <div className="rounded-panel border border-p-line bg-p-panel px-4 py-3">
          <div className="flex items-center justify-between"><p className="text-2xs font-black uppercase tracking-[0.16em] text-p-muted2">Есть ответ</p><CheckCircle2 className="h-4 w-4 text-emerald-600" /></div>
          <p className="mt-2 font-display text-2xl font-black text-p-text">{answeredCount}</p>
        </div>
      </div>

      <QueryState
        colorPrefix="p"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={complaints.length === 0}
        empty={(
          <EmptyState
          icon={<MessageSquareWarning className="w-5 h-5" />}
          title="Обращений пока нет"
          description="Если что-то пошло не так или у вас есть идея — напишите нам."
          colorPrefix="p"
        />
        )}
      >
        <div className="mt-6 space-y-2">
          {complaints.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="w-full rounded-panel border border-p-line border-l-4 border-l-p-accent bg-p-panel p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-p-panel2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-extrabold text-p-text">{c.subject}</span>
                <span className="shrink-0 rounded-pill border border-p-line px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-p-muted">
                  {STATUS_LABELS[c.status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-p-muted">{KIND_LABELS[c.kind]} · {fmt(c.created_at)}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-p-muted">{c.body}</p>
            </button>
          ))}
        </div>

      </QueryState>

      {creating && <CreateComplaintDialog onClose={() => setCreating(false)} />}
      {selectedId && detail && (
        <ComplaintDetailDialog
          complaint={detail}
          onClose={() => setSelectedId(null)}
          onReplySent={() => queryClient.invalidateQueries({ queryKey: ['portal', 'complaint', selectedId] })}
        />
      )}
    </PageShell>
  )
}

const CreateComplaintDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ComplaintKind>('complaint')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const mutation = useMutation({
    mutationFn: () => complaintsApi.create({ kind, subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'complaints'] })
      toast({ title: 'Обращение отправлено' })
      onClose()
    },
    onError: () => toast({ title: 'Не удалось отправить обращение', variant: 'destructive' }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-card border border-p-line bg-p-panel p-5 sm:rounded-card">
        <h2 className="font-display text-lg font-black text-p-text">Новое обращение</h2>
        <div className="mt-3 space-y-3">
          <div className="flex rounded-full border border-p-line bg-p-bg p-0.5 text-xs">
            {(['complaint', 'recommendation'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={cn('flex-1 rounded-full px-3 py-1.5 font-semibold transition-colors', kind === value ? 'bg-white text-p-text shadow-sm' : 'text-p-muted')}
              >
                {KIND_LABELS[value]}
              </button>
            ))}
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Тема"
            className="h-11 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Опишите подробнее"
            className="min-h-32 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <AppButton variant="ghost" colorPrefix="p" onClick={onClose}>Отмена</AppButton>
          <AppButton
            colorPrefix="p"
            disabled={!subject.trim() || !body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Отправляем…' : 'Отправить'}
          </AppButton>
        </div>
      </div>
    </div>
  )
}

const ComplaintDetailDialog: React.FC<{ complaint: Complaint; onClose: () => void; onReplySent: () => void }> = ({ complaint, onClose, onReplySent }) => {
  const [reply, setReply] = useState('')
  const mutation = useMutation({
    mutationFn: () => complaintsApi.reply(complaint.id, reply.trim()),
    onSuccess: () => {
      setReply('')
      onReplySent()
    },
    onError: () => toast({ title: 'Не удалось отправить ответ', variant: 'destructive' }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-card border border-p-line bg-p-panel p-5 sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-black text-p-text">{complaint.subject}</h2>
            <p className="mt-1 text-xs text-p-muted">{KIND_LABELS[complaint.kind]} · {STATUS_LABELS[complaint.status]}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-p-muted hover:bg-p-panel2 hover:text-p-text" aria-label="Закрыть обращение"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
          <p className="text-sm text-p-text">{complaint.body}</p>
          {(complaint.replies ?? []).map((r) => (
            <div key={r.id} className="rounded-panel border border-p-line bg-p-panel2 p-3">
              <p className="text-xs font-bold text-p-muted">{r.author_name ?? 'Персонал'} · {fmt(r.created_at)}</p>
              <p className="mt-1 text-sm text-p-text">{r.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Ваш ответ…"
            className="h-11 flex-1 rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand"
          />
          <AppButton colorPrefix="p" disabled={!reply.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            <Send className="h-4 w-4" />
          </AppButton>
        </div>
      </div>
    </div>
  )
}
