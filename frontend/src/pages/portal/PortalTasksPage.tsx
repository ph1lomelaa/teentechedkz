import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, ClipboardList, Search } from 'lucide-react'
import { roadmapApi, FlatTask } from '@/api/roadmap'
import { questionnairesApi, QUESTIONNAIRE_STATUS_LABEL } from '@/api/questionnaires'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import {
  ClaimCheckbox,
  MentorComment,
  ReviewChip,
  useReviewLiveUpdates,
  useTaskClaim,
} from '@/components/portal/PortalRoadmap'
import { cn } from '@/lib/utils'
import { PageShell } from '@/components/shared/PageShell'
import { useLocalState } from '@/lib/use-local-state'
import { SegmentedTabs, EmptyState, PriorityPill, StatusPill } from '@/components/ui'

type TaskTab = 'open' | 'pending' | 'done'

function isOverdue(t: FlatTask): boolean {
  if (!t.due_date || t.status === 'done') return false
  return new Date(t.due_date) < new Date(new Date().toDateString())
}

function byDue(a: FlatTask, b: FlatTask): number {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999')
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

const EMPTY_TAB_TEXT: Record<TaskTab, string> = {
  open: 'Открытых задач нет — всё сделано.',
  pending: 'На проверке ничего нет — отмечайте готовые задачи, и они появятся здесь.',
  done: 'Выполненных задач пока нет.',
}

export const PortalTasksPage: React.FC = () => {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['portal', 'tasks'],
    queryFn: roadmapApi.myTasks,
  })
  const [tab, setTab] = useLocalState<TaskTab>('portal:tasks:tab', 'open')
  const [search, setSearch] = useLocalState('portal:tasks:search', '')
  const [openQ, setOpenQ] = React.useState<string | null>(null)
  const { data: questionnaires = [] } = useQuery({
    queryKey: ['portal', 'questionnaires'],
    queryFn: questionnairesApi.mine,
  })

  // Заявки о выполнении (одна/две галочки) + live-вердикты ментора
  const { claim, unclaim } = useTaskClaim()
  useReviewLiveUpdates()

  // Три группы двухосевой модели: заявленные задачи покидают «открытые»
  const open = tasks.filter((t) => t.status !== 'done' && t.review_status !== 'pending').sort(byDue)
  const pending = tasks.filter((t) => t.status !== 'done' && t.review_status === 'pending').sort(byDue)
  const done = tasks.filter((t) => t.status === 'done').sort(byDue)
  const list = (tab === 'open' ? open : tab === 'pending' ? pending : done).filter((t) =>
    t.title.toLowerCase().includes(search.trim().toLowerCase())
  )
  const grouped = list.reduce<Record<string, FlatTask[]>>((acc, task) => {
    const key = task.stage_name || 'Без этапа'
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})
  const orderedGroups = Object.entries(grouped).sort((a, b) => {
    const pa = a[1][0]?.stage_position ?? 9999
    const pb = b[1][0]?.stage_position ?? 9999
    return pa - pb
  })

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Scrum-доска пути</p>
      <div className="mt-2 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="font-display text-[40px] leading-none font-black tracking-tight text-p-text">Задачи</h1>
        <label className="relative sm:ml-auto w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-p-muted2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="h-10 w-full rounded-ctl border border-p-line bg-p-panel2 pl-9 pr-3 text-[12px] text-p-text placeholder:text-p-muted2 focus:border-p-accent-dim focus:outline-none"
          />
        </label>
      </div>

      {questionnaires.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 font-display text-xs font-black uppercase tracking-[0.18em] text-p-muted">Анкеты</h2>
          <div className="space-y-2">
            {questionnaires.map((qn) => (
              <button
                key={qn.id}
                type="button"
                onClick={() => setOpenQ(qn.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-panel border bg-p-panel2 p-3 text-left transition hover:border-brand',
                  qn.status === 'sent' ? 'border-brand/60' : 'border-p-line'
                )}
              >
                <ClipboardList className="h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-p-text">{qn.title}</div>
                  <div className="text-[11.5px] text-p-muted">{QUESTIONNAIRE_STATUS_LABEL[qn.status]}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-[11px] font-black',
                    qn.status === 'reviewed' ? 'border border-p-line text-p-muted' : 'bg-brand text-black'
                  )}
                >
                  {qn.status === 'sent' ? 'Заполнить' : 'Посмотреть ответы'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="w-5 h-5" />}
          title="Задач пока нет"
          description="Задачи появятся, когда ментор назначит вам дорожную карту."
          colorPrefix="p"
        />
      ) : (
        <>
          <SegmentedTabs
            className="mb-5"
            tabs={[
              { value: 'open', label: `Открытые · ${open.length}` },
              { value: 'pending', label: `На проверке · ${pending.length}` },
              { value: 'done', label: `Выполненные · ${done.length}` }
            ]}
            value={tab}
            onChange={(value) => setTab(value as TaskTab)}
          />

          {list.length === 0 ? (
            <div className="rounded-card border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
              {search.trim() ? 'По вашему запросу задачи не найдены.' : EMPTY_TAB_TEXT[tab]}
            </div>
          ) : (
            <div className="space-y-5">
              {orderedGroups.map(([stageName, stageTasks]) => (
                <section key={stageName}>
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className="h-4 w-1 rounded bg-p-accent" />
                    <b className="font-display text-[27px] font-extrabold leading-none text-p-text">{stageName}</b>
                    <span className="rounded-full bg-p-line/80 px-2.5 py-0.5 text-[10px] font-bold text-p-muted2">
                      {stageTasks.length} {plural(stageTasks.length, ['задача', 'задачи', 'задач'])}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {stageTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClaim={() => claim.mutate(task.id)}
                        onUnclaim={() => unclaim.mutate(task.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {openQ && (
        <PortalQuestionnaireDialog questionnaireId={openQ} open onClose={() => setOpenQ(null)} />
      )}
    </PageShell>
  )
}

const TaskCard: React.FC<{ task: FlatTask; onClaim: () => void; onUnclaim: () => void }> = ({
  task,
  onClaim,
  onUnclaim,
}) => {
  const done = task.status === 'done'
  const pending = !done && task.review_status === 'pending'
  const returned = !done && !pending && task.review_status === 'returned'
  const overdue = isOverdue(task)
  const doneSubtasks = task.subtasks.filter((s) => s.is_done).length
  const meta = done
    ? `Этап: ${task.stage_name} · выполнено`
    : task.due_date
      ? `Этап: ${task.stage_name} · дедлайн ${formatDate(task.due_date)}`
      : `Этап: ${task.stage_name} · без дедлайна`
  return (
    <div className="flex items-center gap-3.5 rounded-panel border border-p-line bg-p-panel2 px-3.5 py-3 transition hover:border-p-accent-dim">
      <ClaimCheckbox task={task} size="sm" onClaim={onClaim} onUnclaim={onUnclaim} />
      <div className="flex-1 min-w-0">
        <div className={cn('truncate text-[15px] font-bold', done ? 'text-p-muted2' : 'text-p-text')}>
          {task.title}
        </div>
        <small className={cn('mt-0.5 block truncate text-[11px]', overdue ? 'text-p-danger' : 'text-p-muted')}>
          {meta}
        </small>
        {pending && (
          <small className="mt-0.5 block text-[11px] text-brand/90">
            Ментор проверит и подтвердит — обычно в течение 1–2 дней
          </small>
        )}
        {returned && task.review_comment && <MentorComment comment={task.review_comment} />}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {task.subtasks.length > 0 && (
          <span className="text-[11px] font-semibold text-p-muted2">
            {doneSubtasks}/{task.subtasks.length}
          </span>
        )}
        <ReviewChip task={task} className="shrink-0" />
        <PriorityPill
          priority={task.priority as 'required' | 'recommended' | 'optional'}
          colorPrefix="p"
          showIcon={false}
          className="shrink-0"
        />
        <StatusPill status={task.status} colorPrefix="p" className="shrink-0" showIcon={false} />
      </div>
    </div>
  )
}

function formatDate(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}
