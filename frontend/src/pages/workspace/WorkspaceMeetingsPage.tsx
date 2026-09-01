import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, CheckCircle2, Clock, FileText, MessageSquareText, Mic, Sparkles, Video } from 'lucide-react'
import { MeetingType, meetingsApi, MeetingStatus } from '@/api/meetings'
import type { MeetingFollowUpDraft } from '@/api/meetings'
import { notesApi } from '@/api/notes'
import { tasksApi } from '@/api/index'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { FollowUpReviewDialog } from '@/components/shared/FollowUpReviewDialog'
import { WorkspaceNotesPage } from '@/pages/workspace/WorkspaceNotesPage'
import { AppButton, AppCard, AppInput, AppSelect, EmptyState, PageHeader, Pill, SegmentedTabs } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'

const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Запланирована',
  completed: 'Проведена',
  cancelled: 'Отменена',
}

const MEETING_STATUS_TONE: Record<MeetingStatus, 'accent' | 'good' | 'danger'> = {
  scheduled: 'accent',
  completed: 'good',
  cancelled: 'danger',
}

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  intro: 'Первичный',
  regular: 'Регулярный',
  documents: 'Документы',
  roadmap: 'Roadmap',
  application: 'Подача',
  finance: 'Финансы',
  other: 'Другое',
  ielts_lesson: 'IELTS · занятие',
  ielts_mock: 'IELTS · мок-тест',
}

export const WorkspaceMeetingsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { mentorId, params } = useWorkspaceScope()
  const [studentId, setStudentId] = useState('')
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState<MeetingType>('regular')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [link, setLink] = useState('')
  const [scope, setScope] = useLocalState<'upcoming' | 'all' | MeetingStatus>('workspace:meetings:scope', 'upcoming')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:meetings:studentFilter', '')
  const [followUpDraft, setFollowUpDraft] = useState<MeetingFollowUpDraft | null>(null)
  const tabParam = searchParams.get('tab')
  const section = tabParam === 'notes' ? 'notes' : tabParam === 'ielts' ? 'ielts' : 'upcoming'

  useEffect(() => {
    if (section === 'ielts') setMeetingType('ielts_lesson')
  }, [section])

  const { data: studentsData, isLoading: studentsLoading, isError: studentsFailed, error: studentsError, refetch: refetchStudents } = useQuery({
    queryKey: ['workspace', 'meetings', 'students', mentorId],
    queryFn: () => workspaceApi.students(params),
  })

  const students = (studentsData?.items ?? []).map((item) => item.student)
  const { data: meetingsData, isLoading: meetingsLoading, isError: meetingsFailed, error: meetingsError, refetch: refetchMeetings } = useQuery({
    queryKey: ['workspace', 'meetings', mentorId],
    queryFn: () => workspaceApi.meetings(params),
  })

  const meetings = useMemo(() => (meetingsData?.items ?? [])
    .filter((meeting) => !studentFilter || meeting.student_id === studentFilter)
    .filter((meeting) => section !== 'ielts' || meeting.meeting_type === 'ielts_lesson' || meeting.meeting_type === 'ielts_mock')
    .filter((meeting) => {
      if (scope === 'all') return true
      if (scope === 'upcoming') {
        return meeting.status === 'scheduled' && new Date(meeting.ends_at || meeting.starts_at).getTime() >= Date.now()
      }
      return meeting.status === scope
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()), [meetingsData?.items, scope, studentFilter, section])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'meetings'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student'] })
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const start = new Date(startsAt)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      return meetingsApi.create({
        student_id: studentId,
        title: title.trim(),
        meeting_type: meetingType,
        description: description.trim(),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        meeting_link: link.trim() || undefined,
      })
    },
    onSuccess: () => {
      setTitle('')
      setMeetingType('regular')
      setDescription('')
      setStartsAt('')
      setLink('')
      refresh()
      toast({ title: 'Встреча создана' })
    },
    onError: () => toast({ title: 'Не удалось создать встречу', variant: 'destructive' }),
  })

  const createNoteSessionMutation = useMutation({
    mutationFn: (meeting: { id: string; student_id: string; title: string }) => notesApi.createSession({
      student_id: meeting.student_id,
      meeting_id: meeting.id,
      title: `Конспект: ${meeting.title}`,
      source: 'meeting',
    }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      navigate(`/workspace/meetings/session/${session.id}`)
    },
    onError: () => toast({ title: 'Не удалось создать конспект', variant: 'destructive' }),
  })

  const createFollowUpMutation = useMutation({
    mutationFn: (meeting: { student_id: string; title: string; description?: string; outcome?: string }) => {
      const source = meeting.outcome || meeting.description || meeting.title
      return tasksApi.create(meeting.student_id, {
        task_text: `Follow-up после звонка «${meeting.title}»: ${source}`,
        status: 'open',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      toast({ title: 'Follow-up задача создана' })
    },
    onError: () => toast({ title: 'Не удалось создать задачу', variant: 'destructive' }),
  })

  const createAiActionsMutation = useMutation({
    mutationFn: (meeting: { id: string }) => meetingsApi.createAiActions(meeting.id),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      toast({ title: 'AI-разбор создан', description: 'Откроется черновик конспекта на проверку.' })
      navigate(`/workspace/meetings/notes/${note.id}`)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось создать AI-разбор', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const createFollowUpDraftMutation = useMutation({
    mutationFn: (meeting: { id: string }) => meetingsApi.createFollowUpDraft(meeting.id),
    onSuccess: (draft) => setFollowUpDraft(draft),
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось создать follow-up', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const sendFollowUpMutation = useMutation({
    mutationFn: (message: string) => meetingsApi.sendFollowUp(followUpDraft!.meeting_id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast({ title: 'Follow-up отправлен', description: 'Сообщение сохранено в чате студента.' })
      setFollowUpDraft(null)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось отправить follow-up', description: detail ?? 'Текст можно скопировать вручную.', variant: 'destructive' })
    },
  })

  const copyFollowUpText = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message)
      toast({ title: 'Follow-up текст скопирован' })
    } catch {
      toast({ title: 'Не удалось скопировать', description: 'Выделите текст в окне и скопируйте вручную.', variant: 'destructive' })
    }
  }

  const loading = studentsLoading || meetingsLoading
  // Экран собран из двух запросов: упади любой — список неполон. Повтор дёргает
  // оба: разбираться, какой именно не дошёл, человеку ни к чему.
  const failed = studentsFailed || meetingsFailed
  const loadError = meetingsError ?? studentsError
  const retry = () => { refetchStudents(); refetchMeetings() }

  return (
    <>
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow="Кабинет ментора"
        title="Встречи"
        description="Рабочий список звонков: планирование, быстрый вход, запись, транскрипт и конспект по каждому студенту."
      />

      <div className="mb-5">
        <SegmentedTabs colorPrefix="w"
          value={section}
          onChange={(value) => {
            const next = new URLSearchParams(searchParams)
            if (value === 'upcoming') next.delete('tab')
            else next.set('tab', value)
            setSearchParams(next, { replace: true })
            if (value === 'upcoming') setScope('upcoming')
          }}
          tabs={[
            { value: 'upcoming', label: 'Ближайшие' },
            { value: 'ielts', label: 'IELTS' },
            { value: 'notes', label: 'Конспекты' },
          ]}
        />
      </div>

      {section === 'notes' ? (
        <WorkspaceNotesPage embedded />
      ) : (
        <>

      <AppCard colorPrefix="w" className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
          <Calendar className="h-4 w-4 text-w-accentText" />
          Быстро создать встречу
        </div>
        <div className="grid gap-2 md:grid-cols-[240px_1fr_220px]">
          <AppSelect colorPrefix="w"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="bg-w-panel2"
          >
            <option value="">Выберите студента</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.full_name}</option>
            ))}
          </AppSelect>
          <AppInput colorPrefix="w"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название встречи"
            className="bg-w-panel2"
          />
          <AppSelect colorPrefix="w"
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as MeetingType)}
            className="bg-w-panel2"
          >
            {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </AppSelect>
          <AppInput colorPrefix="w"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="bg-w-panel2"
          />
          <AppInput colorPrefix="w"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Zoom/Meet ссылка"
            className="bg-w-panel2 md:col-span-2"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Повестка / что проверить на звонке"
            className="min-h-20 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink outline-none placeholder:text-w-muted2 transition focus:border-w-accentDim md:col-span-2"
          />
          <AppButton colorPrefix="w"
            disabled={!studentId || !title.trim() || !startsAt || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Создаем...' : 'Создать'}
          </AppButton>
        </div>
      </AppCard>

      <AppCard colorPrefix="w" className="mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <SegmentedTabs colorPrefix="w"
          value={scope}
          onChange={(value) => setScope(value as typeof scope)}
          tabs={[
            { value: 'upcoming', label: 'Ближайшие' },
            { value: 'scheduled', label: 'Запланированы' },
            { value: 'completed', label: 'Проведены' },
            { value: 'cancelled', label: 'Отменены' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <AppSelect colorPrefix="w"
          value={studentFilter}
          onChange={(event) => setStudentFilter(event.target.value)}
          className="bg-w-panel2 md:min-w-[260px]"
        >
          <option value="">Все мои студенты</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </AppSelect>
      </AppCard>

      <AppCard colorPrefix="w" className="p-5">
        <QueryState
          colorPrefix="w"
          isLoading={loading}
          isError={failed}
          error={loadError}
          onRetry={retry}
          isEmpty={meetings.length === 0}
          empty={(
            <EmptyState colorPrefix="w" title="Встреч нет" description="Создайте первую встречу." />
          )}
        >
          <div className="space-y-2">
            {meetings.map((meeting) => (
              <div key={meeting.id} className="flex flex-col gap-3 rounded-panel border border-w-line bg-w-panel2 p-4 md:flex-row md:items-start">
                <Clock className="h-4 w-4 shrink-0 text-w-accentText" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-bold text-w-ink">{meeting.title}</div>
                    <Pill colorPrefix="w" tone={MEETING_STATUS_TONE[meeting.status]}>{MEETING_STATUS_LABELS[meeting.status]}</Pill>
                    <Pill colorPrefix="w">{MEETING_TYPE_LABELS[meeting.meeting_type]}</Pill>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-w-muted">
                    <Link to={`/workspace/students/${meeting.student_id}#meetings`} className="text-w-accentText hover:underline">
                      {meeting.student_name}
                    </Link>
                    <span>·</span>
                    <span>{formatDate(meeting.starts_at)}</span>
                  </div>
                  {meeting.description && (
                    <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-w-muted">
                      Повестка: {meeting.description}
                    </div>
                  )}
                  {meeting.outcome && (
                    <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-w-good">
                      Итог: {meeting.outcome}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/workspace/students/${meeting.student_id}#meetings`}>
                      <AppButton colorPrefix="w" size="sm" variant="ghost">Карточка</AppButton>
                    </Link>
                    {meeting.note_session_id ? (
                      <Link to={`/workspace/meetings/session/${meeting.note_session_id}`} className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-accentDim/40 px-3 py-1.5 text-[11.5px] font-bold text-w-accentText hover:bg-w-accent/10">
                        <Mic className="h-3.5 w-3.5" />
                        Открыть конспект
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => createNoteSessionMutation.mutate(meeting)}
                        disabled={createNoteSessionMutation.isPending}
                        className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                      >
                        <Mic className="h-3.5 w-3.5" />
                        Конспект
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => createFollowUpMutation.mutate(meeting)}
                      disabled={createFollowUpMutation.isPending}
                      className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Задача из итога
                    </button>
                    <button
                      type="button"
                      onClick={() => createAiActionsMutation.mutate(meeting)}
                      disabled={createAiActionsMutation.isPending}
                      className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      AI-разбор
                    </button>
                    <button
                      type="button"
                      onClick={() => createFollowUpDraftMutation.mutate(meeting)}
                      disabled={createFollowUpDraftMutation.isPending}
                      className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      Follow-up текст
                    </button>
                    {meeting.recording_url && (
                      <a href={meeting.recording_url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText">
                        <Video className="h-3.5 w-3.5" />
                        Запись
                      </a>
                    )}
                    {meeting.transcript_url && (
                      <a href={meeting.transcript_url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-ctl border border-w-line px-3 py-1.5 text-[11.5px] font-bold text-w-muted hover:border-w-accentDim hover:text-w-accentText">
                        <FileText className="h-3.5 w-3.5" />
                        Транскрипт
                      </a>
                    )}
                  </div>
                </div>
                {meeting.meeting_link && (
                  <a href={meeting.meeting_link} target="_blank" rel="noreferrer" className="shrink-0 rounded-ctl bg-w-accent px-3 py-1.5 text-xs font-black text-black">
                    Join
                  </a>
                )}
              </div>
            ))}
          </div>
        </QueryState>
      </AppCard>
        </>
      )}
    </div>
    <FollowUpReviewDialog
      draft={followUpDraft}
      open={!!followUpDraft}
      isSending={sendFollowUpMutation.isPending}
      onOpenChange={(open) => !open && setFollowUpDraft(null)}
      onCopy={copyFollowUpText}
      onSend={(message) => sendFollowUpMutation.mutate(message)}
    />
    </>
  )
}
