import type { PortfolioSummary } from '@/api/activities'
import { FocusNote, NowList, PanelTitle } from './PortfolioParts'

/**
 * Портфолио ученика глазами сотрудника: что нужно от ментора, что нужно от
 * ученика (вместе с рекомендациями без решения) и фокус, который ментор правит.
 */
export function PortfolioSummaryCard({ studentId, summary, editable }: {
  studentId: string; summary: PortfolioSummary; editable: boolean
}) {
  const studentActions = summary.actions.filter((a) => a.owner === 'student')
  return <div className="grid items-start gap-4 lg:grid-cols-2">
    <div className="min-w-0 space-y-4">
      <section aria-labelledby={`need-me-${studentId}`} className="space-y-2">
        <PanelTitle id={`need-me-${studentId}`}>Нужно от меня</PanelTitle>
        <NowList actions={summary.mentor_actions} viewer="staff" empty="Ничего не ждёт." />
      </section>
      <section aria-labelledby={`need-student-${studentId}`} className="space-y-2">
        <PanelTitle id={`need-student-${studentId}`}>Нужно от ученика{studentActions.length > 0 && <span className="font-semibold text-ds-muted"> · {studentActions.length}</span>}</PanelTitle>
        <NowList actions={studentActions} viewer="staff" empty="У ученика сейчас нет открытых шагов." />
      </section>
    </div>
    <FocusNote key={summary.focus?.updated_at ?? 'none'} focus={summary.focus} studentId={studentId} editable={editable} />
  </div>
}
