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
import { NoteSessionStatus, StudentNoteStatus } from '@/types'
import {
  WorkspaceButton,
  WorkspaceCard,
  WorkspaceEmptyState,
  WorkspaceInput,
  WorkspacePageHeader,
  WorkspaceSegmentedTabs,
  WorkspaceSelect,
  WorkspaceStatCard,
  WorkspaceStatusPill,
} from '@/components/workspace/ui'

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

export const WorkspaceNotesPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { mentorId, params } = useWorkspaceScope()
  const initialStudentId = new URLSearchParams(window.location.search).get('student_id') || ''
  const [studentId, setStudentId] = useState(initialStudentId)
  const [title, setTitle] = useState('')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:notes:studentFilter', initialStudentId)
  const [sessionStatus, setSessionStatus] = useLocalState<'all' | NoteSessionStatus>('workspace:notes:sessionStatus', 'all')
  const [noteStatus, setNoteStatus] = useLocalState<'all' | StudentNoteStatus>('workspace:notes:noteStatus', 'all')

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['workspace', 'notes', 'students', mentorId],
    queryFn: () => workspaceApi.students(params),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'notes', mentorId],
    queryFn: () => workspaceApi.notes(params),
  })

  const students = (studentsData?.items ?? []).map((item) => item.student)
  const sessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => !studentFilter || session.student_id === studentFilter)
    .filter((session) => sessionStatus === 'all' || session.status === sessionStatus)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()), [data?.sessions, sessionStatus, studentFilter])
  const notes = useMemo(() => (data?.notes ?? [])
    .filter((note) => !studentFilter || note.student_id === studentFilter)
    .filter((note) => noteStatus === 'all' || note.status === noteStatus)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [data?.notes, noteStatus, studentFilter])
  const draftNotes = notes.filter((note) => note.status === 'draft').length
  const loading = isLoading || studentsLoading

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
          <WorkspacePageHeader
            eyebrow="Встречи"
            title="Конспекты"
            description="Сессии звонков, расшифровки и AI-конспекты по назначенным студентам."
          />
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <WorkspaceStatCard label="Сессии" value={loading ? '…' : String(data?.total_sessions ?? sessions.length)} icon={<Mic className="h-5 w-5" />} />
            <WorkspaceStatCard label="AI-конспекты" value={loading ? '…' : String(data?.total_notes ?? notes.length)} icon={<BookText className="h-5 w-5" />} />
            <WorkspaceStatCard label="На проверке" value={loading ? '…' : String(draftNotes)} icon={<CheckCircle2 className="h-5 w-5" />} warn={draftNotes > 0} />
          </div>
        </>
      )}

      <WorkspaceCard className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink">
          <Plus className="h-4 w-4 text-w-accentText" />
          Быстро начать конспект
        </div>
        <div className="grid gap-2 md:grid-cols-[260px_1fr_160px]">
          <WorkspaceSelect
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            className="bg-w-panel2"
          >
            <option value="">Выберите студента</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.full_name}</option>
            ))}
          </WorkspaceSelect>
          <WorkspaceInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название сессии, например: Разбор документов / звонок 1"
            className="bg-w-panel2"
          />
          <WorkspaceButton
            disabled={!studentId || createSessionMutation.isPending}
            onClick={() => createSessionMutation.mutate()}
          >
            <Mic className="h-4 w-4" />
            Начать
          </WorkspaceButton>
        </div>
      </WorkspaceCard>

      <WorkspaceCard className="mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <WorkspaceSelect
          value={studentFilter}
          onChange={(event) => setStudentFilter(event.target.value)}
          className="bg-w-panel2 md:min-w-[260px]"
        >
          <option value="">Все мои студенты</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </WorkspaceSelect>
        <WorkspaceSegmentedTabs
          value={sessionStatus}
          onChange={setSessionStatus}
          options={[
            { value: 'all', label: 'Все сессии' },
            { value: 'active', label: 'Идёт запись' },
            { value: 'completed', label: 'Завершены' },
            { value: 'cancelled', label: 'Отменены' },
          ]}
        />
      </WorkspaceCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <WorkspaceCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-black text-w-ink">Сессии</h2>
            <span className="text-xs font-bold text-w-muted">{sessions.length}</span>
          </div>
          {loading ? (
            <p className="text-sm text-w-muted">Загрузка...</p>
          ) : sessions.length === 0 ? (
            <WorkspaceEmptyState title="Сессий нет" text="Создайте конспект из карточки студента." />
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <Link key={session.id} to={`/workspace/meetings/session/${session.id}`} className="block rounded-[16px] border border-w-line bg-w-panel2 p-3 transition hover:border-w-accentDim">
                  <div className="truncate text-sm font-bold text-w-ink">{session.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-w-muted">
                    <span>{session.student_name}</span>
                    <span>·</span>
                    <span>{formatDate(session.started_at)}</span>
                    <span>·</span>
                    <span>{SESSION_STATUS_LABELS[session.status]}</span>
                    {session.transcript_count > 0 && (
                      <>
                        <span>·</span>
                        <span>{session.transcript_count} фрагм.</span>
                      </>
                    )}
                  </div>
                  {session.latest_transcript && <div className="mt-2 line-clamp-2 text-xs text-w-muted">{session.latest_transcript}</div>}
                </Link>
              ))}
            </div>
          )}
        </WorkspaceCard>

        <WorkspaceCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-black text-w-ink">AI-заметки</h2>
            <div className="flex items-center gap-2">
              <WorkspaceSelect
                value={noteStatus}
                onChange={(event) => setNoteStatus(event.target.value as typeof noteStatus)}
                className="min-h-9 bg-w-panel2 px-2 text-xs"
              >
                <option value="all">Все</option>
                <option value="draft">На проверке</option>
                <option value="approved">Принято</option>
                <option value="rejected">Отклонено</option>
              </WorkspaceSelect>
              <span className="text-xs font-bold text-w-muted">{notes.length}</span>
            </div>
          </div>
          {loading ? (
            <p className="text-sm text-w-muted">Загрузка...</p>
          ) : notes.length === 0 ? (
            <WorkspaceEmptyState title="AI-заметок нет" text="После финализации конспекта заметки появятся здесь." />
          ) : (
            <div className="space-y-2">
              {notes.map((note) => (
                <Link key={note.id} to={`/workspace/meetings/notes/${note.id}`} className="block rounded-[16px] border border-w-line bg-w-panel2 p-3 transition hover:border-w-accentDim">
                  <div className="truncate text-sm font-bold text-w-ink">{note.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-w-muted">
                    <span>{note.student_name || 'Без студента'}</span>
                    <span>·</span>
                    <span>{formatDate(note.created_at)}</span>
                    <WorkspaceStatusPill tone={NOTE_STATUS_TONE[note.status]}>{NOTE_STATUS_LABELS[note.status]}</WorkspaceStatusPill>
                    {Object.keys(note.suggested_changes ?? {}).length > 0 && (
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
        </WorkspaceCard>
      </div>
    </div>
  )
}
