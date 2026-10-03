import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import { tasksApi, usersApi } from '@/api'
import type { StudentTask } from '@/types'
import { AppButton, AppSelect, EmptyState, PageHeader, Pill } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'
import { QueryState } from '@/components/shared/QueryState'
import { CreateTaskDialog } from '@/components/shared/CreateTaskDialog'

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
        usersApi.list({ role: 'mentor', is_active: true }),
        usersApi.list({ role: 'mzk_manager', is_active: true }),
      ])
      return [...m, ...z]
    },
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
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

      {/* «Задач по этим фильтрам нет» на упавшем запросе гнало крутить фильтры. */}
      <QueryState
        isLoading={isLoading}
        colorPrefix={colorPrefix}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={items.length === 0}
        empty={(
          <EmptyState colorPrefix={colorPrefix} icon={<AlertTriangle className="h-5 w-5" />} title="Задач по этим фильтрам нет" />
        )}
      >
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
      </QueryState>

      {creating && (
        <CreateTaskDialog
          colorPrefix={colorPrefix}
          initialKind="staff"
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
