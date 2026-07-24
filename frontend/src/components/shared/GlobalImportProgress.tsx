import React from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useImportJobs } from '@/contexts/ImportJobsContext'

// Persistent floating indicator for long-running Notion import/sync jobs.
// Lives above the router (see App.tsx) so it keeps polling and showing progress
// even while the user navigates to a completely different page.

function computePercent(job: { status: string; progress?: { template_index?: number; template_total?: number } } | undefined): number | null {
  if (!job) return null
  if (job.status === 'done') return 100
  const total = job.progress?.template_total
  const index = job.progress?.template_index
  if (!total) return null
  return Math.min(100, Math.round(((index || 0) / total) * 100))
}

function JobCard({
  label,
  link,
  status,
  message,
  percent,
  error,
  onDismiss,
}: {
  label: string
  link: string
  status: 'running' | 'done' | 'failed'
  message?: string
  percent: number | null
  error?: string | null
  onDismiss: () => void
}) {
  return (
    <div className="pointer-events-auto w-80 rounded-panel border border-p-line bg-p-panel shadow-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <Link to={link} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                status === 'running' ? 'bg-amber-500 animate-pulse' : status === 'done' ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs font-semibold text-p-text truncate">{label}</span>
          </div>
          <div className="mt-1 text-[11px] text-p-muted truncate" title={message}>
            {status === 'failed' ? (error || 'Ошибка') : status === 'done' ? 'Готово' : (message || 'Ожидание статуса…')}
          </div>
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="text-p-muted hover:text-p-text shrink-0"
          aria-label="Скрыть"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {status === 'running' && (
        <div className="mt-2 h-1.5 w-full bg-p-bg rounded-full overflow-hidden border border-p-line">
          <div
            className={`h-full bg-amber-500 transition-all ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
            style={percent !== null ? { width: `${percent}%` } : undefined}
          />
        </div>
      )}
    </div>
  )
}

export const GlobalImportProgress: React.FC = () => {
  const {
    roadmapJobId, roadmapJob, setRoadmapJobId,
    knowledgeJobId, knowledgeJob, setKnowledgeJobId,
    questionnaireJobId, questionnaireJob, setQuestionnaireJobId,
  } = useImportJobs()

  const cards: React.ReactNode[] = []

  if (roadmapJobId && roadmapJob) {
    cards.push(
      <JobCard
        key="roadmap"
        label="Импорт roadmap-шаблонов из Notion"
        link="/roadmap-templates"
        status={roadmapJob.status}
        message={roadmapJob.progress?.message}
        percent={computePercent(roadmapJob)}
        error={roadmapJob.error}
        onDismiss={() => setRoadmapJobId(null)}
      />,
    )
  }
  if (knowledgeJobId && knowledgeJob) {
    const lastMessage = knowledgeJob.events?.[knowledgeJob.events.length - 1]?.message
    cards.push(
      <JobCard
        key="knowledge"
        label="Синхронизация базы знаний"
        link="/knowledge-base"
        status={knowledgeJob.status}
        message={lastMessage}
        percent={knowledgeJob.status === 'done' ? 100 : null}
        error={knowledgeJob.error}
        onDismiss={() => setKnowledgeJobId(null)}
      />,
    )
  }
  if (questionnaireJobId && questionnaireJob) {
    const lastMessage = questionnaireJob.events?.[questionnaireJob.events.length - 1]?.message as string | undefined
    cards.push(
      <JobCard
        key="questionnaires"
        label="Синхронизация анкет из Notion"
        link="/roadmap-templates"
        status={questionnaireJob.status}
        message={lastMessage}
        percent={questionnaireJob.status === 'done' ? 100 : null}
        error={questionnaireJob.error}
        onDismiss={() => setQuestionnaireJobId(null)}
      />,
    )
  }

  if (cards.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      {cards}
    </div>
  )
}
