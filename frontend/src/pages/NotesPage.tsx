import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CircleDot, Plus, Search } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { Input } from '@/components/ui/primitives/input'
import { stripMarkdown } from '@/components/shared/Markdown'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { NoteSessionStatus, StudentListItem, StudentNoteStatus, DegreeLevel } from '@/types'
import { DEGREE_LEVEL_LABELS } from '@/types'
import { PageHeader } from '@/components/ui'
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const NOTE_PILL: Record<StudentNoteStatus, { label: string; cls: string }> = {
  draft: { label: 'Ждёт проверки', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Применён', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Отклонён', cls: 'bg-red-100 text-red-700' },
}

export const NotesPage: React.FC = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [studentSelect, setStudentSelect] = useState('')
  const [sessionStatus, setSessionStatus] = useState<NoteSessionStatus | 'all'>('all')
  const [noteStatus, setNoteStatus] = useState<StudentNoteStatus | 'all'>('all')
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
  const matchesSearch = useCallback((title: string, studentName: string | null | undefined, studentId: string | null | undefined) => {
    if (!q) return true
    if (title.toLowerCase().includes(q)) return true
    if ((studentName ?? '').toLowerCase().includes(q)) return true
    const student = studentId ? directory.byId.get(studentId) : undefined
    return Boolean(student?.phone?.toLowerCase().includes(q))
  }, [q, directory.byId])
  const filteredSessions = useMemo(
    () =>
      sessions
        .filter((s) => matchesSearch(s.title, s.student_name, s.student_id))
        .filter((s) => matchesDirectoryFilters(s.student_id ? directory.byId.get(s.student_id) : undefined, directoryFilters)),
    [sessions, matchesSearch, directoryFilters, directory.byId],
  )
  const filteredNotes = useMemo(
    () =>
      notes
        .filter((n) => matchesSearch(n.title, n.student_name, n.student_id))
        .filter((n) => matchesDirectoryFilters(n.student_id ? directory.byId.get(n.student_id) : undefined, directoryFilters)),
    [notes, matchesSearch, directoryFilters, directory.byId],
  )

  // Merge sessions + their AI notes into one per-student group so a mentor sees
  // "history by person" with a "N ждут проверки" badge, instead of two parallel
  // columns of the same students (variant 2 of the redesign).
  const noteById = useMemo(() => {
    const m = new Map<string, (typeof notes)[number]>()
    for (const n of notes) m.set(n.id, n)
    return m
  }, [notes])

  const groups = useMemo(() => {
    type Group = {
      key: string
      name: string
      sessions: typeof filteredSessions
      notes: typeof filteredNotes
      pending: number
      latest: number
    }
    const map = new Map<string, Group>()
    const ensure = (id: string | null | undefined, name: string | null | undefined): Group => {
      const key = id || '__none__'
      let g = map.get(key)
      if (!g) {
        g = { key, name: name || 'Без привязки к студенту', sessions: [], notes: [], pending: 0, latest: 0 }
        map.set(key, g)
      }
      return g
    }
    for (const s of filteredSessions) {
      const g = ensure(s.student_id, s.student_name)
      g.sessions.push(s)
      const t = new Date(s.started_at).getTime()
      if (t > g.latest) g.latest = t
    }
    for (const n of filteredNotes) {
      const g = ensure(n.student_id, n.student_name)
      g.notes.push(n)
      if (n.status === 'draft') g.pending += 1
      const t = new Date(n.created_at).getTime()
      if (t > g.latest) g.latest = t
    }
    // Students who have drafts waiting for review float to the top.
    return [...map.values()].sort(
      (a, b) => b.pending - a.pending || b.latest - a.latest || a.name.localeCompare(b.name, 'ru'),
    )
  }, [filteredSessions, filteredNotes])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const didInitExpand = useRef(false)
  useEffect(() => {
    // First time the list loads, open the students who have pending reviews so
    // the work-to-do is visible without a click; leave the rest collapsed.
    if (!didInitExpand.current && groups.length) {
      didInitExpand.current = true
      setExpanded(new Set(groups.filter((g) => g.pending > 0).map((g) => g.key)))
    }
  }, [groups])
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const listLoading = sessionsLoading || notesLoading

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

  return (
    <div className="space-y-5">
      <PageHeader
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

      <Card className="border-p-line bg-white">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base text-p-text">По студентам</CardTitle>
              <CardDescription>Сессии и их AI-конспекты, сгруппированы по ученику</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={sessionStatus} onValueChange={(v) => setSessionStatus(v as NoteSessionStatus | 'all')}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sessionStatusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={noteStatus} onValueChange={(v) => setNoteStatus(v as StudentNoteStatus | 'all')}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {noteStatusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <div className="py-12 text-center text-p-muted2">Загрузка...</div>
          ) : groups.length === 0 ? (
            <div className="rounded-panel border border-p-line bg-p-bg p-5 text-sm text-p-muted">
              {sessions.length === 0 && notes.length === 0
                ? 'Сессий пока нет. Создайте первую и начните запись.'
                : 'Ничего не найдено по текущим фильтрам.'}
            </div>
          ) : (
            <div className="grid gap-2">
              {groups.map((group) => {
                const open = expanded.has(group.key)
                const shownNoteIds = new Set(group.sessions.map((s) => s.note_id).filter(Boolean) as string[])
                const orphanNotes = group.notes.filter((n) => !shownNoteIds.has(n.id))
                return (
                  <div key={group.key} className="overflow-hidden rounded-panel border border-p-line bg-p-bg">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-p-panel"
                      aria-expanded={open}
                    >
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-p-muted2 transition-transform', open && 'rotate-180')} />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black text-[11px] font-bold text-white">
                        {initials(group.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-p-text">{group.name}</span>
                        <span className="block text-xs text-p-muted">
                          {group.sessions.length} {group.sessions.length === 1 ? 'сессия' : 'сессий'}
                          {group.latest ? ` · обновлено ${formatDate(new Date(group.latest).toISOString())}` : ''}
                        </span>
                      </span>
                      {group.pending > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                          {group.pending} ждут проверки
                        </span>
                      )}
                    </button>

                    {open && (
                      <div className="divide-y divide-p-line border-t border-p-line">
                        {group.sessions.map((session) => {
                          const note = session.note_id ? noteById.get(session.note_id) : undefined
                          const pill = note ? NOTE_PILL[note.status as StudentNoteStatus] : undefined
                          return (
                            <div key={session.id} className="flex flex-wrap items-start gap-3 bg-white px-4 py-3">
                              <CircleDot className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', session.status === 'active' ? 'text-emerald-500' : 'text-p-muted2')} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link to={`/notes/session/${session.id}`} className="truncate font-medium text-p-text underline-offset-4 hover:underline">
                                    {session.title}
                                  </Link>
                                  {pill && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', pill.cls)}>{pill.label}</span>}
                                </div>
                                <p className="mt-0.5 text-xs text-p-muted2">
                                  {formatDate(session.started_at)} · {session.transcript_count} фрагм.
                                </p>
                                <p className="mt-1 line-clamp-1 text-sm text-p-muted">
                                  {session.latest_transcript || 'Пока нет транскрипта'}
                                </p>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                {session.note_id ? (
                                  <Button size="sm" asChild>
                                    <Link to={`/notes/${session.note_id}`}>Конспект</Link>
                                  </Button>
                                ) : (
                                  <Button size="sm" asChild>
                                    <Link to={`/notes/session/${session.id}`}>Открыть</Link>
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        {orphanNotes.map((note) => {
                          const pill = NOTE_PILL[note.status as StudentNoteStatus]
                          return (
                            <div key={note.id} className="flex flex-wrap items-start gap-3 bg-white px-4 py-3">
                              <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-p-muted2" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link to={`/notes/${note.id}`} className="truncate font-medium text-p-text underline-offset-4 hover:underline">
                                    {note.title}
                                  </Link>
                                  {pill && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', pill.cls)}>{pill.label}</span>}
                                </div>
                                <p className="mt-0.5 text-xs text-p-muted2">{formatDate(note.created_at)}</p>
                                <p className="mt-1 line-clamp-1 text-sm text-p-muted">{stripMarkdown(note.summary_markdown)}</p>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <Button variant="outline" size="sm" asChild>
                                  <Link to={`/notes/${note.id}`}>Конспект</Link>
                                </Button>
                              </div>
                            </div>
                          )
                        })}

                        {group.sessions.length === 0 && orphanNotes.length === 0 && (
                          <p className="px-4 py-3 text-sm text-p-muted">Нет записей по текущему фильтру.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Подготовка · выберите ученика</DialogTitle>
            <DialogDescription>
              На следующем экране выберете источник звука и начнёте запись.
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
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !studentSelect}>
              {createMutation.isPending ? 'Создаю…' : 'Продолжить'}
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
      <div className="max-h-56 overflow-y-auto rounded-panel border border-p-line divide-y divide-p-line">
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
