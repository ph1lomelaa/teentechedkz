import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import { tasksApi, usersApi } from '@/api'
import type { StudentTask } from '@/types'
import { studentsApi } from '@/api/students'
import { AppButton, AppInput, AppSelect, EmptyState, PageHeader, Pill, SegmentedTabs } from '@/components/ui'
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

  // `data?.items ?? []` создаёт новый массив на каждый рендер, поэтому зависимость
  // useMemo ниже менялась всегда и подсчёт выполнялся вхолостую. Оборачиваем сам
  // список — тогда и ссылка стабильна, и предупреждение линтера уходит по делу,
  // а не подавлением.
  const items = useMemo(() => data?.items ?? [], [data?.items])
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

      {/* Два независимых фильтра подряд читались одной лентой чипов — развели
          их в отдельные группы с зазором, чтобы было видно, где что. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <AppSelect
          colorPrefix={colorPrefix}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="h-9"
        >
          <option value="">Все исполнители</option>
          {(mentors ?? []).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </AppSelect>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'student', 'general'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={chip(kind === k)}>
              {k === 'all' ? 'Все' : k === 'student' ? 'По студенту' : 'Общие'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'overdue', 'on_track'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDue(d)} className={chip(due === d)}>
              {d === 'all' ? 'Любой срок' : d === 'overdue' ? 'Просроченные' : 'В срок'}
            </button>
          ))}
        </div>

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

// Пустая строка — задача без срока (sla_hours отправится как null).
const SLA_PRESETS = [
  { label: '24 часа', hours: '24' },
  { label: '2 дня', hours: '48' },
  { label: 'Неделя', hours: '168' },
  { label: 'Без срока', hours: '' },
] as const

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
  const [search, setSearch] = useState('')

  const visibleMentors = mentors.filter((m) =>
    m.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

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

  // Рассылка создаёт по задаче на исполнителя — показываем это до нажатия,
  // чтобы «Всем менторам» не оказалось неожиданностью на 20 строк.
  const recipientCount =
    mode === 'pick'
      ? picked.length
      : mentors.filter((m) => (mode === 'all_mzk' ? m.role === 'mzk_manager' : m.role !== 'mzk_manager')).length
  const summary = recipientCount > 1 ? `Создать ${recipientCount} задачи` : 'Создать задачу'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Новая задача ментору</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 1. Что сделать */}
          <section className="space-y-1.5">
            <Label className={cn('text-[11px] font-black uppercase tracking-[0.14em]', t.muted)}>
              Что нужно сделать
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Например: связаться со студентом и загрузить документы"
              className={cn('min-h-[84px] border', t.borderLine, t.panel2, t.ink)}
              autoFocus
            />
          </section>

          {/* 2. Кому — режим рассылки, затем список под выбранный режим. */}
          <section className="space-y-2">
            <Label className={cn('text-[11px] font-black uppercase tracking-[0.14em]', t.muted)}>
              Кому назначить
            </Label>
            <SegmentedTabs
              colorPrefix={colorPrefix}
              value={mode}
              onChange={(value) => setMode(value as AssignMode)}
              className="w-full"
              tabs={[
                { value: 'pick', label: 'Выбрать вручную' },
                { value: 'all_mentors', label: 'Всем менторам' },
                { value: 'all_mzk', label: 'Всем МЗК' },
              ]}
            />

            {mode === 'pick' ? (
              <div className={cn('overflow-hidden rounded-ctl border', t.borderLine)}>
                {mentors.length > 6 && (
                  <div className={cn('border-b p-2', t.borderLine, t.panel2)}>
                    <AppInput
                      colorPrefix={colorPrefix}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Поиск по имени"
                      className="h-9"
                    />
                  </div>
                )}
                <div className={cn('max-h-52 overflow-y-auto p-1.5', t.panel2)}>
                  {visibleMentors.length === 0 ? (
                    <p className={cn('px-2 py-3 text-center text-xs', t.muted)}>
                      {mentors.length === 0 ? 'Нет доступных исполнителей' : 'Никто не найден'}
                    </p>
                  ) : (
                    visibleMentors.map((m) => {
                      const isPicked = picked.includes(m.id)
                      return (
                        <label
                          key={m.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-ctl px-2.5 py-2 text-sm transition',
                            isPicked ? cn('bg-current/10', t.accentText) : cn(t.ink, 'hover:bg-current/5'),
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isPicked}
                            onChange={() => togglePicked(m.id)}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className={cn('min-w-0 flex-1 truncate font-bold', t.ink)}>{m.name}</span>
                          {m.role === 'mzk_manager' && (
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black',
                                t.borderLine,
                                t.muted,
                              )}
                            >
                              МЗК
                            </span>
                          )}
                        </label>
                      )
                    })
                  )}
                </div>
                <div className={cn('flex items-center justify-between border-t px-3 py-2 text-xs', t.borderLine, t.panel2)}>
                  <span className={t.muted}>
                    {picked.length ? `Выбрано: ${picked.length}` : 'Никто не выбран'}
                  </span>
                  {picked.length > 0 && (
                    <button type="button" onClick={() => setPicked([])} className={cn('font-bold', t.accentText)}>
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className={cn('rounded-ctl border px-3 py-2.5 text-xs leading-5', t.borderLine, t.panel2, t.muted)}>
                Задача уйдёт каждому активному {mode === 'all_mentors' ? 'ментору' : 'МЗК-менеджеру'}: своя
                строка и свой срок SLA у каждого.
              </p>
            )}
          </section>

          {/* 3. Контекст и срок — рядом, оба необязательные. */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={cn('text-[11px] font-black uppercase tracking-[0.14em]', t.muted)}>
                По студенту
              </Label>
              <AppSelect
                colorPrefix={colorPrefix}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full"
              >
                <option value="">Общая задача</option>
                {(students?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </AppSelect>
            </div>

            <div className="space-y-1.5">
              <Label className={cn('text-[11px] font-black uppercase tracking-[0.14em]', t.muted)}>
                Срок
              </Label>
              {/* Пресеты вместо ввода часов: «2 дня» читается быстрее, чем «48». */}
              <div className="grid grid-cols-2 gap-1.5">
                {SLA_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSlaHours(preset.hours)}
                    className={cn(
                      'h-9 rounded-ctl border text-xs font-bold transition',
                      slaHours === preset.hours
                        ? cn('border-current bg-current/10', t.accentText)
                        : cn(t.borderLine, t.muted, 'hover:opacity-80'),
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={onClose}>Отмена</AppButton>
          <AppButton
            colorPrefix={colorPrefix}
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Создаём...' : summary}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
