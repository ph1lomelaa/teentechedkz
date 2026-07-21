import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Plus, Search, Trash2 } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { stripMarkdown } from '@/components/shared/Markdown'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import type { NoteSession, NoteSessionStatus, StudentListItem, StudentNote, StudentNoteStatus, DegreeLevel } from '@/types'
import { DEGREE_LEVEL_LABELS } from '@/types'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'

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
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<NoteSession | null>(null)
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<StudentNote | null>(null)
  const [search, setSearch] = useState('')
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const directory = useStudentDirectory()

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

  // Свои студенты — в начале списка, чтобы не искать среди чужих
  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => Number(b.is_mine ?? false) - Number(a.is_mine ?? false) || a.full_name.localeCompare(b.full_name, 'ru'),
      ),
    [students],
  )

  const q = search.trim().toLowerCase()
  const filteredSessions = useMemo(
    () =>
      sessions
        .filter((s) => !q || s.title.toLowerCase().includes(q) || (s.student_name ?? '').toLowerCase().includes(q))
        .filter((s) => matchesDirectoryFilters(s.student_id ? directory.byId.get(s.student_id) : undefined, directoryFilters)),
    [sessions, q, directoryFilters, directory.byId],
  )
  const filteredNotes = useMemo(
    () =>
      notes
        .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.student_name ?? '').toLowerCase().includes(q))
        .filter((n) => matchesDirectoryFilters(n.student_id ? directory.byId.get(n.student_id) : undefined, directoryFilters)),
    [notes, q, directoryFilters, directory.byId],
  )

  const activeFiltersCount =
    (directoryFilters.year ? 1 : 0) +
    (directoryFilters.country ? 1 : 0) +
    (directoryFilters.degree ? 1 : 0) +
    (directoryFilters.responsibleId ? 1 : 0)
  const responsibleName = (id: string) => directory.responsibleUsers.find((u) => u.id === id)?.name ?? id
  const resetDirectoryFilters = () => setDirectoryFilters(EMPTY_DIRECTORY_FILTERS)
  const filterChips = [
    directoryFilters.year && { key: 'year', label: `Год: ${directoryFilters.year}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, year: '' })) },
    directoryFilters.country && { key: 'country', label: `Страна: ${directoryFilters.country}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, country: '' })) },
    directoryFilters.degree && {
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[directoryFilters.degree as DegreeLevel] ?? directoryFilters.degree}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, degree: '' })),
    },
    directoryFilters.responsibleId && {
      key: 'responsible',
      label: `Ответственный: ${responsibleName(directoryFilters.responsibleId)}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, responsibleId: '' })),
    },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

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

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => notesApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-sessions'] })
      setSessionDeleteTarget(null)
      toast({ title: 'Сессия удалена' })
    },
    onError: (err) => {
      toast({ title: 'Ошибка', description: getErrorMessage(err, 'Не удалось удалить сессию'), variant: 'destructive' })
    },
  })

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => notesApi.delete(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['note-sessions'] })
      setNoteDeleteTarget(null)
      toast({ title: 'Конспект удалён' })
    },
    onError: (err) => {
      toast({ title: 'Ошибка', description: getErrorMessage(err, 'Не удалось удалить конспект'), variant: 'destructive' })
    },
  })

  return (
    <div className="space-y-5">
      <CrmPageHeader
        eyebrow="Конспекты"
        title="Сессии и конспекты"
        description="Откройте новую сессию, дайте доступ к микрофону или экрану, затем проверьте AI-черновик и примените изменения к профилю студента."
        action={(
          <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Новая сессия
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск по названию или студенту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <FilterPopover activeCount={activeFiltersCount} onReset={resetDirectoryFilters}>
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Год">
              <Select
                value={directoryFilters.year || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, year: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все годы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все годы</SelectItem>
                  {directory.years.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ступень">
              <Select
                value={directoryFilters.degree || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, degree: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все ступени" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ступени</SelectItem>
                  {directory.degrees.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {DEGREE_LEVEL_LABELS[opt.value as DegreeLevel] ?? opt.value} · {opt.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          <FilterField label="Страна поступления">
            <Select
              value={directoryFilters.country || 'all'}
              onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, country: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все страны" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все страны</SelectItem>
                {directory.countries.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          {directory.canFilterByResponsible && (
            <FilterField label="Ответственный (ментор/МЗК)">
              <ResponsiblePicker
                users={directory.responsibleUsers}
                value={directoryFilters.responsibleId}
                onChange={(id) => setDirectoryFilters((f) => ({ ...f, responsibleId: id }))}
              />
            </FilterField>
          )}
        </FilterPopover>
      </div>

      <FilterChips chips={filterChips} onResetAll={resetDirectoryFilters} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-p-line bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-p-text">Сессии</CardTitle>
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
              <div className="py-12 text-center text-p-muted2">Загрузка...</div>
            ) : sessions.length === 0 ? (
              <div className="rounded-[2px] border border-p-line bg-p-bg p-5 text-sm text-p-muted">
                Сессий пока нет. Создайте первую и начните запись.
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="rounded-[2px] border border-p-line bg-p-bg p-5 text-sm text-p-muted">
                Ничего не найдено по текущим фильтрам.
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredSessions.map((session) => (
                  <div key={session.id} className="rounded-[2px] border border-p-line bg-p-bg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-p-muted2 uppercase tracking-[0.2em]">
                          <CircleDot className={`w-3.5 h-3.5 ${session.status === 'active' ? 'text-emerald-500' : 'text-p-muted2'}`} />
                          {session.status}
                        </div>
                        <Link to={`/notes/session/${session.id}`} className="mt-1 block font-semibold text-p-text hover:underline underline-offset-4">
                          {session.title}
                        </Link>
                        <p className="mt-1 text-sm text-p-muted">
                          {session.student_name ?? 'Без привязки к студенту'} · {formatDate(session.started_at)}
                        </p>
                        <p className="mt-2 text-sm text-p-muted line-clamp-2">
                          {session.latest_transcript || 'Пока нет транскрипта'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-p-muted2 uppercase tracking-[0.2em]">Фрагменты</p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{session.transcript_count}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button size="sm" asChild>
                        <Link to={`/notes/session/${session.id}`}>
                          {session.note_id ? 'Просмотреть' : 'Открыть'}
                        </Link>
                      </Button>
                      {session.note_id && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/notes/${session.note_id}`}>Конспект</Link>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setSessionDeleteTarget(session)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-p-line bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-p-text">Конспекты</CardTitle>
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
              <div className="py-12 text-center text-p-muted2">Загрузка...</div>
            ) : notes.length === 0 ? (
              <div className="rounded-[2px] border border-p-line bg-p-bg p-5 text-sm text-p-muted">
                Конспектов пока нет.
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="rounded-[2px] border border-p-line bg-p-bg p-5 text-sm text-p-muted">
                Ничего не найдено по текущим фильтрам.
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredNotes.map((note) => (
                  <div key={note.id} className="rounded-[2px] border border-p-line bg-p-bg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link to={`/notes/${note.id}`} className="block font-semibold text-p-text hover:underline underline-offset-4">
                          {note.title}
                        </Link>
                        <p className="mt-1 text-sm text-p-muted">
                          {note.student_name ?? 'Без привязки'} · {formatDate(note.created_at)}
                        </p>
                        <p className="mt-2 text-sm text-p-muted line-clamp-2">
                          {stripMarkdown(note.summary_markdown)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="rounded-full border border-p-line bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-p-muted">
                          {note.status}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setNoteDeleteTarget(note)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Новая сессия конспекта</DialogTitle>
            <DialogDescription>
              Сессия создаётся в стиле ZoomScribe: сначала запись и транскрипция, затем AI-черновик и подтверждение изменений.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-p-muted">Студент</p>
            <StudentSearchPicker students={sortedStudents} value={studentSelect} onChange={setStudentSelect} />
            {students.length === 0 && (
              <p className="text-xs text-p-muted">
                Список студентов пуст. Для mentor это обычно означает, что ещё не создано или не активировано назначение MentorAssignment.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Создаю…' : 'Начать сессию'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sessionDeleteTarget} onOpenChange={() => setSessionDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить сессию?</DialogTitle>
            <DialogDescription>
              «{sessionDeleteTarget?.title}» и все её фрагменты транскрипта будут удалены без возможности восстановления.
              {sessionDeleteTarget?.note_id && ' Связанный конспект удалён не будет.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => sessionDeleteTarget && deleteSessionMutation.mutate(sessionDeleteTarget.id)}
              disabled={deleteSessionMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noteDeleteTarget} onOpenChange={() => setNoteDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить конспект?</DialogTitle>
            <DialogDescription>
              «{noteDeleteTarget?.title}» будет удалён без возможности восстановления. Уже применённые изменения профиля студента отменены не будут.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => noteDeleteTarget && deleteNoteMutation.mutate(noteDeleteTarget.id)}
              disabled={deleteNoteMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Поиск студента по имени вместо длинного выпадающего списка; свои студенты
 * идут первыми (см. sortedStudents). value === '' — сессия без привязки. */
function StudentSearchPicker({
  students,
  value,
  onChange,
}: {
  students: StudentListItem[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? students.filter((s) => s.full_name.toLowerCase().includes(q)) : students).slice(0, 30),
    [students, q],
  )

  return (
    <div className="space-y-2">
      <Input
        placeholder="Поиск студента по имени..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-10"
      />
      <div className="max-h-56 overflow-y-auto rounded-[2px] border border-p-line divide-y divide-p-line">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
            value === '' ? 'bg-black text-white' : 'text-p-text hover:bg-p-bg'
          }`}
        >
          Без привязки
        </button>
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              value === s.id ? 'bg-black text-white' : 'text-p-text hover:bg-p-bg'
            }`}
          >
            {s.full_name}
            {s.is_mine && (
              <span className={`ml-2 text-[10px] uppercase tracking-wide ${value === s.id ? 'text-white/60' : 'text-p-muted2'}`}>
                мой
              </span>
            )}
            <span className={`ml-2 text-xs ${value === s.id ? 'text-white/60' : 'text-p-muted'}`}>{s.intake_year}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="px-3 py-4 text-sm text-p-muted">Не найдено</p>}
      </div>
    </div>
  )
}
