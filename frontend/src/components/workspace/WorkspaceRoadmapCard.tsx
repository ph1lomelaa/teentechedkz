import type { ReactNode } from 'react'
import { Route } from 'lucide-react'
import type { Roadmap } from '@/api/roadmap'
import { WorkspaceRoadmapEditor } from '@/components/workspace/WorkspaceRoadmapEditor'
import { formatDeadline } from '@/lib/roadmapDeadline'
import { roadmapDeadlineSummary } from '@/lib/roadmapSummary'
import { AppCard, EmptyState, Pill } from '@/components/ui'

/** The original card from /workspace/roadmap, shared verbatim with student details. */
export function WorkspaceRoadmapCard({ studentName, roadmap, onChanged, canManage = true, actions, emptyAction }: {
  studentName: string
  roadmap: Roadmap | null
  onChanged: (updated: Roadmap) => void
  canManage?: boolean
  actions?: ReactNode
  emptyAction?: ReactNode
}) {
  const deadlines = roadmapDeadlineSummary(roadmap)
  return (
    <AppCard colorPrefix="w" className="roadmap-ui min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-w-line pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 shrink-0 text-w-accentText" />
            <h2 className="truncate font-display text-lg font-black text-w-ink">{studentName}</h2>
          </div>
          <div className="mt-1 truncate text-xs text-w-muted">{roadmap?.name || 'Roadmap не назначен'}</div>
        </div>
        {roadmap && (
          <Pill colorPrefix="w">
            {roadmap.country_flag_emoji ? `${roadmap.country_flag_emoji} ` : ''}
            {roadmap.country_name || 'Страна не указана'}
          </Pill>
        )}
      </div>
      {actions && <div className="mb-3">{actions}</div>}
      {roadmap && <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Boolean(deadlines.overdue) && <span data-roadmap-deadline="overdue" className="rounded-full bg-red-500/15 px-2 py-1 font-bold text-red-600">Просрочено: {deadlines.overdue}</span>}
        {Boolean(deadlines.next7) && <span data-roadmap-deadline="soon" className="rounded-full bg-amber-500/15 px-2 py-1 font-bold text-amber-600">7 дней: {deadlines.next7}</span>}
        {Boolean(deadlines.withoutDate) && <span className="rounded-full bg-w-panel2 px-2 py-1 text-w-muted">Без срока: {deadlines.withoutDate}</span>}
        {deadlines.nearest && <span className="rounded-full bg-w-panel2 px-2 py-1 text-w-muted">Ближайший: {formatDeadline(deadlines.nearest)}</span>}
      </div>}
      {roadmap ? (
        <WorkspaceRoadmapEditor key={roadmap.id} roadmap={roadmap} canManage={canManage} onChanged={onChanged} />
      ) : (
        <>
          <EmptyState colorPrefix="w" icon={<Route className="h-5 w-5" />} title="Roadmap не назначен"
            description={emptyAction ? 'Выберите шаблон, чтобы назначить дорожную карту студенту.' : 'Назначение roadmap будет добавлено в кабинет отдельным действием.'} />
          {emptyAction}
        </>
      )}
    </AppCard>
  )
}
