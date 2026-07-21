import React, { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, ChevronRight, CheckCircle2, Clock } from 'lucide-react'
import { questionnairesApi, QUESTIONNAIRE_STATUS_LABEL } from '@/api/questionnaires'
import { PortalQuestionnaireDialog } from '@/components/portal/PortalQuestionnaireDialog'
import { useLocalState } from '@/lib/use-local-state'
import { PageShell } from '@/components/shared/PageShell'

export const PortalQuestionnairesPage: React.FC = () => {
  const [selectedId, setSelectedId] = useLocalState<string | null>('portal:questionnaires:selected', null)

  const { data: questionnaires = [], isLoading } = useQuery({
    queryKey: ['portal', 'questionnaires'],
    queryFn: questionnairesApi.mine,
  })

  useEffect(() => {
    if (selectedId && !questionnaires.some((q) => q.id === selectedId)) {
      setSelectedId(null)
    }
  }, [questionnaires, selectedId, setSelectedId])

  const new_questionnaires = questionnaires.filter((q) => q.status === 'sent')
  const completed = questionnaires.filter((q) => q.status !== 'sent')

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
        <h1 className="mt-2 font-display text-2xl md:text-3xl font-black text-p-text">Анкеты</h1>
        <p className="mt-2 text-sm text-p-muted">
          Заполняй анкеты, которые отправил тебе ментор. Это помогает лучше понять твои цели и ускорить подготовку.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center text-sm text-p-muted">
          Загрузка анкет…
        </div>
      ) : questionnaires.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-p-line bg-p-panel2 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-brand/15 grid place-items-center mx-auto">
            <ClipboardList className="w-6 h-6 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-black text-p-text">Анкет нет</h2>
          <p className="mt-2 text-sm text-p-muted">
            Когда ментор отправит анкету, она появится здесь.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {new_questionnaires.length > 0 && (
            <Section
              title="Требуют заполнения"
              subtitle={`${new_questionnaires.length} анкета`}
              count={new_questionnaires.length}
            >
              {new_questionnaires.map((q) => (
                <QuestionnaireCard
                  key={q.id}
                  questionnaire={q}
                  onClick={() => setSelectedId(q.id)}
                  isNew
                />
              ))}
            </Section>
          )}

          {completed.length > 0 && (
            <Section
              title="Заполненные"
              subtitle={`${completed.length} анкета`}
              count={completed.length}
            >
              {completed.map((q) => (
                <QuestionnaireCard
                  key={q.id}
                  questionnaire={q}
                  onClick={() => setSelectedId(q.id)}
                />
              ))}
            </Section>
          )}
        </div>
      )}

      {selectedId && (
        <PortalQuestionnaireDialog
          questionnaireId={selectedId}
          open={true}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string
  subtitle?: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-sm font-black uppercase tracking-[0.16em] text-p-text">
            {title}
          </h2>
          {count !== undefined && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-bold">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-p-muted">{subtitle}</p>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function QuestionnaireCard({
  questionnaire,
  onClick,
  isNew,
}: {
  questionnaire: any
  onClick: () => void
  isNew?: boolean
}) {
  const statusLabel = QUESTIONNAIRE_STATUS_LABEL[questionnaire.status as keyof typeof QUESTIONNAIRE_STATUS_LABEL]

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 border border-p-line rounded-[16px] bg-p-panel p-4 text-left hover:bg-p-panel2 transition-colors"
    >
      <div className={`w-10 h-10 rounded-[12px] grid place-items-center shrink-0 ${isNew ? 'bg-brand/20' : 'bg-brand/10'}`}>
        {isNew ? (
          <Clock className={`w-5 h-5 ${isNew ? 'text-brand' : 'text-brand/60'}`} />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-brand/60" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-extrabold text-p-text">{questionnaire.title}</div>
        {questionnaire.description && (
          <div className="text-[12px] text-p-muted mt-0.5 truncate">
            {questionnaire.description}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold ${
            isNew
              ? 'bg-brand/15 text-brand'
              : 'bg-p-line text-p-muted'
          }`}>
            {statusLabel}
          </span>
          <span className="text-[11px] text-p-muted2">
            {questionnaire.questions?.length} вопросов
          </span>
        </div>
      </div>

      <ChevronRight className="w-4 h-4 text-p-muted shrink-0" />
    </button>
  )
}
