import type { PortfolioSummary } from '@/api/activities'
import { ExperienceStrip, FocusNote, NextDeadlineNote, NowList, PanelTitle, PortfolioNumbers } from './PortfolioParts'

/**
 * Сводка портфолио ученика для сотрудника: те же блоки, что видит ученик, но
 * фокус редактируется, а «Сейчас» — это то, что ждёт ментора.
 */
export function PortfolioSummaryCard({ studentId, summary, catalogPath, editable }: {
  studentId: string; summary: PortfolioSummary; catalogPath: string; editable: boolean
}) {
  return <div className="space-y-4">
    <PortfolioNumbers counts={summary.counts} />
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <FocusNote key={summary.focus?.updated_at ?? 'none'} focus={summary.focus} studentId={studentId} editable={editable} />
        <section aria-labelledby={`waiting-${studentId}`} className="space-y-2">
          <PanelTitle id={`waiting-${studentId}`} hint={summary.counts.waiting_student ? `нужно от ученика: ${summary.counts.waiting_student}` : undefined}>Нужно от меня</PanelTitle>
          <NowList actions={summary.mentor_actions} viewer="staff" empty="С вашей стороны всё сделано." />
        </section>
      </div>
      <div className="min-w-0 space-y-4">
        <section aria-labelledby={`experience-${studentId}`} className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4">
          <PanelTitle id={`experience-${studentId}`} hint="«Подобрать» открывает каталог">Полка</PanelTitle>
          <ExperienceStrip tiles={summary.experience} pickPath={(key) => `${catalogPath}&type=${key}`} />
        </section>
        <NextDeadlineNote deadline={summary.next_deadline} base="/workspace" />
      </div>
    </div>
  </div>
}
