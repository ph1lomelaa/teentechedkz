import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ClipboardList, FileUp, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STATUS_LABEL,
  formatDue,
  isClosed,
  relativeDue,
  type SortDir,
  type SortKey,
  type WorkItem,
} from './workItems'

/** Колонки: задача · студент · срок · статус · действие. На узком экране строка складывается в две линии. */
const GRID = 'xl:grid xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_9.5rem_6.5rem_18.5rem] xl:items-center xl:gap-4'

export interface RowActions {
  /** Ключ строки, по которой сейчас идёт запрос: кнопки блокируются, чтобы не слать дубль. */
  busyKey: string | null
  onToggleRoadmap: (item: WorkItem) => void
  onApproveRoadmap: (item: WorkItem) => void
  onReview: (item: WorkItem, decision: 'accept' | 'return') => void
  onDelegatedStatus: (item: WorkItem, status: 'in_progress' | 'submitted') => void
  onEvidence: (item: WorkItem) => void
  onQuestionnaire: (item: WorkItem) => void
  /** Открыть боковую панель с подробностями. */
  onOpen: (item: WorkItem) => void
}

const BTN =
  'whitespace-nowrap rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-ink transition hover:border-w-accentDim disabled:cursor-wait disabled:opacity-60'
// Сплошной акцент — только у решения проверяющего: чёрный на жёлтом читается в обеих темах.
const BTN_PRIMARY =
  'whitespace-nowrap rounded-ctl bg-w-accent px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60'

const SortHead: React.FC<{
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}> = ({ label, sortKey, active, dir, onSort }) => {
  const isActive = active === sortKey
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Сортировать: ${label}`}
      className={cn(
        'inline-flex items-center gap-1 text-left uppercase tracking-wider transition hover:text-w-ink',
        isActive ? 'text-w-ink' : 'text-w-muted2',
      )}
    >
      {label}
      {isActive && <Icon className="h-3 w-3" aria-hidden />}
    </button>
  )
}

const DueCell: React.FC<{ item: WorkItem }> = ({ item }) => {
  if (!item.due) return <span className="text-xs text-w-muted2">Без срока</span>
  const late = item.overdueDays > 0
  const closed = isClosed(item.status)
  return (
    <div className="leading-tight">
      <div className={cn('text-sm font-bold tabular-nums', late ? 'text-w-danger' : closed ? 'text-w-muted' : 'text-w-ink')}>
        {formatDue(item.due)}
      </div>
      {!closed && (
        <div className={cn('mt-0.5 text-2xs', late ? 'text-w-danger' : 'text-w-muted2')}>{relativeDue(item)}</div>
      )}
    </div>
  )
}

const StatusCell: React.FC<{ item: WorkItem }> = ({ item }) => (
  <div className="leading-tight">
    <span
      className={cn(
        'text-xs font-bold',
        item.status === 'review' || item.status === 'revision' ? 'text-w-accentText' : 'text-w-muted',
      )}
    >
      {STATUS_LABEL[item.status]}
    </span>
    {item.blocked && <div className="mt-0.5 text-2xs text-w-muted2">ждёт подписи регламента</div>}
  </div>
)

export const ActionCell: React.FC<{ item: WorkItem; actions: RowActions }> = ({ item, actions }) => {
  const busy = actions.busyKey === item.key

  if (item.kind === 'roadmap') {
    if (item.status === 'review') {
      return (
        <>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => actions.onApproveRoadmap(item)}>
            Принять
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => actions.onReview(item, 'return')}>
            Вернуть
          </button>
        </>
      )
    }
    const closed = isClosed(item.status)
    return (
      <button type="button" className={BTN} disabled={busy} onClick={() => actions.onToggleRoadmap(item)}>
        {closed ? 'Вернуть в работу' : 'Выполнено'}
      </button>
    )
  }

  const task = item.delegated
  const docs = (task?.required_documents?.length ?? 0) > 0
  return (
    <>
      {item.raw === 'open' && task?.assignee_id && (
        <button type="button" className={BTN} disabled={busy} onClick={() => actions.onDelegatedStatus(item, 'in_progress')}>
          В работу
        </button>
      )}
      {item.raw === 'in_progress' && (
        <button type="button" className={BTN} disabled={busy} onClick={() => actions.onDelegatedStatus(item, 'submitted')}>
          На проверку
        </button>
      )}
      {item.raw === 'submitted' && (
        <>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => actions.onReview(item, 'accept')}>
            Принять
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => actions.onReview(item, 'return')}>
            На доработку
          </button>
        </>
      )}
      {docs && !isClosed(item.status) && (
        <button type="button" className={BTN} onClick={() => actions.onEvidence(item)}>
          Файлы
        </button>
      )}
    </>
  )
}

const Row: React.FC<{ item: WorkItem; actions: RowActions }> = ({ item, actions }) => {
  const closed = isClosed(item.status)
  const roadmap = item.roadmap
  return (
    <li
      className={cn(
        'border-b border-w-line px-4 py-3 last:border-b-0 xl:py-3.5',
        GRID,
        item.overdueDays > 0 && 'bg-w-danger/[0.04]',
      )}
    >
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => actions.onOpen(item)}
          aria-label={`Открыть задачу: ${item.title}`}
          className={cn(
            'text-left text-sm font-bold leading-snug hover:underline hover:decoration-w-muted2 hover:underline-offset-2',
            closed ? 'text-w-muted line-through decoration-w-muted2' : 'text-w-ink',
          )}
        >
          {item.title}
        </button>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-w-muted">
          <span>{item.kind === 'roadmap' ? `Roadmap · ${item.context}` : item.context}</span>
          {roadmap && roadmap.subtasks_total > 0 && (
            <span className="tabular-nums">подзадач {roadmap.subtasks_done}/{roadmap.subtasks_total}</span>
          )}
          {roadmap?.needs_document && (
            <span className="inline-flex items-center gap-1 text-w-muted2"><FileUp className="h-3 w-3" aria-hidden />документ</span>
          )}
          {roadmap?.needs_zoom && (
            <span className="inline-flex items-center gap-1 text-w-muted2"><Video className="h-3 w-3" aria-hidden />zoom</span>
          )}
          {roadmap?.has_questionnaire && (
            <button
              type="button"
              onClick={() => actions.onQuestionnaire(item)}
              className="inline-flex items-center gap-1 font-bold text-w-accentText hover:underline"
            >
              <ClipboardList className="h-3 w-3" aria-hidden />анкета
            </button>
          )}
          {item.marker && <span className="font-bold text-w-accentText">{item.marker}</span>}
        </p>
      </div>

      <div className="mt-2 min-w-0 text-sm xl:mt-0">
        {item.studentId ? (
          <Link
            to={`/workspace/students/${item.studentId}${item.kind === 'roadmap' ? '#roadmap' : ''}`}
            title={item.studentName || undefined}
            className="block truncate font-bold text-w-ink hover:text-w-accentText"
          >
            {item.studentName || 'Студент'}
          </Link>
        ) : (
          <span className="text-w-muted2">Общая задача</span>
        )}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3 xl:mt-0 xl:block">
        <DueCell item={item} />
        <div className="xl:hidden"><StatusCell item={item} /></div>
      </div>

      <div className="hidden xl:block"><StatusCell item={item} /></div>

      <div className="mt-3 flex flex-wrap gap-2 xl:mt-0 xl:justify-end">
        <ActionCell item={item} actions={actions} />
      </div>
    </li>
  )
}

export const TaskQueue: React.FC<{
  items: WorkItem[]
  actions: RowActions
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}> = ({ items, actions, sortKey, sortDir, onSort }) => (
  <div className="overflow-hidden rounded-card border border-w-line bg-w-panel">
    <div
      className={cn(
        'hidden border-b border-w-line bg-w-panel2 px-4 py-2.5 text-2xs font-bold uppercase tracking-wider',
        GRID,
      )}
      role="row"
    >
      <SortHead label="Задача" sortKey="title" active={sortKey} dir={sortDir} onSort={onSort} />
      <SortHead label="Студент" sortKey="student" active={sortKey} dir={sortDir} onSort={onSort} />
      <SortHead label="Срок" sortKey="due" active={sortKey} dir={sortDir} onSort={onSort} />
      <span className="text-w-muted2">Статус</span>
      <span className="text-right text-w-muted2">Действие</span>
    </div>
    <ul>
      {items.map((item) => (
        <Row key={item.key} item={item} actions={actions} />
      ))}
    </ul>
  </div>
)
