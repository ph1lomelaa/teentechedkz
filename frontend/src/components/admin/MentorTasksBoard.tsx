import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import { tasksApi, usersApi } from '@/api'
import type { StudentTask } from '@/types'
import { studentsApi } from '@/api/students'
import { AppButton, AppInput, EmptyState, PageHeader, Pill } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'

type KindFilter = 'all' | 'student' | 'general'
type DueFilter = 'all' | 'overdue' | 'on_track'

const STATUS_LABELS: Record<string, string> = {
  open: 'Открыта',
  awaiting_signature: 'Ждёт подписи регламента',
  in_progress: 'В работе',
  submitted: 'Сдана',
  needs_revision: 'На доработке',
  accepted: 'Принята',
  blocked_by_agreement: 'Заблокирована',
  overdue: 'Просрочена',
  cancelled: 'Отменена',
  done: 'Выполнена',
}

const PENALTY_LABELS: Record<string, string> = {
  yellow: 'жёлтая',
  orange: 'оранжевая',
  red: 'красная',
}

/** Сколько осталось до дедлайна SLA — или насколько уже просрочено. */
export function slaLabel(task: StudentTask): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!task.sla_due_at) return null
  const diffMs = new Date(task.sla_due_at).getTime() - Date.now()
  const hours = Math.round(Math.abs(diffMs) / 3_600_000)
  const human = hours >= 24 ? `${Math.floor(hours / 24)} д ${hours % 24} ч` : `${hours} ч`
  if (diffMs <= 0) return { text: `просрочено на ${human}`, tone: 'bad' }
  return { text: `осталось ${human}`, tone: hours <= 4 ? 'warn' : 'ok' }
}

interface Props {
  colorPrefix?: AdminColorPrefix
  /** Куда ведёт ссылка на карточку студента: в CRM и воркспейсе пути разные. */
  studentHrefBase?: string
}

/**
 * Доска задач менторов для МЗК/админа: кто что делает, что горит, что уже
 * просрочено. Монтируется и в CRM (`ds`), и в воркспейсе (`w`).
 */
export const MentorTasksBoard: React.FC<Props> = ({
  colorPrefix = 'w',
  studentHrefBase = '/workspace/students',
}) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [due, setDue] = useState<DueFilter>('all')
  const [creating, setCreating] = useState(false)

  const { data: mentors } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: async () => {
      const [m, z] = await Promise.all([
        usersApi.list({ role: 'mentor' }),
        usersApi.list({ role: 'mzk_manager' }),
      ])
      return [...m, ...z]
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'board', assigneeId, kind, due],
    queryFn: () =>
      tasksApi.listAll({
        assignee_id: assigneeId || undefined,
        kind,
        overdue: due === 'all' ? undefined : due === 'overdue',
        size: 200,
      }),
  })

  const items = data?.items ?? []
  const overdueCount = useMemo(() => items.filter((i) => i.sla_overdue).length, [items])

  const chip = (active: boolean) =>
    cn(
      'h-9 rounded-ctl border px-3 text-xs font-bold transition',
      active
        ? cn('border-current bg-current/10', t.accentText)
        : cn(t.borderLine, t.muted, 'hover:opacity-80'),
    )

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          colorPrefix={colorPrefix}
          eyebrow="Контроль"
          title="Задачи менторов"
          description="Кто что делает, что горит и что уже просрочено."
        />
        <AppButton colorPrefix={colorPrefix} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />Новая задача
        </AppButton>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className={cn('h-9 rounded-ctl border px-3 text-sm', t.borderLine, t.panel2, t.ink)}
        >
          <option value="">Все исполнители</option>
          {(mentors ?? []).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        {(['all', 'student', 'general'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={chip(kind === k)}>
            {k === 'all' ? 'Все' : k === 'student' ? 'По студенту' : 'Общие'}
          </button>
        ))}

        {(['all', 'overdue', 'on_track'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDue(d)} className={chip(due === d)}>
            {d === 'all' ? 'Любой срок' : d === 'overdue' ? 'Просроченные' : 'В срок'}
          </button>
        ))}

        {overdueCount > 0 && (
          <span className={cn('ml-auto inline-flex items-center gap-1.5 text-xs font-bold', t.danger)}>
            <AlertTriangle className="h-3.5 w-3.5" />
            горит: {overdueCount}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка...</div>
      ) : items.length === 0 ? (
        <EmptyState colorPrefix={colorPrefix} icon={<AlertTriangle className="h-5 w-5" />} title="Задач по этим фильтрам нет" />
      ) : (
        <div className={cn('overflow-x-auto rounded-card border', t.borderLine)}>
          <table className="w-full text-sm">
            <thead>
              <tr className={cn('border-b text-left text-2xs uppercase tracking-wide', t.borderLine, t.muted)}>
                <th className="px-3 py-2">Задача</th>
                <th className="px-3 py-2">Исполнитель</th>
                <th className="px-3 py-2">Студент</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">SLA</th>
              </tr>
            </thead>
            <tbody>
              {items.map((task) => {
                const sla = slaLabel(task)
                return (
                  <tr key={task.id} className={cn('border-b last:border-0', t.borderLine)}>
                    <td className="px-3 py-2">
                      <div className={cn('font-medium', t.ink)}>{task.task_text}</div>
                      {task.sla_penalty_color && (
                        <span className={cn('mt-1 inline-block rounded-pill px-1.5 py-0.5 text-[10px] font-bold', t.dangerSoftBg, t.danger)}>
                          санкция: {PENALTY_LABELS[task.sla_penalty_color] ?? task.sla_penalty_color}
                        </span>
                      )}
                    </td>
                    <td className={cn('px-3 py-2', t.muted)}>{task.assignee_name ?? '—'}</td>
                    <td className={cn('px-3 py-2', t.muted)}>
                      {task.student_id ? (
                        <Link to={`${studentHrefBase}/${task.student_id}`} className="hover:underline">
                          {task.student_name ?? 'студент'}
                        </Link>
                      ) : (
                        <Pill colorPrefix={colorPrefix} tone="neutral">общая</Pill>
                      )}
                    </td>
                    <td className={cn('px-3 py-2', t.muted)}>{STATUS_LABELS[task.status] ?? task.status}</td>
                    <td className="px-3 py-2">
                      {sla ? (
                        <span
                          className={cn(
                            'text-xs font-bold',
                            sla.tone === 'bad' && t.danger,
                            sla.tone === 'warn' && t.accentText,
                            sla.tone === 'ok' && t.muted,
                          )}
                        >
                          {sla.text}
                        </span>
                      ) : (
                        <span className={cn('text-xs', t.muted2)}>без срока</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateMentorTaskDialog
          colorPrefix={colorPrefix}
          mentors={mentors ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}

type AssignMode = 'pick' | 'all_mentors' | 'all_mzk'

const CreateMentorTaskDialog: React.FC<{
  colorPrefix: AdminColorPrefix
  mentors: Array<{ id: string; name: string; role?: string }>
  onClose: () => void
  onCreated: () => void
}> = ({ colorPrefix, mentors, onClose, onCreated }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [text, setText] = useState('')
  const [mode, setMode] = useState<AssignMode>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const [slaHours, setSlaHours] = useState('24')
  const [studentId, setStudentId] = useState('')

  const { data: students } = useQuery({
    queryKey: ['students', 'for-task'],
    queryFn: () => studentsApi.list({ size: 200 }),
  })

  const togglePicked = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.createBulk({
        task_text: text.trim(),
        student_id: studentId || null,
        assignee_ids: mode === 'pick' ? picked : [],
        all_mentors: mode === 'all_mentors',
        all_mzk: mode === 'all_mzk',
        // Пустое поле — задача без срока; иначе SLA в часах.
        sla_hours: slaHours.trim() ? Number(slaHours) : null,
      }),
    onSuccess: (res) => {
      // Часть исполнителей могла не подойти (нет назначения на студента,
      // деактивирован) — рассылка не падает, но об этом надо сказать.
      toast({
        title: `Создано задач: ${res.created_count}`,
        description: res.skipped.length
          ? `Пропущено ${res.skipped.length}: ${res.skipped[0].reason}`
          : undefined,
      })
      onCreated()
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось создать задачу'), variant: 'destructive' }),
  })

  const canSubmit = Boolean(text.trim()) && (mode !== 'pick' || picked.length > 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача ментору</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className={t.muted}>Что нужно сделать</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Например: связаться со студентом и загрузить документы"
              className={cn('mt-1 min-h-[90px] border', t.borderLine, t.panel2, t.ink)}
              autoFocus
            />
          </div>
          <div>
            <Label className={t.muted}>Кому назначить</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {([
                ['pick', 'Выбрать'],
                ['all_mentors', 'Всем менторам'],
                ['all_mzk', 'Всем МЗК'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cn(
                    'h-9 rounded-ctl border px-3 text-xs font-bold transition',
                    mode === value
                      ? cn('border-current bg-current/10', t.accentText)
                      : cn(t.borderLine, t.muted, 'hover:opacity-80'),
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'pick' ? (
              <div className={cn('mt-2 max-h-44 overflow-y-auto rounded-ctl border p-2', t.borderLine, t.panel2)}>
                {mentors.length === 0 ? (
                  <p className={cn('px-1 py-2 text-xs', t.muted)}>Нет доступных исполнителей</p>
                ) : (
                  mentors.map((m) => (
                    <label
                      key={m.id}
                      className={cn('flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm', t.ink)}
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(m.id)}
                        onChange={() => togglePicked(m.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0 truncate">{m.name}</span>
                    </label>
                  ))
                )}
              </div>
            ) : (
              <p className={cn('mt-2 text-xs', t.muted)}>
                Задача уйдёт каждому активному {mode === 'all_mentors' ? 'ментору' : 'МЗК-менеджеру'} —
                своя строка и свой срок SLA у каждого.
              </p>
            )}
            {mode === 'pick' && picked.length > 0 && (
              <p className={cn('mt-1 text-xs', t.muted)}>Выбрано: {picked.length}</p>
            )}
          </div>
          <div>
            <Label className={t.muted}>Студент (пусто — общая задача)</Label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className={cn('mt-1 h-10 w-full rounded-ctl border px-3 text-sm', t.borderLine, t.panel2, t.ink)}
            >
              <option value="">Общая задача</option>
              {(students?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className={t.muted}>Срок, часов (пусто — без срока)</Label>
            <AppInput
              colorPrefix={colorPrefix}
              type="number"
              min={1}
              value={slaHours}
              onChange={(e) => setSlaHours(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={onClose}>Отмена</AppButton>
          <AppButton
            colorPrefix={colorPrefix}
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Создаём...' : 'Создать'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
