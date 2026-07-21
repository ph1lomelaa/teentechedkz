import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CheckSquare, ClipboardList } from 'lucide-react'
import { roadmapApi, FlatTask } from '@/api/roadmap'
import { questionnairesApi, QUESTIONNAIRE_STATUS_LABEL } from '@/api/questionnaires'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import { cn } from '@/lib/utils'
import { useLocalState } from '@/lib/use-local-state'

const PRIORITY_LABEL: Record<string, string> = {
  required: 'Обязательно',
  recommended: 'Желательно',
  optional: 'По желанию',
}

type TaskTab = 'open' | 'done'

function isOverdue(t: FlatTask): boolean {
  if (!t.due_date || t.status === 'done') return false
  return new Date(t.due_date) < new Date(new Date().toDateString())
}

function byDue(a: FlatTask, b: FlatTask): number {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999')
}

export const PortalTasksPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['portal', 'tasks'],
    queryFn: roadmapApi.myTasks,
  })
  const [tab, setTab] = useLocalState<TaskTab>('portal:tasks:tab', 'open')
  const [openQ, setOpenQ] = React.useState<string | null>(null)
  const { data: questionnaires = [] } = useQuery({
    queryKey: ['portal', 'questionnaires'],
    queryFn: questionnairesApi.mine,
  })

  const toggle = useMutation({
    mutationFn: (t: FlatTask) =>
      roadmapApi.updateTask(t.id, { status: t.status === 'done' ? 'planned' : 'done' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'roadmap'] })
    },
  })

  const open = tasks.filter((t) => t.status !== 'done').sort(byDue)
  const done = tasks.filter((t) => t.status === 'done').sort(byDue)
  const list = tab === 'open' ? open : done

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Задачи</h1>

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
                  'flex w-full items-center gap-3 rounded-[13px] border bg-p-panel2 p-3 text-left transition hover:border-brand',
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
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="w-11 h-11 rounded-[13px] bg-brand/15 grid place-items-center mx-auto">
            <CheckSquare className="w-5 h-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Задач пока нет</h2>
          <p className="mt-1.5 text-sm text-p-muted">
            Задачи появятся, когда ментор назначит вам дорожную карту.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 inline-flex rounded-[12px] border border-p-line bg-p-panel p-1">
            <Tab active={tab === 'open'} onClick={() => setTab('open')}>Открытые · {open.length}</Tab>
            <Tab active={tab === 'done'} onClick={() => setTab('done')}>Выполненные · {done.length}</Tab>
          </div>

          {list.length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
              {tab === 'open' ? 'Открытых задач нет — всё сделано 🎉' : 'Выполненных задач пока нет.'}
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((t) => (
                <TaskCard key={t.id} task={t} onToggle={() => toggle.mutate(t)} />
              ))}
            </div>
          )}
        </>
      )}

      {openQ && (
        <PortalQuestionnaireDialog questionnaireId={openQ} open onClose={() => setOpenQ(null)} />
      )}
    </div>
  )
}

const Tab: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'rounded-lg px-4 py-2 text-[12.5px] font-bold transition-colors',
      active ? 'bg-brand text-black' : 'text-p-muted hover:text-p-text'
    )}
  >
    {children}
  </button>
)

const TaskCard: React.FC<{ task: FlatTask; onToggle: () => void }> = ({ task, onToggle }) => {
  const done = task.status === 'done'
  const overdue = isOverdue(task)
  const subDone = task.subtasks.filter((s) => s.is_done).length
  return (
    <div className="flex items-start gap-3 border border-p-line rounded-[13px] bg-p-panel2 p-3 transition-transform hover:translate-x-1">
      <button
        onClick={onToggle}
        className={cn(
          'w-[18px] h-[18px] rounded-[5px] grid place-items-center border shrink-0 mt-0.5',
          done ? 'bg-brand border-brand text-black' : 'bg-p-panel border-p-line text-transparent'
        )}
        aria-label={done ? 'Снять отметку' : 'Отметить готовым'}
      >
        <Check className="w-3 h-3" strokeWidth={3.2} />
      </button>
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-bold', done ? 'line-through text-p-muted2' : 'text-p-text')}>
          {task.title}
        </div>
        <div className="flex items-center gap-2.5 mt-1 text-[11.5px] flex-wrap">
          <span className="text-p-muted">{task.stage_name}</span>
          {task.due_date && (
            <span className={cn('tabular-nums', overdue ? 'text-brand font-bold' : 'text-p-muted')}>
              до {task.due_date}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="text-p-muted">
              {subDone}/{task.subtasks.length} подзадач
            </span>
          )}
        </div>
      </div>
      <span
        className={cn(
          'text-[9px] font-bold uppercase tracking-wide px-1.5 py-1 rounded shrink-0',
          task.priority === 'required' && 'bg-brand text-black',
          task.priority === 'recommended' && 'border border-brand/60 text-brand',
          task.priority === 'optional' && 'border border-p-line text-p-muted'
        )}
      >
        {PRIORITY_LABEL[task.priority] || task.priority}
      </span>
    </div>
  )
}
