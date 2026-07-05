import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookText, CircleDot, Plus, Sparkles } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { stripMarkdown } from '@/components/shared/Markdown'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionStatus, StudentListItem, StudentNoteStatus } from '@/types'

const sessionStatusOptions: Array<{ value: NoteSessionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все сессии' },
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'cancelled', label: 'Отменённые' },
]

const noteStatusOptions: Array<{ value: StudentNoteStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все конспекты' },
  { value: 'draft', label: 'Черновики' },
  { value: 'approved', label: 'Одобренные' },
  { value: 'rejected', label: 'Отклонённые' },
]

export const NotesPage: React.FC = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [studentSelect, setStudentSelect] = useState('')
  const [sessionStatus, setSessionStatus] = useState<NoteSessionStatus | 'all'>('all')
  const [noteStatus, setNoteStatus] = useState<StudentNoteStatus | 'all'>('all')

  useEffect(() => {
    const studentId = searchParams.get('student_id')
    if (studentId) setStudentSelect(studentId)
    if (searchParams.get('create') === '1') setCreateOpen(true)
  }, [searchParams])

  const { data: students = [] } = useQuery({
    queryKey: ['students', 'notes-start'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['note-sessions', sessionStatus],
    queryFn: () =>
      notesApi.listSessions({
        status: sessionStatus === 'all' ? undefined : sessionStatus,
      }),
  })

  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['notes', noteStatus],
    queryFn: () =>
      notesApi.list({
        status: noteStatus === 'all' ? undefined : noteStatus,
      }),
  })

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === studentSelect),
    [studentSelect, students],
  )

  const createMutation = useMutation({
    mutationFn: async () =>
      notesApi.createSession({
        student_id: studentSelect || undefined,
        title: selectedStudent ? `Конспект ${selectedStudent.full_name}` : 'Новая сессия конспекта',
        source: 'deepgram',
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['note-sessions'] })
      setCreateOpen(false)
      setStudentSelect('')
      navigate(`/notes/session/${session.id}`)
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось создать сессию', variant: 'destructive' })
    },
  })

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <BookText className="w-4 h-4" />
            Конспекты
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-950">
            Сессии и конспекты
          </h1>
          <p className="mt-2 text-sm text-slate-500 max-w-2xl">
            Откройте новую сессию, дайте доступ к микрофону или экрану, затем проверьте AI-черновик и примените изменения к профилю студента.
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Новая сессия
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-slate-900">Сессии</CardTitle>
                <CardDescription>Живые и завершённые записи</CardDescription>
              </div>
              <Select value={sessionStatus} onValueChange={(v) => setSessionStatus(v as NoteSessionStatus | 'all')}>
                <SelectTrigger className="w-40 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionStatusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="py-12 text-center text-slate-400">Загрузка...</div>
            ) : sessions.length === 0 ? (
              <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                Сессий пока нет. Создайте первую и начните запись.
              </div>
            ) : (
              <div className="grid gap-3">
                {sessions.map((session) => (
                  <div key={session.id} className="rounded-[2px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-[0.2em]">
                          <CircleDot className={`w-3.5 h-3.5 ${session.status === 'active' ? 'text-emerald-500' : 'text-slate-400'}`} />
                          {session.status}
                        </div>
                        <Link to={`/notes/session/${session.id}`} className="mt-1 block font-semibold text-slate-900 hover:underline underline-offset-4">
                          {session.title}
                        </Link>
                        <p className="mt-1 text-sm text-slate-500">
                          {session.student_name ?? 'Без привязки к студенту'} · {formatDate(session.started_at)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                          {session.latest_transcript || 'Пока нет транскрипта'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Фрагменты</p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{session.transcript_count}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button size="sm" asChild>
                        <Link to={`/notes/session/${session.id}`}>Открыть</Link>
                      </Button>
                      {session.note_id && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/notes/${session.note_id}`}>Конспект</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-slate-900">Конспекты</CardTitle>
                <CardDescription>История AI-черновиков и проверок</CardDescription>
              </div>
              <Select value={noteStatus} onValueChange={(v) => setNoteStatus(v as StudentNoteStatus | 'all')}>
                <SelectTrigger className="w-40 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {noteStatusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {notesLoading ? (
              <div className="py-12 text-center text-slate-400">Загрузка...</div>
            ) : notes.length === 0 ? (
              <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                Конспектов пока нет.
              </div>
            ) : (
              <div className="grid gap-3">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-[2px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link to={`/notes/${note.id}`} className="block font-semibold text-slate-900 hover:underline underline-offset-4">
                          {note.title}
                        </Link>
                        <p className="mt-1 text-sm text-slate-500">
                          {note.student_name ?? 'Без привязки'} · {formatDate(note.created_at)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                          {stripMarkdown(note.summary_markdown)}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        {note.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-4">
          <CardTitle className="text-base text-slate-900">Короткий вход</CardTitle>
          <CardDescription>Быстро создайте новую сессию для студента</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select value={studentSelect || 'all'} onValueChange={(v) => setStudentSelect(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Выберите студента" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Без привязки</SelectItem>
              {students.map((student: StudentListItem) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}>
            <Sparkles className="w-4 h-4 mr-2" />
            Создать
          </Button>
        </CardContent>
        {students.length === 0 && (
          <div className="px-6 pb-5 text-sm text-slate-500">
            Список студентов пуст. Для mentor это обычно означает, что ещё не создано или не активировано назначение MentorAssignment.
          </div>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Новая сессия конспекта</DialogTitle>
            <DialogDescription>
              Сессия создаётся в стиле ZoomScribe: сначала запись и транскрипция, затем AI-черновик и подтверждение изменений.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Студент</p>
            <Select value={studentSelect || 'all'} onValueChange={(v) => setStudentSelect(v === 'all' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Без привязки" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Без привязки</SelectItem>
                {students.map((student: StudentListItem) => (
                  <SelectItem key={student.id} value={student.id}>
                    {student.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Создаю…' : 'Начать сессию'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
