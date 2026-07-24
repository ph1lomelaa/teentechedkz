import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { workspaceApi, WorkspaceQuestionnaireItem } from '@/api/workspace'
import { QUESTIONNAIRE_STATUS_LABEL, QuestionnaireStatus } from '@/api/questionnaires'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { useLocalState } from '@/lib/use-local-state'
import { cn, formatDate } from '@/lib/utils'
import { WorkspaceQuestionnaireDialog } from '@/components/workspace/WorkspaceQuestionnaireDialog'
import { AppCard, AppSelect, EmptyState, PageHeader, SegmentedTabs } from '@/components/ui'

type FilterTab = 'all' | QuestionnaireStatus

const TABS: Array<{ value: FilterTab; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'sent', label: 'Отправлены' },
  { value: 'submitted', label: 'На проверке' },
  { value: 'reviewed', label: 'Проверены' },
]

export const WorkspaceQuestionnairesPage: React.FC = () => {
  const { params } = useWorkspaceScope()
  const [tab, setTab] = useLocalState<FilterTab>('workspace:questionnaires:tab', 'all')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:questionnaires:studentFilter', '')
  const [openItem, setOpenItem] = useState<WorkspaceQuestionnaireItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'questionnaires', tab, params],
    queryFn: () => workspaceApi.questionnaires({ ...params, status: tab === 'all' ? undefined : tab }),
  })

  const { data: studentsData } = useQuery({
    queryKey: ['workspace', 'questionnaires', 'students', params],
    queryFn: () => workspaceApi.students(params),
  })

  const items = data?.items ?? []
  const students = (studentsData?.items ?? []).map((item) => item.student)
  const filtered = items.filter((item) => !studentFilter || item.student_id === studentFilter)

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Кабинет ментора"
        title="Анкеты"
        description="Все анкеты ваших студентов — черновики, отправленные, на проверке и проверенные."
        colorPrefix="w"
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs value={tab} onChange={(v) => setTab(v as FilterTab)} tabs={TABS} colorPrefix="w" />
        <AppSelect
          value={studentFilter}
          onChange={(event) => setStudentFilter(event.target.value)}
          colorPrefix="w"
          className="bg-w-panel2 md:min-w-[240px]"
        >
          <option value="">Все студенты</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </AppSelect>
      </div>

      <AppCard colorPrefix="w" className="p-5">
        {isLoading ? (
          <p className="text-sm text-w-muted">Загрузка…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Анкет нет"
            description="Анкеты появляются, когда вы добавляете их к задачам roadmap студента (вкладка «Задачи» → «Открыть анкету»)."
            colorPrefix="w"
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => (
              <QuestionnaireRow key={item.id} item={item} onOpen={() => setOpenItem(item)} />
            ))}
          </div>
        )}
      </AppCard>

      {openItem && openItem.roadmap_task_id && (
        <WorkspaceQuestionnaireDialog
          taskId={openItem.roadmap_task_id}
          taskTitle={openItem.title}
          studentId={openItem.student_id}
          open
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  )
}

function QuestionnaireRow({ item, onOpen }: { item: WorkspaceQuestionnaireItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-panel border border-w-line bg-w-panel2 p-3.5 text-left transition hover:border-w-accentDim"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-w-accent/15 text-w-accentText">
        <ClipboardList className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-w-ink">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-w-muted">
          <span>{item.student_name}</span>
          <span>·</span>
          <span>{item.question_count} вопросов</span>
          {item.submitted_at && (
            <>
              <span>·</span>
              <span>заполнена {formatDate(item.submitted_at)}</span>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
          item.status === 'submitted' && 'bg-w-accent text-black',
          item.status === 'reviewed' && 'bg-w-good/15 text-w-good',
          item.status === 'sent' && 'border border-w-line text-w-muted',
          item.status === 'draft' && 'border border-dashed border-w-line text-w-muted2'
        )}
      >
        {QUESTIONNAIRE_STATUS_LABEL[item.status]}
      </span>
    </button>
  )
}
