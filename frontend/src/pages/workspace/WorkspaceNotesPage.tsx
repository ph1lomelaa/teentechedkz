import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookText, CheckCircle2, Mic, Plus, Sparkles } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { NoteSession, NoteSessionStatus, StudentNote, StudentNoteStatus } from '@/types'
import { AppButton, AppCard, AppInput, AppSelect, EmptyState, PageHeader, Pill, SegmentedTabs, StatCard } from '@/components/ui'

const SESSION_STATUS_LABELS: Record<NoteSessionStatus, string> = {
  active: 'Идёт запись',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

const NOTE_STATUS_LABELS: Record<StudentNoteStatus, string> = {
  draft: 'На проверке',
  approved: 'Принято',
  rejected: 'Отклонено',
}

const NOTE_STATUS_TONE: Record<StudentNoteStatus, 'accent' | 'good' | 'danger'> = {
  draft: 'accent',
  approved: 'good',
  rejected: 'danger',
}

type CombinedStatus = 'all' | 'no_note' | StudentNoteStatus

const COMBINED_STATUS_TABS: Array<{ value: CombinedStatus; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'no_note', label: 'Без конспекта' },
  { value: 'draft', label: 'На проверке' },
  { value: 'approved', label: 'Принято' },
  { value: 'rejected', label: 'Отклонено' },
]

type NoteListItem =
  | { kind: 'session'; id: string; at: string; session: NoteSession }
  | { kind: 'note'; id: string; at: string; note: StudentNote }

export const WorkspaceNotesPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { mentorId, params } = useWorkspaceScope()
  const initialStudentId = new URLSearchParams(window.location.search).get('student_id') || ''
  const [studentId, setStudentId] = useState(initialStudentId)
  const [title, setTitle] = useState('')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:notes:studentFilter', initialStudentId)
  const [combinedStatus, setCombinedStatus] = useLocalState<CombinedStatus>('workspace:notes:combinedStatus', 'all')

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['workspace', 'notes', 'students', mentorId],
    queryFn: () => workspaceApi.students(params),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'notes', mentorId],
    queryFn: () => workspaceApi.notes(params),
  })

  const students = (studentsData?.items ?? []).map((item) => item.student)
  const allSessions = data?.sessions ?? []
  const allNotes = data?.notes ?? []
  const draftNotes = allNotes.filter((note) => note.status === 'draft').length
  const loading = isLoading || studentsLoading

  // Sessions with a note are represented by their note below — showing both
  // would be two entry points for the same conversation (the bug this list
  // merge fixes). Sessions without a note yet (still recording, or finished
  // but not drafted) are the only case that legitimately still links to the
  // raw session page.
  const items = useMemo<NoteListItem[]>(() => {
    const sessionItems: NoteListItem[] = (data?.sessions ?? [])
      .filter((session) => !session.note_id)
      .filter((session) => !studentFilter || session.student_id === studentFilter)
      .filter(() => combinedStatus === 'all' || combinedStatus === 'no_note')
      .map((session) => ({ kind: 'session', id: session.id, at: session.started_at, session }))
    const noteItems: NoteListItem[] = (data?.notes ?? [])
      .filter((note) => !studentFilter || note.student_id === studentFilter)
      .filter((note) => combinedStatus === 'all' || combinedStatus === note.status)
      .map((note) => ({ kind: 'note', id: note.id, at: note.created_at, note }))
    return [...sessionItems, ...noteItems].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [data?.sessions, data?.notes, studentFilter, combinedStatus])

  const createSessionMutation = useMutation({
    mutationFn: () => {
      const student = students.find((item) => item.id === studentId)
      return notesApi.createSession({
        student_id: studentId,
        title: title.trim() || (student ? `Конспект ${student.full_name}` : 'Новая сессия конспекта'),
        source: 'workspace',
      })
    },
    onSuccess: (session) => {
      setStudentId('')
      setTitle('')
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      navigate(`/workspace/meetings/session/${session.id}`)
    },
    onError: () => toast({ title: 'Не удалось создать сессию', variant: 'destructive' }),
  })

  return (
    <div className="fade-in">
      {!embedded && (
        <>
          <PageHeader colorPrefix="w"
            eyebrow="Встречи"
            title="Конспекты"
            description="Сессии звонков, расшифровки и AI-конспекты по назначенным студентам."
          />
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <StatCard colorPrefix="w" label="Сессии" value={loading ? '…' : String(data?.total_sessions ?? allSessions.length)} icon={<Mic className="h-5 w-5" />} />
            <StatCard colorPrefix="w" label="AI-конспекты" value={loading ? '…' : String(data?.total_notes ?? allNotes.length)} icon={<BookText className="h-5 w-5" />} />
            <StatCard colorPrefix="w" label="На проверке" value={loading ? '…' : String(draftNotes)} icon={<CheckCircle2 className="h-5 w-5" />} warn={draftNotes > 0} />
          </div>
        </>
      )}

      <AppCard colorPrefix="w" className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
          <Plus className="h-4 w-4 text-w-accentText" />
          Быстро начать конспект
        </div>
        <div className="grid gap-2 md:grid-cols-[260px_1fr_160px]">
          <AppSelect colorPrefix="w"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            className="bg-w-panel2"
          >
            <option value="">Выберите студента</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.full_name}</option>
            ))}
          </AppSelect>
          <AppInput colorPrefix="w"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название сессии, например: Разбор документов / звонок 1"
            className="bg-w-panel2"
          />
          <AppButton colorPrefix="w"
            disabled={!studentId || createSessionMutation.isPending}
            onClick={() => createSessionMutation.mutate()}
          >
            <Mic className="h-4 w-4" />
            Начать
          </AppButton>
        </div>
      </AppCard>

      <AppCard colorPrefix="w" className="mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
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
        <SegmentedTabs colorPrefix="w"
          value={combinedStatus}
          onChange={(value) => setCombinedStatus(value as CombinedStatus)}
          tabs={COMBINED_STATUS_TABS}
        />
      </AppCard>

      <AppCard colorPrefix="w" className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-black text-w-ink">Конспекты</h2>
          <span className="text-xs font-bold text-w-muted">{items.length}</span>
        </div>
        {loading ? (
          <p className="text-sm text-w-muted">Загрузка...</p>
        ) : items.length === 0 ? (
          <EmptyState colorPrefix="w" title="Конспектов нет" description="Создайте конспект из карточки студента." />
        ) : (
          <div className="space-y-2">
            {items.map((item) => item.kind === 'session' ? (
              <Link key={item.id} to={`/workspace/meetings/session/${item.session.id}`} className="block rounded-panel border border-w-line bg-w-panel2 p-3 transition hover:border-w-accentDim">
                <div className="truncate text-sm font-bold text-w-ink">{item.session.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-w-muted">
                  <span>{item.session.student_name}</span>
                  <span>·</span>
                  <span>{formatDate(item.session.started_at)}</span>
                  <Pill colorPrefix="w" tone="accent">{SESSION_STATUS_LABELS[item.session.status]}</Pill>
                  {item.session.transcript_count > 0 && (
                    <>
                      <span>·</span>
                      <span>{item.session.transcript_count} фрагм.</span>
                    </>
                  )}
                </div>
                {item.session.latest_transcript && <div className="mt-2 line-clamp-2 text-xs text-w-muted">{item.session.latest_transcript}</div>}
              </Link>
            ) : (
              <Link key={item.id} to={`/workspace/meetings/notes/${item.note.id}`} className="block rounded-panel border border-w-line bg-w-panel2 p-3 transition hover:border-w-accentDim">
                <div className="truncate text-sm font-bold text-w-ink">{item.note.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-w-muted">
                  <span>{item.note.student_name || 'Без студента'}</span>
                  <span>·</span>
                  <span>{formatDate(item.note.created_at)}</span>
                  <Pill colorPrefix="w" tone={NOTE_STATUS_TONE[item.note.status]}>{NOTE_STATUS_LABELS[item.note.status]}</Pill>
                  {Object.keys(item.note.suggested_changes ?? {}).length > 0 && (
                    <span className="inline-flex items-center gap-1 text-w-accentText">
                      <Sparkles className="h-3 w-3" />
                      есть предложения
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </AppCard>
    </div>
  )
}
