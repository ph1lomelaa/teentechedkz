import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  ExternalLink,
  FileText,
  KeyRound,
  Link2Off,
  MessageCircle,
  Route,
  Send,
  Shield,
  UserRound,
  Users,
} from 'lucide-react'
import { studentsApi } from '@/api/students'
import { roadmapApi, Roadmap, TemplateListItem } from '@/api/roadmap'
import { meetingsApi } from '@/api/meetings'
import { telegramApi } from '@/api/telegram'
import { documentsApi } from '@/api/documents'
import { chatApi } from '@/api/chat'
import { workspaceApi } from '@/api/workspace'
import { syncApi, StudentIntake } from '@/api/sync'
import { notionApi, StudentNotion } from '@/api/notion'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/primitives/accordion'
import { RoadmapHeaderCard } from '@/components/portal/RoadmapHeaderCard'
import { WorkspaceRoadmapEditor } from '@/components/workspace/WorkspaceRoadmapEditor'
import { WorkspaceAccessPanel } from '@/components/workspace/WorkspaceAccessPanel'
import { WorkspaceNotesPanel } from '@/components/workspace/WorkspaceNotesPanel'
import { ChatThread } from '@/components/shared/ChatThread'
import { TelegramGroupManager } from '@/components/shared/TelegramGroupManager'
import { useAuth } from '@/contexts/AuthContext'
import {
  DEGREE_LEVEL_LABELS,
  DOC_TYPE_LABELS,
  PIPELINE_STATUS_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
  ResponsibleUser,
  Service,
  StudentFull,
  TelegramChat,
} from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { AppButton, AppSelect, EmptyState, Pill, SegmentedTabs } from '@/components/ui'

type WorkspaceTab = 'card' | 'roadmap' | 'tasks' | 'meetings' | 'documents' | 'telegram' | 'chat' | 'notes' | 'access'

const tabs: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
  { id: 'card', label: 'Карточка', icon: <UserRound className="h-4 w-4" /> },
  { id: 'roadmap', label: 'Roadmap', icon: <Route className="h-4 w-4" /> },
  { id: 'tasks', label: 'Задачи', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'meetings', label: 'Встречи', icon: <Calendar className="h-4 w-4" /> },
  { id: 'documents', label: 'Документы', icon: <FileText className="h-4 w-4" /> },
  { id: 'telegram', label: 'Telegram', icon: <Send className="h-4 w-4" /> },
  { id: 'chat', label: 'Чат', icon: <MessageCircle className="h-4 w-4" /> },
  { id: 'notes', label: 'Заметки', icon: <Shield className="h-4 w-4" /> },
  { id: 'access', label: 'Доступ', icon: <KeyRound className="h-4 w-4" /> },
]

function tabFromHash(hash: string): WorkspaceTab {
  const raw = hash.replace('#', '')
  if (raw === 'overview' || raw === 'crm' || raw === 'programs') return 'card'
  return tabs.some((tab) => tab.id === raw) ? (raw as WorkspaceTab) : 'card'
}

export const WorkspaceStudentDetailPage: React.FC = () => {
  const { studentId } = useParams<{ studentId: string }>()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { hasRole } = useAuth()
  const canReconcile = hasRole('admin', 'mzk_manager')
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => tabFromHash(location.hash))
  const [newMeetingTitle, setNewMeetingTitle] = useState('')
  const [newMeetingStartsAt, setNewMeetingStartsAt] = useState('')
  const [newMeetingLink, setNewMeetingLink] = useState('')

  useEffect(() => {
    setActiveTab(tabFromHash(location.hash))
  }, [location.hash])

  const { data: student, isLoading } = useQuery({
    queryKey: ['workspace', 'student', studentId],
    queryFn: () => studentsApi.get(studentId!),
    enabled: !!studentId,
  })
  const { data: roadmaps = [] } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'roadmap'],
    queryFn: () => roadmapApi.studentRoadmaps(studentId!),
    enabled: !!studentId,
  })
  const { data: roadmapTemplates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
    enabled: !!studentId,
  })
  const { data: meetings = [] } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'meetings'],
    queryFn: () => meetingsApi.studentMeetings(studentId!),
    enabled: !!studentId,
  })
  const { data: workspaceSummary } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'summary'],
    queryFn: () => workspaceApi.studentSummary(studentId!),
    enabled: !!studentId,
  })
  const { data: telegramChat } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'telegram'],
    queryFn: () => telegramApi.getForStudent(studentId!),
    enabled: !!studentId,
  })
  const { data: telegramMessages = [] } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'telegram-messages', telegramChat?.id],
    queryFn: () => telegramApi.listMessages(telegramChat!.id),
    enabled: !!telegramChat?.id,
  })
  // Сверка анкет (пакет/кейс) и Notion — как в карточке студента в CRM (доступно admin/MZK).
  const { data: intake } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'intake'],
    queryFn: () => syncApi.studentIntake(studentId!),
    enabled: !!studentId && canReconcile,
  })
  const { data: notion } = useQuery({
    queryKey: ['workspace', 'student', studentId, 'notion'],
    queryFn: () => notionApi.studentNotion(studentId!),
    enabled: !!studentId && canReconcile,
  })
  const applyNotionFieldMutation = useMutation({
    mutationFn: (field: string) => notionApi.applyField(studentId!, field),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'notion'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId] })
      toast({ title: 'Значение принято из Notion' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось применить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })
  const unlinkNotionMutation = useMutation({
    mutationFn: (snapshotId: string) => notionApi.unlink(snapshotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'notion'] })
      toast({ title: 'Привязка к Notion снята', description: 'Запись вернулась в «Notion без привязки».' })
    },
    onError: () => toast({ title: 'Не удалось отвязать', variant: 'destructive' }),
  })
  const refreshStudentWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'summary'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'meetings'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'documents'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
    queryClient.invalidateQueries({ queryKey: ['student', studentId] })
    queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  const toggleRoadmapTaskMutation = useMutation({
    mutationFn: (task: { id: string; status: string }) =>
      roadmapApi.updateTask(task.id, { status: task.status === 'done' ? 'planned' : 'done' }),
    onSuccess: refreshStudentWorkspace,
    onError: () =>
      toast({
        title: 'Не удалось обновить roadmap-задачу',
        variant: 'destructive',
      }),
  })

  const toggleDocumentVisibilityMutation = useMutation({
    mutationFn: (doc: { id: string; visible_to_student?: boolean }) =>
      documentsApi.setVisibility(doc.id, !doc.visible_to_student),
    onSuccess: () => {
      refreshStudentWorkspace()
      toast({ title: 'Видимость документа обновлена' })
    },
    onError: () =>
      toast({
        title: 'Не удалось изменить видимость документа',
        variant: 'destructive',
      }),
  })

  const createMeetingMutation = useMutation({
    mutationFn: () => {
      const startsAt = new Date(newMeetingStartsAt)
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
      return meetingsApi.create({
        student_id: studentId!,
        title: newMeetingTitle.trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        meeting_link: newMeetingLink.trim() || undefined,
      })
    },
    onSuccess: () => {
      setNewMeetingTitle('')
      setNewMeetingStartsAt('')
      setNewMeetingLink('')
      refreshStudentWorkspace()
      toast({ title: 'Встреча создана' })
    },
    onError: () =>
      toast({
        title: 'Не удалось создать встречу',
        variant: 'destructive',
      }),
  })

  const roadmapTasks = useMemo(
    () => roadmaps.flatMap((r) => r.stages.flatMap((stage) => stage.tasks.map((task) => ({ ...task, stageName: stage.name })))),
    [roadmaps]
  )
  const nextMeeting = meetings
    .filter((meeting) => meeting.status === 'scheduled' && new Date(meeting.ends_at || meeting.starts_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0]
  const activeResponsibles = student?.responsibles?.filter((r) => r.is_active) ?? []
  const summaryNextMeeting = workspaceSummary?.next_meeting
  const nextMeetingValue = summaryNextMeeting?.starts_at || nextMeeting?.starts_at
  const lastTelegramMessage = telegramMessages[telegramMessages.length - 1]
  const lastContactText =
    lastTelegramMessage?.raw_text || lastTelegramMessage?.message_type || 'Нет сообщений'
  const roadmapRecommendations = useMemo(
    () => student ? recommendRoadmaps(student, roadmapTemplates) : [],
    [roadmapTemplates, student],
  )
  if (isLoading || !student) {
    return <div className="text-sm text-w-muted">Загрузка карточки...</div>
  }

  return (
    <div className="fade-in">
      <Link to="/workspace/students" className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-w-muted transition hover:text-w-accentText">
        <ArrowLeft className="h-4 w-4" />
        Мои студенты
      </Link>

      <header className="mb-6 border-b border-w-line pb-6">
        <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-w-accentText">Карточка студента</div>
        <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-w-ink md:text-4xl">{student.full_name}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge>{DEGREE_LEVEL_LABELS[student.degree_level]}</Badge>
          <Badge>{student.pipeline_status ? PIPELINE_STATUS_LABELS[student.pipeline_status] : 'Статус не указан'}</Badge>
          <Badge>{student.intake_year}</Badge>
          {student.country && <Badge>{student.country}</Badge>}
        </div>
      </header>

      <div className="mb-5 overflow-x-auto rounded-card border border-w-line bg-w-panel p-2">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id)
                window.history.replaceState(null, '', `#${tab.id}`)
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-ctl px-3.5 py-2.5 text-xs font-black transition',
                activeTab === tab.id
                  ? 'bg-w-accent text-black'
                  : 'text-w-muted hover:bg-w-panel2 hover:text-w-ink'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'card' && (
        <CardListView
          student={student}
          responsibles={activeResponsibles}
          nextMeetingValue={nextMeetingValue}
          lastContactText={lastContactText}
          intake={intake}
          notion={notion}
          canReconcile={canReconcile}
          roadmapRecommendations={roadmaps.length === 0 ? roadmapRecommendations : []}
          onOpenRoadmap={() => {
            setActiveTab('roadmap')
            window.history.replaceState(null, '', '#roadmap')
          }}
          onApplyNotionField={(field) => applyNotionFieldMutation.mutate(field)}
          applyingNotionField={
            applyNotionFieldMutation.isPending ? applyNotionFieldMutation.variables : undefined
          }
          onUnlinkNotion={(snapshotId) => unlinkNotionMutation.mutate(snapshotId)}
          unlinkingNotion={unlinkNotionMutation.isPending}
        />
      )}

      {activeTab === 'roadmap' && (
        <RoadmapTab roadmaps={roadmaps} studentId={student.id} recommendedTemplateId={roadmapRecommendations[0]?.template.id} />
      )}

      {activeTab === 'tasks' && (
        <TasksTab
          roadmapTasks={roadmapTasks}
          onToggleRoadmapTask={(task) => toggleRoadmapTaskMutation.mutate(task)}
          pendingRoadmapTaskId={toggleRoadmapTaskMutation.variables?.id}
        />
      )}

      {activeTab === 'meetings' && (
        <MeetingsTab
          meetings={meetings}
          title={newMeetingTitle}
          startsAt={newMeetingStartsAt}
          link={newMeetingLink}
          setTitle={setNewMeetingTitle}
          setStartsAt={setNewMeetingStartsAt}
          setLink={setNewMeetingLink}
          onCreate={() => {
            if (newMeetingTitle.trim() && newMeetingStartsAt) createMeetingMutation.mutate()
          }}
          isCreating={createMeetingMutation.isPending}
        />
      )}

      {activeTab === 'documents' && (
        <DocumentsTab
          documents={student.documents ?? []}
          onToggleVisibility={(doc) => toggleDocumentVisibilityMutation.mutate(doc)}
          pendingDocId={toggleDocumentVisibilityMutation.variables?.id}
        />
      )}

      {activeTab === 'telegram' && (
        <TelegramTab studentId={student.id} studentName={student.full_name} chat={telegramChat} messages={telegramMessages} />
      )}

      {activeTab === 'chat' && (
        <ChatTab studentId={student.id} studentName={student.full_name} />
      )}

      {activeTab === 'notes' && (
        <section className="rounded-card border border-w-line bg-w-panel p-5">
          <WorkspaceNotesPanel studentId={student.id} studentName={student.full_name} notes={student.confidential_notes ?? []} />
        </section>
      )}

      {activeTab === 'access' && (
        <section className="rounded-card border border-w-line bg-w-panel p-5">
          <WorkspaceAccessPanel studentId={student.id} studentName={student.full_name} />
        </section>
      )}
    </div>
  )
}

// «Быстрые метрики» карточки — как строка плиток в CRM (StudentCardPage): под
// шапкой сразу видно следующее действие, roadmap, встречу и последний контакт.
const moneyLabel = (value?: string | null, currency = 'KZT') =>
  value ? `${Number(value).toLocaleString('ru-RU')} ${currency}` : '—'

function countIntakeMismatch(intake?: StudentIntake): number {
  if (!intake) return 0
  return intake.comparison.filter(
    (row) =>
      (row.mismatch === true && row.ai_same_meaning !== true) ||
      (row.crm_matches === false && !row.human_only && row.crm_ai_same_meaning !== true),
  ).length
}

function countNotionMismatch(notion?: StudentNotion | null): number {
  if (!notion) return 0
  return notion.comparison.filter((row) => row.matches === false).length
}

// Карточка студента как вертикальный список раскрывающихся блоков — как в CRM
// (StudentCardPage): один блок за другим, часть открыта по умолчанию, менеджер
// сам сворачивает/раскрывает. Плюс блоки «Сверка анкет» и «Notion».
function CardListView({
  student,
  responsibles,
  nextMeetingValue,
  lastContactText,
  intake,
  notion,
  canReconcile,
  roadmapRecommendations,
  onOpenRoadmap,
  onApplyNotionField,
  applyingNotionField,
  onUnlinkNotion,
  unlinkingNotion,
}: {
  student: StudentFull
  responsibles: ResponsibleUser[]
  nextMeetingValue?: string
  lastContactText: string
  intake?: StudentIntake
  notion?: StudentNotion | null
  canReconcile: boolean
  roadmapRecommendations: RoadmapRecommendation[]
  onOpenRoadmap: () => void
  onApplyNotionField: (field: string) => void
  applyingNotionField?: string
  onUnlinkNotion: (snapshotId: string) => void
  unlinkingNotion: boolean
}) {
  const contract = student.contracts?.[0]
  const applications = student.applications ?? []
  const guardians = student.guardians ?? []
  const services = student.services ?? []
  const currency = contract?.currency || 'KZT'
  const nextAction = student.student_tasks?.find((task) => task.status === 'open')?.task_text || 'Открытых задач нет'
  const paidTotal = contract?.payments?.length
    ? moneyLabel(String(contract.payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount || 0), 0)), currency)
    : '—'
  const intakeMismatch = countIntakeMismatch(intake)
  const notionMismatch = countNotionMismatch(notion)
  const risks = intakeMismatch + notionMismatch
  const showIntake = canReconcile && !!intake && (!!intake.package || !!intake.cases)
  const showNotion = canReconcile && !!notion?.snapshot
  const mentorName = (mentorId?: string | null) =>
    responsibles.find((r) => r.id === mentorId)?.name || (mentorId ? 'Назначен' : 'Не назначен')

  // «Что уже открыто» — как в CRM: профиль/заявки/услуги + сверки, если они есть.
  const defaultOpen = ['applications', 'services']
  if (showIntake) defaultOpen.push('intake')

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        <StatTile label="Следующее действие" value={nextAction} />
        <StatTile
          label="Риски данных"
          value={canReconcile ? (risks > 0 ? `${risks} расхожд.` : 'Расхождений нет') : '—'}
          tone={canReconcile ? (risks > 0 ? 'warn' : 'good') : undefined}
        />
        <StatTile label="Ближайшая встреча" value={nextMeetingValue ? formatDate(nextMeetingValue) : 'Нет'} />
        <StatTile label="Последний контакт" value={lastContactText} />
      </div>

      {roadmapRecommendations.length > 0 && (
        <RoadmapRecommendations items={roadmapRecommendations} onOpen={onOpenRoadmap} />
      )}

      <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-3">
        <WSection value="responsibles" title="Ответственные" icon={<Users className="h-4 w-4" />}>
          {responsibles.length === 0 ? (
            <p className="text-sm text-w-muted">Нет активных назначений</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {responsibles.map((person) => (
                <Badge key={`${person.id}-${person.role}`}>{person.name || 'Сотрудник'} · {person.role}</Badge>
              ))}
            </div>
          )}
        </WSection>

        {showIntake && (
          <WSection
            value="intake"
            title="Сверка анкет"
            icon={<ClipboardCheck className="h-4 w-4" />}
            badge={intakeMismatch > 0 ? <MismatchBadge count={intakeMismatch} /> : undefined}
          >
            <IntakeTable intake={intake!} />
          </WSection>
        )}

        {showNotion && (
          <WSection
            value="notion"
            title="Notion"
            icon={<Database className="h-4 w-4" />}
            badge={notionMismatch > 0 ? <MismatchBadge count={notionMismatch} /> : undefined}
          >
            <NotionBlock
              notion={notion!}
              onApplyField={onApplyNotionField}
              applyingField={applyingNotionField}
              onUnlink={onUnlinkNotion}
              unlinking={unlinkingNotion}
            />
          </WSection>
        )}

        <WSection value="profile" title="Профиль студента" icon={<UserRound className="h-4 w-4" />}>
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <SimpleList
                rows={[
                  { label: 'ФИО', value: student.full_name },
                  { label: 'Телефон', value: student.phone || '—' },
                  { label: 'Возраст', value: student.age ? String(student.age) : '—' },
                  { label: 'Город', value: student.city || '—' },
                  { label: 'Уровень', value: DEGREE_LEVEL_LABELS[student.degree_level] || student.degree_level },
                  { label: 'Год поступления', value: String(student.intake_year) },
                  { label: 'Специальность', value: student.specialty || '—' },
                  { label: 'Направление', value: student.group_direction || '—' },
                  { label: 'Доп. сфера', value: student.additional_sphere || '—' },
                  { label: 'GPA', value: student.gpa || '—' },
                  { label: 'Бюджет', value: student.budget_per_year || '—' },
                  { label: 'Сезон поступления', value: student.intake_season || '—' },
                  { label: 'MZK/менеджер', value: student.mzk_manager_name || '—' },
                  { label: 'Pipeline', value: student.pipeline_status ? (PIPELINE_STATUS_LABELS[student.pipeline_status] || student.pipeline_status) : '—' },
                ]}
              />
            </div>
            {showNotion && notion?.finance?.length ? (
              <div>
                <p className="mb-2 text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">Финансы из Notion · только просмотр</p>
                <div className="overflow-x-auto rounded-panel border border-w-line bg-w-panel2">
                  <div className="min-w-[360px] divide-y divide-w-line">
                    {notion.finance.map((f) => (
                      <div key={f.label} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="text-2xs uppercase tracking-[0.12em] text-w-muted2">{f.label}</span>
                        <span className="font-bold text-w-ink">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs text-w-muted2">
                  Notion — источник по финансам, CRM назад в Notion не пишет. «Принять из Notion» переносит значение в карточку вручную.
                </p>
              </div>
            ) : null}
          </div>
          {student.achievements_text && (
            <div className="mt-4 rounded-panel border border-w-line bg-w-panel2 p-4">
              <div className="text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">Достижения</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-w-ink">{student.achievements_text}</p>
            </div>
          )}
        </WSection>

        <WSection value="contract" title="Договор и оплаты" icon={<Briefcase className="h-4 w-4" />}>
          <SimpleList
            rows={[
              { label: 'Договор', value: contract ? 'Есть' : 'Нет' },
              { label: 'Пакет/статус', value: contract?.pipeline_status ? (PIPELINE_STATUS_LABELS[contract.pipeline_status] || contract.pipeline_status) : '—' },
              { label: 'Дата подписания', value: contract?.signed_date ? formatDate(contract.signed_date) : '—' },
              { label: 'Сумма договора', value: moneyLabel(contract?.amount, currency) },
              { label: 'Оплачено', value: paidTotal },
              { label: 'Остаток', value: moneyLabel(contract?.client_remaining_amount, currency) },
              { label: 'План оплаты', value: contract?.payment_plan || '—' },
              { label: 'AI-сигналы', value: String(student.pending_insights?.filter((item) => item.status === 'pending').length ?? 0) },
            ]}
          />
        </WSection>

        <WSection value="applications" title="Заявки на поступление" icon={<ExternalLink className="h-4 w-4" />}>
          {applications.length === 0 ? (
            <p className="text-sm text-w-muted">Заявки ещё не добавлены.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[1.2fr_0.9fr_0.5fr_0.7fr_0.8fr] gap-3 border-b border-w-line px-3 pb-3 text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">
                  <span>Страна / вуз</span><span>Статус</span><span>Подачи</span><span>Виза</span><span>Стипендия</span>
                </div>
                {applications.map((application) => (
                  <div key={application.id} className="grid grid-cols-[1.2fr_0.9fr_0.5fr_0.7fr_0.8fr] items-center gap-3 border-b border-w-line px-3 py-3 text-sm last:border-b-0">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-w-ink">{application.university || application.country}</div>
                      <div className="mt-0.5 truncate text-xs text-w-muted">
                        {[application.country, application.program].filter(Boolean).join(' · ')}
                        {application.is_primary ? ' · Основная' : ''}
                      </div>
                    </div>
                    <span className="text-w-ink">{SUBMISSION_STATUS_LABELS[application.submission_status] || application.submission_status}</span>
                    <span className="text-w-ink">{`${application.submissions_done}/${application.submissions_planned}`}</span>
                    <span className="text-w-muted">{application.visa_status || '—'}</span>
                    <span className="text-w-muted">{application.scholarship_target ? 'Цель' : 'Нет'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WSection>

        <WSection value="guardians" title="Родители и контакты" icon={<UserRound className="h-4 w-4" />}>
          {guardians.length === 0 ? (
            <p className="text-sm text-w-muted">Контакты родителей не добавлены или недоступны для вашей роли.</p>
          ) : (
            <div className="space-y-3">
              {guardians.map((guardian) => (
                <div key={guardian.id} className="rounded-card border border-w-line bg-w-panel2 p-4">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-black text-w-ink">{guardian.full_name}</span>{guardian.is_primary && <Badge>Основной контакт</Badge>}</div>
                  <div className="mt-3 grid gap-2">
                    <InfoLine label="Кем приходится" value={guardian.relation || '—'} />
                    <InfoLine label="Телефон" value={guardian.phone || '—'} />
                    <InfoLine label="Email" value={guardian.email || '—'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </WSection>

        <WSection value="services" title="Программы и услуги" icon={<Briefcase className="h-4 w-4" />}>
          {services.length === 0 ? (
            <EmptyState colorPrefix="w" title="Программы не настроены" description="Программы появятся здесь после назначения." />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div className="grid grid-cols-[1.25fr_0.8fr_1fr_0.8fr_1fr_1.2fr] gap-3 border-b border-w-line px-3 pb-3 text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">
                  <span>Программа</span><span>Статус</span><span>Ответственный</span><span>Дедлайн</span><span>Результат</span><span>Заметки</span>
                </div>
                {services.map((service) => (
                  <div
                    key={service.id}
                    className={cn(
                      'grid grid-cols-[1.25fr_0.8fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 border-b border-w-line px-3 py-3 text-sm last:border-b-0',
                      !service.included && 'opacity-55'
                    )}
                  >
                    <span className="font-bold text-w-ink">{SERVICE_TYPE_LABELS[service.service_type]}</span>
                    <span className={`w-fit rounded-full border px-2 py-1 text-2xs font-black uppercase tracking-wider ${programTone(service.status)}`}>
                      {service.included ? SERVICE_STATUS_LABELS[service.status] : 'Не включена'}
                    </span>
                    <span className="truncate text-w-muted">{mentorName(service.assigned_mentor_id)}</span>
                    <span className="text-w-muted">{service.deadline ? formatDate(service.deadline) : '—'}</span>
                    <span className="truncate text-w-ink" title={service.result || undefined}>{service.result || '—'}</span>
                    <span className="truncate text-w-muted" title={service.notes || undefined}>{service.notes || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WSection>
      </Accordion>
    </div>
  )
}

// Раскрывающийся блок в стиле воркспейса поверх radix-аккордеона.
function WSection({
  value,
  title,
  icon,
  badge,
  children,
}: {
  value: string
  title: string
  icon: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={value} className="overflow-hidden rounded-card border border-w-line bg-w-panel px-5">
      <AccordionTrigger className="py-4 font-display text-base font-black text-w-ink hover:no-underline">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="text-w-accentText">{icon}</span>
          {title}
          {badge}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-5 pt-0">{children}</AccordionContent>
    </AccordionItem>
  )
}

function MismatchBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full border border-w-accentDim/50 bg-w-accent/10 px-2 py-0.5 text-2xs font-black normal-case tracking-normal text-w-accentText">
      {count} расхожд.
    </span>
  )
}

// Сверка анкет: менеджер (пакет) vs студент (кейс) vs CRM. Жёлтым — расхождения.
function IntakeTable({ intake }: { intake: StudentIntake }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-w-muted">
        <span>
          Пакет (менеджер):{' '}
          {intake.package
            ? `${intake.package.manager_name ?? '—'}${intake.package.submitted_at ? ` · ${formatDate(intake.package.submitted_at)}` : ''}`
            : 'анкеты нет'}
        </span>
        <span>
          Кейс (студент):{' '}
          {intake.cases ? (intake.cases.submitted_at ? formatDate(intake.cases.submitted_at) : 'есть') : 'анкеты нет'}
        </span>
      </div>
      <div className="overflow-x-auto rounded-panel border border-w-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-w-line text-left text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">
              <th className="w-44 px-3 py-2">Поле</th>
              {intake.package && <th className="px-3 py-2">Менеджер · Пакет</th>}
              {intake.cases && <th className="px-3 py-2">Студент · Кейс</th>}
              <th className="px-3 py-2">CRM</th>
            </tr>
          </thead>
          <tbody>
            {intake.comparison.map((row) => {
              const aiSuggestsSame = row.mismatch && row.ai_same_meaning === true
              const realMismatch = row.mismatch && !aiSuggestsSame
              const crmMismatch = row.crm_matches === false && !row.human_only && row.crm_ai_same_meaning !== true
              return (
                <tr
                  key={row.field}
                  className={cn('border-b border-w-line/60 align-top last:border-0', (realMismatch || crmMismatch) && 'bg-w-accent/[0.06]')}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-w-muted">
                    {row.label}
                    {row.human_only && <span className="mt-0.5 block text-xs text-w-muted2">🔒 вручную</span>}
                    {realMismatch && <span className="mt-0.5 block text-xs text-w-accentText">расхождение</span>}
                    {crmMismatch && <span className="mt-0.5 block text-xs text-w-accentText">CRM расходится</span>}
                    {aiSuggestsSame && (
                      <span className="mt-0.5 block text-xs text-w-muted2" title={row.ai_note ?? undefined}>вероятно совпадает</span>
                    )}
                  </td>
                  {intake.package && <td className="px-3 py-2 text-w-ink">{row.package ?? '—'}</td>}
                  {intake.cases && <td className="px-3 py-2 text-w-ink">{row.cases ?? '—'}</td>}
                  <td className="px-3 py-2 text-w-muted">
                    {row.crm_matches ? (
                      <span className="text-xs text-w-good">✓ совпадает</span>
                    ) : row.crm_ai_same_meaning ? (
                      <span className="text-xs text-w-muted2" title={row.crm_ai_note ?? undefined}>✓ вероятно совпадает</span>
                    ) : (
                      row.crm ?? '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-w-muted2">
        Жёлтым подсвечены поля, где ответы менеджера и студента расходятся. Стоимость и договорённости вносятся в CRM вручную.
      </p>
    </div>
  )
}

// Notion: сверка «Notion | CRM», финансы из Notion и отвязка неверной записи.
function NotionBlock({
  notion,
  onApplyField,
  applyingField,
  onUnlink,
  unlinking,
}: {
  notion: StudentNotion
  onApplyField: (field: string) => void
  applyingField?: string
  onUnlink: (snapshotId: string) => void
  unlinking: boolean
}) {
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const snapshot = notion.snapshot!
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-w-muted">
          Синхронизировано: {snapshot.synced_at ? formatDate(snapshot.synced_at) : '—'}
          {snapshot.notion_last_edited_at ? ` · изменено в Notion: ${formatDate(snapshot.notion_last_edited_at)}` : ''}
        </p>
        <div className="flex items-center gap-3">
          {snapshot.notion_url && (
            <a href={snapshot.notion_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-w-accentText hover:underline">
              Открыть в Notion
            </a>
          )}
          {!confirmUnlink ? (
            <button
              type="button"
              onClick={() => setConfirmUnlink(true)}
              className="inline-flex items-center gap-1 text-xs font-bold text-w-muted transition hover:text-w-danger"
            >
              <Link2Off className="h-3 w-3" /> Отвязать
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-w-muted">
              Отвязать запись?
              <button
                type="button"
                disabled={unlinking}
                onClick={() => { onUnlink(snapshot.id); setConfirmUnlink(false) }}
                className="font-black text-w-danger disabled:opacity-60"
              >
                Да
              </button>
              <button type="button" onClick={() => setConfirmUnlink(false)} className="font-bold text-w-muted2">
                Нет
              </button>
            </span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-panel border border-w-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-w-line text-left text-2xs font-black uppercase tracking-[0.16em] text-w-muted2">
              <th className="w-44 px-3 py-2">Поле</th>
              <th className="px-3 py-2">Notion</th>
              <th className="px-3 py-2">CRM</th>
              <th className="w-32 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {notion.comparison.map((row) => (
              <tr
                key={row.field}
                className={cn('border-b border-w-line/60 align-top last:border-0', row.matches === false && 'bg-w-accent/[0.06]')}
              >
                <td className="whitespace-nowrap px-3 py-2 text-w-muted">
                  {row.label}
                  {row.matches === false && <span className="mt-0.5 block text-xs text-w-accentText">расхождение</span>}
                </td>
                <td className="px-3 py-2 text-w-ink">{row.notion ?? '—'}</td>
                <td className="px-3 py-2">
                  {row.matches ? <span className="text-xs text-w-good">✓ совпадает</span> : <span className="text-w-muted">{row.crm ?? '—'}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.matches === false && row.can_apply && (
                    <button
                      type="button"
                      disabled={applyingField === row.field}
                      onClick={() => onApplyField(row.field)}
                      className="rounded-ctl border border-w-line px-2.5 py-1 text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText disabled:opacity-60"
                    >
                      {applyingField === row.field ? 'Применяем…' : 'Принять из Notion'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-w-muted2">Сверка Notion: значения можно принять вручную в CRM кнопкой «Принять из Notion».</p>
    </div>
  )
}

function programTone(status: Service['status']): string {
  if (status === 'completed') return 'border-w-good/30 bg-w-good/10 text-w-good'
  if (status === 'in_progress' || status === 'scheduled') return 'border-w-accentDim/40 bg-w-accent/10 text-w-accentText'
  if (status === 'failed') return 'border-w-danger/30 bg-w-danger/10 text-w-danger'
  return 'border-w-line bg-w-panel2 text-w-muted'
}

type RoadmapRecommendation = {
  template: TemplateListItem
  reasons: string[]
  score: number
}

function recommendRoadmaps(student: StudentFull, templates: TemplateListItem[]): RoadmapRecommendation[] {
  const countries = new Set(
    [student.country, ...(student.applications ?? []).map((application) => application.country)]
      .filter(Boolean)
      .map((value) => String(value).trim().toLocaleLowerCase('ru')),
  )
  const degreeTokens = student.degree_level === 'masters'
    ? ['master', 'graduate', 'магистр']
    : student.degree_level === 'foundation'
      ? ['foundation']
      : student.degree_level === 'found_ug'
        ? ['foundation', 'bachelor', 'undergraduate', 'ug']
        : ['bachelor', 'undergraduate', 'ug', 'бакалавр']

  return templates
    .map((template) => {
      const reasons: string[] = []
      let score = 0
      const templateCountry = template.country_name?.trim().toLocaleLowerCase('ru') || ''
      const templateDegree = `${template.degree} ${template.name}`.toLocaleLowerCase('ru')
      if (templateCountry && countries.has(templateCountry)) {
        score += 8
        reasons.push(`страна: ${template.country_name}`)
      }
      if (degreeTokens.some((token) => templateDegree.includes(token))) {
        score += 5
        reasons.push(`уровень: ${DEGREE_LEVEL_LABELS[student.degree_level]}`)
      }
      if (template.year === student.intake_year) {
        score += 4
        reasons.push(`год: ${student.intake_year}`)
      } else if (Math.abs(template.year - student.intake_year) === 1) {
        score += 1
      }
      return { template, reasons, score }
    })
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score || b.template.year - a.template.year)
    .slice(0, 3)
}

function RoadmapRecommendations({ items, onOpen }: { items: RoadmapRecommendation[]; onOpen: () => void }) {
  return (
    <Panel
      title="Какой Roadmap назначить"
      icon={<Route className="h-4 w-4" />}
      action={<AppButton colorPrefix="w" size="sm" onClick={onOpen}>Перейти к назначению</AppButton>}
    >
      <p className="mb-4 text-sm leading-6 text-w-muted">
        Подсказки сформированы по стране, уровню обучения и году поступления из профиля студента.
      </p>
      <div className="divide-y divide-w-line border-y border-w-line">
        {items.map((item, index) => (
          <div key={item.template.id} className="flex flex-wrap items-center justify-between gap-3 px-2 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-w-ink">{item.template.name}</span>
                {index === 0 && <Pill colorPrefix="w" tone="accent">Рекомендуем</Pill>}
              </div>
              <div className="mt-1 text-xs text-w-muted">
                {[item.template.country_name, item.template.degree, item.template.year].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="text-xs text-w-muted2">Совпало: {item.reasons.join(', ')}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function RoadmapTab({
  roadmaps,
  studentId,
  recommendedTemplateId,
}: {
  roadmaps: Roadmap[]
  studentId: string
  recommendedTemplateId?: string
}) {
  const queryClient = useQueryClient()
  const { hasRole } = useAuth()
  const canManageTemplates = hasRole('admin', 'mzk_manager')
  const canAssign = hasRole('admin', 'mzk_manager', 'mentor')
  const [templateId, setTemplateId] = useState(recommendedTemplateId || '')
  const [selectedId, setSelectedId] = useState<string | null>(roadmaps[0]?.id ?? null)
  const [showAssignForm, setShowAssignForm] = useState(false)

  useEffect(() => {
    if (!templateId && recommendedTemplateId) setTemplateId(recommendedTemplateId)
  }, [recommendedTemplateId, templateId])

  useEffect(() => {
    setSelectedId((current) => (current && roadmaps.some((r) => r.id === current)) ? current : roadmaps[0]?.id ?? null)
  }, [roadmaps])

  const selected = roadmaps.find((r) => r.id === selectedId) ?? null

  const { data: templates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
    enabled: canAssign && (roadmaps.length === 0 || showAssignForm),
  })

  const applyRoadmap = (updated: Roadmap) => {
    queryClient.setQueryData(['workspace', 'student', studentId, 'roadmap'], (current: Roadmap[] | undefined) =>
      (current ?? []).map((r) => (r.id === updated.id ? updated : r))
    )
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'summary'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'dashboard'] })
  }

  const assignMutation = useMutation({
    mutationFn: () => roadmapApi.assign(templateId, studentId),
    onSuccess: (rm) => {
      queryClient.setQueryData(['workspace', 'student', studentId, 'roadmap'], (current: Roadmap[] | undefined) => [rm, ...(current ?? [])])
      setSelectedId(rm.id)
      setShowAssignForm(false)
      toast({ title: 'Roadmap назначен', description: 'Студент увидит его в кабинете.' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось назначить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (roadmapId: string) => roadmapApi.archiveRoadmap(roadmapId),
    onSuccess: (_rm, roadmapId) => {
      queryClient.setQueryData(['workspace', 'student', studentId, 'roadmap'], (current: Roadmap[] | undefined) =>
        (current ?? []).filter((r) => r.id !== roadmapId)
      )
      toast({ title: 'Roadmap архивирован' })
    },
    onError: () => toast({ title: 'Не удалось архивировать', variant: 'destructive' }),
  })

  const assignForm = (
    templates.length === 0 ? (
      <p className="text-center text-sm text-w-muted">
        {canManageTemplates
          ? 'Шаблонов пока нет — создайте их в разделе «Roadmap-шаблоны».'
          : 'Шаблонов пока нет. Обратитесь к администратору.'}
      </p>
    ) : (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <AppSelect colorPrefix="w"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="min-w-[260px] bg-w-panel2"
        >
          <option value="">Выберите шаблон…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {[t.country_name, t.degree, t.year].filter(Boolean).join(' ')} ({t.stage_count} эт.)
            </option>
          ))}
        </AppSelect>
        <AppButton colorPrefix="w"
          disabled={!templateId || assignMutation.isPending}
          onClick={() => assignMutation.mutate()}
        >
          {assignMutation.isPending ? 'Назначаем…' : 'Назначить'}
        </AppButton>
        {roadmaps.length > 0 && (
          <AppButton colorPrefix="w" variant="ghost" onClick={() => setShowAssignForm(false)}>
            Отмена
          </AppButton>
        )}
      </div>
    )
  )

  return (
    <Panel
      title="Roadmap студента"
      icon={<Route className="h-4 w-4" />}
    >
      {roadmaps.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            colorPrefix="w"
            title="Roadmap не назначен"
            description="Назначьте шаблон — этапы и задачи развернутся автоматически и сразу станут видны студенту в его кабинете."
          />
          {canAssign ? assignForm : null}
        </div>
      ) : (
        <div className="space-y-4">
          {roadmaps.length > 1 && (
            <SegmentedTabs
              colorPrefix="w"
              value={selectedId ?? ''}
              onChange={setSelectedId}
              tabs={roadmaps.map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
          {canAssign && (
            <div className="flex items-center justify-end gap-2">
              {selected && (
                <AppButton
                  colorPrefix="w"
                  variant="ghost"
                  size="sm"
                  disabled={archiveMutation.isPending}
                  onClick={() => selected && archiveMutation.mutate(selected.id)}
                >
                  Архивировать этот roadmap
                </AppButton>
              )}
              {!showAssignForm && (
                <AppButton colorPrefix="w" variant="ghost" size="sm" onClick={() => setShowAssignForm(true)}>
                  + Ещё один roadmap
                </AppButton>
              )}
            </div>
          )}
          {showAssignForm && assignForm}
          {selected && (
            <>
              <RoadmapHeaderCard roadmap={selected} className="mb-5" />
              <WorkspaceRoadmapEditor roadmap={selected} canManage onChanged={applyRoadmap} />
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

function TasksTab({
  roadmapTasks,
  onToggleRoadmapTask,
  pendingRoadmapTaskId,
}: {
  roadmapTasks: Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; stageName: string }>
  onToggleRoadmapTask: (task: { id: string; status: string }) => void
  pendingRoadmapTaskId?: string
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; stageName: string }>>()
    roadmapTasks.forEach((task) => {
      const key = task.stageName || 'Без этапа'
      const list = map.get(key)
      if (list) list.push(task)
      else map.set(key, [task])
    })
    return [...map.entries()]
  }, [roadmapTasks])

  return (
    <div className="w-full">
      <Panel title="Задачи для студента" icon={<BookOpen className="h-4 w-4" />}>
        {roadmapTasks.length === 0 ? (
          <EmptyState colorPrefix="w" title="Публичных задач нет" description="Они появятся после назначения roadmap." />
        ) : (
          <div className="space-y-5">
            {grouped.map(([stageName, tasks]) => (
              <section key={stageName}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="h-4 w-1 rounded bg-w-accent" />
                  <b className="font-display text-xl font-extrabold leading-none text-w-ink">{stageName}</b>
                  <span className="rounded-full bg-w-line/90 px-2.5 py-0.5 text-2xs font-bold text-w-muted2">
                    {tasks.length} задач
                  </span>
                </div>
                <div className="space-y-2.5">
                  {tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      disabled={pendingRoadmapTaskId === task.id}
                      onToggle={() => onToggleRoadmapTask({ id: task.id, status: task.status })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>

    </div>
  )
}

function MeetingsTab({
  meetings,
  title,
  startsAt,
  link,
  setTitle,
  setStartsAt,
  setLink,
  onCreate,
  isCreating,
}: {
  meetings: Array<{ id: string; title: string; starts_at: string; status: string; meeting_link?: string }>
  title: string
  startsAt: string
  link: string
  setTitle: (value: string) => void
  setStartsAt: (value: string) => void
  setLink: (value: string) => void
  onCreate: () => void
  isCreating: boolean
}) {
  return (
    <Panel title="Встречи" icon={<Calendar className="h-4 w-4" />}>
      <div className="mb-5 rounded-card border border-w-line bg-w-panel2 p-4">
        <div className="mb-3 text-sm font-black text-w-ink">Быстро создать встречу</div>
        <div className="grid gap-2 md:grid-cols-[1fr_220px]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название встречи"
            className="min-h-10 rounded-ctl border border-w-line bg-w-panel px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="min-h-10 rounded-ctl border border-w-line bg-w-panel px-3 text-sm text-w-ink outline-none focus:border-w-accentDim"
          />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Zoom/Meet ссылка, если есть"
            className="min-h-10 rounded-ctl border border-w-line bg-w-panel px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim md:col-span-2"
          />
        </div>
        <button
          type="button"
          disabled={!title.trim() || !startsAt || isCreating}
          onClick={onCreate}
          className="mt-3 rounded-ctl bg-w-accent px-4 py-2 text-xs font-black text-black transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? 'Создаем...' : 'Создать встречу'}
        </button>
      </div>
      {meetings.length === 0 ? (
        <EmptyState colorPrefix="w" title="Встреч нет" description="Создайте первую встречу прямо здесь." />
      ) : (
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="flex items-center gap-3 rounded-panel border border-w-line bg-w-panel2 p-3">
              <Clock className="h-4 w-4 shrink-0 text-w-accentText" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-w-ink">{meeting.title}</div>
                <div className="text-xs text-w-muted">{formatDate(meeting.starts_at)} · {meeting.status}</div>
              </div>
              {meeting.meeting_link && (
                <a href={meeting.meeting_link} target="_blank" rel="noreferrer" className="rounded-ctl bg-w-accent px-3 py-1.5 text-xs font-black text-black">
                  Join
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function DocumentsTab({
  documents,
  onToggleVisibility,
  pendingDocId,
}: {
  documents: Array<{ id: string; file_name: string; doc_type: string; source: string; visible_to_student?: boolean; uploaded_at: string }>
  onToggleVisibility: (doc: { id: string; visible_to_student?: boolean }) => void
  pendingDocId?: string
}) {
  return (
    <Panel title="Документы" icon={<FileText className="h-4 w-4" />}>
      {documents.length === 0 ? (
        <EmptyState colorPrefix="w" title="Документов нет" description="Файлы из Telegram, сообщений и кабинета студента будут собираться здесь." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {documents.map((doc) => (
            <div key={doc.id} className="rounded-card border border-w-line bg-w-panel2 p-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-w-accentText" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-w-ink">{doc.file_name}</div>
                  <div className="mt-1 text-xs text-w-muted">
                    {DOC_TYPE_LABELS[doc.doc_type as keyof typeof DOC_TYPE_LABELS] || doc.doc_type} · {doc.source} · {formatDate(doc.uploaded_at)}
                  </div>
                  <div className="mt-2">
                    <Badge>{doc.visible_to_student ? 'Виден студенту' : 'Только staff'}</Badge>
                  </div>
                  <button
                    type="button"
                    disabled={pendingDocId === doc.id}
                    onClick={() => onToggleVisibility(doc)}
                    className="mt-3 rounded-ctl border border-w-line px-3 py-1.5 text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText disabled:cursor-wait disabled:opacity-60"
                  >
                    {pendingDocId === doc.id
                      ? 'Сохраняем...'
                      : doc.visible_to_student
                        ? 'Скрыть от студента'
                        : 'Показать студенту'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function TelegramTab({
  studentId,
  studentName,
  chat,
  messages,
}: {
  studentId: string
  studentName: string
  chat: TelegramChat | null | undefined
  messages: Array<{ id: string; sender_name: string | null; raw_text: string | null; message_type: string; created_at: string }>
}) {
  return (
    <div className="space-y-5">
      <Panel title="Telegram-группа" icon={<Send className="h-4 w-4" />} action={chat ? <Link to={`/workspace/chat?student_id=${studentId}&channel=telegram`} className="text-xs font-bold text-w-accentText hover:underline">Открыть чат →</Link> : undefined}>
        <TelegramGroupManager studentId={studentId} studentName={studentName} chat={chat} variant="workspace" />
      </Panel>
      {chat && (
        <Panel title="Последние сообщения" icon={<MessageCircle className="h-4 w-4" />}>
          {messages.length === 0 ? (
            <EmptyState colorPrefix="w" title="Сообщений пока нет" description="Сообщения появятся после подключения группы и проверки готовности." />
          ) : (
            <div className="space-y-2">
              {messages.slice(-10).reverse().map((message) => (
                <div key={message.id} className="rounded-panel border border-w-line bg-w-panel2 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-w-muted">
                    <span>{message.sender_name || 'Telegram'}</span>
                    <span>{formatDate(message.created_at)}</span>
                  </div>
                  <div className="text-sm text-w-ink">{message.raw_text || message.message_type}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function ChatTab({ studentId, studentName }: { studentId: string; studentName?: string }) {
  const { user } = useAuth()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['workspace', 'staff-conversation', studentId],
    queryFn: () => chatApi.staffConversation(studentId),
    retry: false,
  })

  return (
    <Panel title="Чат со студентом" icon={<MessageCircle className="h-4 w-4" />}>
      {isLoading ? (
        <p className="text-sm text-w-muted">Загрузка чата...</p>
      ) : isError || !data ? (
        // No portal account yet → the internal chat can't exist. Let the mentor
        // grant access right here instead of bouncing to CRM; granting creates
        // the account, then re-opens the chat.
        <WorkspaceAccessPanel studentId={studentId} studentName={studentName} onGranted={() => refetch()} />
      ) : user ? (
        <ChatThread conversationId={data.id} currentUserId={user.id} heightClass="h-[520px]" variant="portal" />
      ) : null}
    </Panel>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <Pill colorPrefix="w">{children}</Pill>
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-w-line bg-w-panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-black text-w-ink">
          <span className="text-w-accentText">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-w-line bg-w-panel2 px-3 py-2">
      <div className="text-2xs uppercase tracking-[0.16em] text-w-muted2">{label}</div>
      <div className="mt-1 min-h-5 text-sm font-bold text-w-ink">{value}</div>
    </div>
  )
}

// Плитки быстрой сводки — как в карточке студента в CRM (п.1).
function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'good' }) {
  return (
    <div className="rounded-panel border border-w-line bg-w-panel px-3 py-2.5">
      <div className="text-2xs uppercase tracking-[0.18em] text-w-muted2">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-sm font-bold',
          tone === 'warn' ? 'text-w-accentText' : tone === 'good' ? 'text-w-good' : 'text-w-ink',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function taskPriorityLabel(priority: string) {
  if (priority === 'required') return 'Обязательно'
  if (priority === 'recommended') return 'Рекомендуется'
  return 'По желанию'
}

function taskPriorityTone(priority: string): 'accent' | 'neutral' {
  return priority === 'required' ? 'accent' : 'neutral'
}

function taskStatusLabel(status: string) {
  if (status === 'done') return 'Готово'
  if (status === 'in_progress') return 'В работе'
  return 'Запланировано'
}

function taskStatusTone(status: string): 'good' | 'accent' | 'neutral' {
  if (status === 'done') return 'good'
  if (status === 'in_progress') return 'accent'
  return 'neutral'
}

function TaskRow({
  task,
  disabled,
  onToggle,
}: {
  task: { id: string; title: string; status: string; priority: string; due_date: string | null; stageName: string }
  disabled?: boolean
  onToggle?: () => void
}) {
  const done = task.status === 'done'
  const meta = task.due_date ? `Этап: ${task.stageName} · дедлайн ${formatDate(task.due_date)}` : `Этап: ${task.stageName} · без дедлайна`

  return (
    <div className="flex items-center gap-3.5 rounded-ctl border border-w-line bg-w-panel2 px-3.5 py-3 transition hover:border-w-accentDim">
      <button
        type="button"
        disabled={disabled || !onToggle}
        onClick={onToggle}
        className={cn(
          'grid h-[19px] w-[19px] shrink-0 place-items-center rounded-ctl border-2 transition',
          done ? 'border-w-accent bg-w-accent text-black' : 'border-w-muted2/70 bg-transparent text-transparent hover:border-w-accentDim',
          disabled && 'cursor-wait opacity-60'
        )}
        aria-label={done ? 'Вернуть задачу в работу' : 'Закрыть задачу'}
      >
        {done && <CheckCircle2 className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[14px] font-bold', done ? 'text-w-muted' : 'text-w-ink')}>{task.title}</div>
        <div className="mt-0.5 truncate text-xs text-w-muted">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Pill colorPrefix="w" tone={taskPriorityTone(task.priority)}>{taskPriorityLabel(task.priority)}</Pill>
        <Pill colorPrefix="w" tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status)}</Pill>
      </div>
    </div>
  )
}

function SimpleList({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-w-line bg-w-panel2">
      <div className="min-w-[560px] divide-y divide-w-line">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[220px_1fr] items-start gap-4 px-3 py-2.5 text-sm">
            <span className="text-2xs uppercase tracking-[0.12em] text-w-muted2">{row.label}</span>
            <span className="font-semibold text-w-ink">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
