import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Plus } from 'lucide-react'
import { normalizeMeetingLink } from '@/lib/meetingLink'
import { MeetingType, meetingsApi, MeetingStatus } from '@/api/meetings'
import { notesApi } from '@/api/notes'
import { workspaceApi, type WorkspaceMeeting } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { AppButton, AppInput, AppSelect, EmptyState, PageHeader, Pill, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { QueryState } from '@/components/shared/QueryState'

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
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WorkspaceMeeting | null>(null)
  const [duration, setDuration] = useState('60')
  const [withoutNotes, setWithoutNotes] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const [studentId, setStudentId] = useState('')
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState<MeetingType>('regular')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [dateFocused, setDateFocused] = useState(false)
  const [link, setLink] = useState('')
  const [scope, setScope] = useLocalState<'upcoming' | 'all' | MeetingStatus>('workspace:meetings:scope', 'upcoming')
  const [studentFilter, setStudentFilter] = useLocalState('workspace:meetings:studentFilter', '')
  // IELTS — фильтр списка, а не отдельная вкладка: вкладки сверху над
  // формой выглядели как вторая навигация. Конспекты переехали в свой пункт
  // меню; старые ссылки `?tab=notes` / `?tab=ielts` продолжают работать.
  const [typeFilter, setTypeFilter] = useLocalState<'all' | 'ielts' | MeetingType>('workspace:meetings:typeFilter', 'all')
  const tabParam = searchParams.get('tab')

  useEffect(() => {
    if (tabParam === 'notes') {
      navigate('/workspace/notes', { replace: true })
    } else if (tabParam === 'ielts') {
      setTypeFilter('ielts')
      const next = new URLSearchParams(searchParams)
      next.delete('tab')
      setSearchParams(next, { replace: true })
    }
  }, [tabParam, navigate, searchParams, setSearchParams, setTypeFilter])

  useEffect(() => {
    if (typeFilter === 'ielts') setMeetingType('ielts_lesson')
  }, [typeFilter])

  const { data: studentsData, isLoading: studentsLoading, isError: studentsFailed, error: studentsError, refetch: refetchStudents } = useQuery({
    queryKey: ['workspace', 'meetings', 'students', mentorId],
    queryFn: () => workspaceApi.students(params),
  })

  const students = (studentsData?.items ?? []).map((item) => item.student)
  const { data: meetingsData, isLoading: meetingsLoading, isError: meetingsFailed, error: meetingsError, refetch: refetchMeetings } = useQuery({
    queryKey: ['workspace', 'meetings', mentorId],
    queryFn: () => workspaceApi.meetings(params),
  })

  const { data: notesData, isLoading: notesLoading, isError: notesFailed, error: notesError, refetch: refetchNotes } = useQuery({ queryKey: ['workspace', 'notes', mentorId], queryFn: () => workspaceApi.notes(params) })
  const sessions = notesData?.sessions ?? []
  const sessionFor = (meeting: WorkspaceMeeting) => sessions.find((s) => s.id === meeting.note_session_id || s.meeting_id === meeting.id)
  const hasNote = (meeting: WorkspaceMeeting) => Boolean(sessionFor(meeting)?.note_id)
  const category = (meeting: WorkspaceMeeting) => meeting.status === 'cancelled' ? 'cancelled' : meeting.status === 'completed' || new Date(meeting.ends_at || meeting.starts_at).getTime() < now ? 'completed' : 'upcoming'
  const activeScope = scope === 'scheduled' || scope === 'all' ? 'upcoming' : scope
  const filtered = (meetingsData?.items ?? []).filter((m) => !studentFilter || m.student_id === studentFilter).filter((m) => typeFilter === 'all' || (typeFilter === 'ielts' ? m.meeting_type.startsWith('ielts') : m.meeting_type === typeFilter))
  const noNotesCount = filtered.filter((m) => category(m) === 'completed' && !hasNote(m)).length
  const meetings = filtered.filter((m) => category(m) === activeScope && (!withoutNotes || activeScope !== 'completed' || !hasNote(m))).sort((a,b) => activeScope === 'completed' ? Date.parse(b.starts_at) - Date.parse(a.starts_at) : Date.parse(a.starts_at) - Date.parse(b.starts_at))
  const groups = new Map<string, WorkspaceMeeting[]>()
  meetings.forEach((m) => { const key = new Date(m.starts_at).toLocaleDateString('en-CA'); groups.set(key, [...(groups.get(key) ?? []), m]) })
  const dayLabel = (iso: string) => {
    const date = new Date(iso), today = new Date(now), tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.toDateString() === today.toDateString()) return 'Сегодня'
    if (date.toDateString() === tomorrow.toDateString()) return 'Завтра'
    const label = date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  const openCreate = (id = '') => { setEditing(null); setStudentId(id); setTitle(''); setMeetingType('regular'); setStartsAt(''); setDuration('60'); setLink(''); setDescription(''); setDialogOpen(true) }
  useEffect(() => {
    const id = searchParams.get('student_id')
    if (!id && searchParams.get('new') !== '1') return
    openCreate(id ?? '')
    const next = new URLSearchParams(searchParams); next.delete('student_id'); next.delete('new'); setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
  const editMeeting = (m: WorkspaceMeeting) => {
    setEditing(m); setStudentId(m.student_id); setTitle(m.title); setMeetingType(m.meeting_type); setDescription(m.description); setLink(m.meeting_link)
    const date = new Date(m.starts_at); setStartsAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16))
    setDuration(String(Math.max(1, Math.round((Date.parse(m.ends_at) - Date.parse(m.starts_at))/60000)))); setDialogOpen(true)
  }
  const missing = [!studentId && 'студента', (!startsAt || !Number.isFinite(Date.parse(startsAt))) && 'дату и время', (!Number.isFinite(Number(duration)) || !Number.isInteger(Number(duration)) || Number(duration) < 1) && 'длительность в целых минутах', normalizeMeetingLink(link) === null && 'ссылку в формате https://…'].filter(Boolean)
  const cancelMutation = useMutation({ mutationFn: (id: string) => meetingsApi.update(id, { status: 'cancelled' }), onSuccess: () => refresh(), onError: () => toast({ title: 'Не удалось отменить встречу', variant: 'destructive' }) })

  // Переход из уведомления «Встреча идёт, запись не включена»: сразу открываем
  // запись этой встречи. И возврат из Zoom после подключения.
  const recordMeetingId = searchParams.get('record')
  const zoomResult = searchParams.get('zoom')
  useEffect(() => {
    if (!recordMeetingId && !zoomResult) return
    if (zoomResult) {
      toast(zoomResult === 'connected'
        ? { title: 'Zoom подключён', description: 'Теперь бот может заходить в ваши встречи Zoom.' }
        : { title: 'Не удалось подключить Zoom', variant: 'destructive' })
    }
    if (recordMeetingId) {
      const meeting = meetingsData?.items?.find((item) => item.id === recordMeetingId)
      if (!meeting) {
        if (meetingsLoading) return
        toast({ title: 'Встреча не найдена', variant: 'destructive' })
      } else if (meeting.note_session_id) {
        navigate(`/workspace/meetings/session/${meeting.note_session_id}${meeting.meeting_link ? `?url=${encodeURIComponent(meeting.meeting_link)}` : ''}`)
      } else {
        createNoteSessionMutation.mutate(meeting)
      }
    }
    const next = new URLSearchParams(searchParams)
    next.delete('record')
    next.delete('zoom')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- срабатывает один раз на параметры ссылки
  }, [recordMeetingId, zoomResult, meetingsData?.items, meetingsLoading])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workspace', 'meetings'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student'] })
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const start = new Date(startsAt)
      const end = new Date(start.getTime() + Number(duration) * 60 * 1000)
      const body = {
        student_id: studentId,
        title: title.trim() || `${MEETING_TYPE_LABELS[meetingType]}: ${students.find((s) => s.id === studentId)?.full_name || 'студентом'}`,
        meeting_type: meetingType,
        description: description.trim(),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        meeting_link: normalizeMeetingLink(link) ?? '',
      }
      return editing ? meetingsApi.update(editing.id, body) : meetingsApi.create(body)
    },
    onSuccess: () => {
      setDialogOpen(false)
      setEditing(null)
      setTitle('')
      setMeetingType('regular')
      setDescription('')
      setStartsAt('')
      setDuration('60')
      setLink('')
      refresh()
      toast({ title: editing ? 'Встреча изменена' : 'Встреча создана' })
    },
    onError: () => toast({ title: 'Не удалось создать встречу', variant: 'destructive' }),
  })

  const createNoteSessionMutation = useMutation({
    mutationFn: (meeting: { id: string; student_id: string; title: string; meeting_link?: string }) => notesApi.createSession({
      student_id: meeting.student_id,
      meeting_id: meeting.id,
      title: `Конспект: ${meeting.title}`,
      source: 'meeting',
    }),
    onSuccess: (session, meeting) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      // Ссылка встречи подставляется в «Отправить бота» — ментору остаётся одна кнопка.
      const query = meeting.meeting_link ? `?url=${encodeURIComponent(meeting.meeting_link)}` : ''
      navigate(`/workspace/meetings/session/${session.id}${query}`)
    },
    onError: () => toast({ title: 'Не удалось создать конспект', variant: 'destructive' }),
  })

  const loading = studentsLoading || meetingsLoading || notesLoading
  // Экран собран из двух запросов: упади любой — список неполон. Повтор дёргает
  // оба: разбираться, какой именно не дошёл, человеку ни к чему.
  const failed = studentsFailed || meetingsFailed || notesFailed
  const loadError = meetingsError ?? studentsError ?? notesError
  const retry = () => { refetchStudents(); refetchMeetings(); refetchNotes() }

  return (
    <>
      <div className="fade-in">
        <PageHeader colorPrefix="w" title="Встречи" description="Планируйте встречи и открывайте конспекты звонков." action={meetings.length > 0 ? <AppButton colorPrefix="w" aria-label="Новая встреча" title="Новая встреча" className="h-11 w-11 rounded-full !p-0" onClick={() => openCreate(studentFilter)}><Plus className="h-5 w-5" /></AppButton> : undefined} />
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs colorPrefix="w" value={activeScope} onChange={(value) => { setScope(value as typeof scope); setWithoutNotes(false) }} tabs={[
            { value: 'upcoming', label: 'Предстоящие' }, { value: 'completed', label: 'Прошедшие' }, { value: 'cancelled', label: 'Отменённые' },
          ].map((tab) => { const count = filtered.filter((m) => category(m) === tab.value).length; return { ...tab, label: <span>{tab.label}{count > 0 && <span className="ml-2 rounded-full bg-w-ink/10 px-1.5 py-0.5 text-[10px]">{count}</span>}</span> } })} />
          <div className="flex flex-wrap gap-2">
            <AppSelect colorPrefix="w" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} aria-label="Тип встречи">
              <option value="all">Все типы</option><option value="ielts">Только IELTS</option>
              {Object.entries(MEETING_TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </AppSelect>
            <AppSelect colorPrefix="w" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} aria-label="Студент">
              <option value="">Все мои студенты</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </AppSelect>
          </div>
        </div>
        {activeScope === 'completed' && noNotesCount > 0 && <AppButton colorPrefix="w" size="sm" variant={withoutNotes ? 'primary' : 'subtle'} aria-pressed={withoutNotes} className="mb-4" onClick={() => setWithoutNotes(!withoutNotes)}>Без конспекта ({noNotesCount})</AppButton>}
        <QueryState colorPrefix="w" isLoading={loading} isError={failed} error={loadError} onRetry={retry} isEmpty={meetings.length === 0} empty={<EmptyState colorPrefix="w" icon={<Calendar className="h-6 w-6" />} title="Встреч пока нет" action={<AppButton colorPrefix="w" onClick={() => openCreate(studentFilter)}>Новая встреча</AppButton>} />}>
          <div className="space-y-6">
            {[...groups].map(([day, items]) => <section key={day}>
              <h2 className="mb-2 text-sm font-bold text-w-muted">{dayLabel(items[0].starts_at)}</h2>
              <div className="divide-y divide-w-line">
                {items.map((m) => {
                  const session = sessionFor(m), processing = session?.bot_status === 'processing'
                  const href = normalizeMeetingLink(m.meeting_link) || '', join = Boolean(href) && now >= Date.parse(m.starts_at) - 600000
                  return <div key={m.id} className="flex flex-wrap items-center gap-3 py-4">
                    <div className="w-24 shrink-0"><div className="text-sm font-bold text-w-ink">{new Date(m.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div><div className="text-xs text-w-muted">{Math.round((Date.parse(m.ends_at)-Date.parse(m.starts_at))/60000)} мин</div></div>
                    <div className="min-w-0 flex-1"><Link className="text-sm font-bold text-w-accentText hover:underline" to={`/workspace/students/${m.student_id}#meetings`}>{m.student_name}</Link><div className="break-words text-sm text-w-ink">{m.title}</div></div>
                    <Pill colorPrefix="w">{MEETING_TYPE_LABELS[m.meeting_type]}</Pill>
                    {activeScope === 'upcoming' && <>
                      <AppButton colorPrefix="w" size="sm" variant="subtle" disabled={createNoteSessionMutation.isPending} title="Начать конспект: запись, бот или загрузка аудио" onClick={() => (session || m.note_session_id) ? navigate(`/workspace/meetings/session/${session?.id ?? m.note_session_id}${href ? `?url=${encodeURIComponent(href)}` : ''}`) : createNoteSessionMutation.mutate({ ...m, meeting_link: href })}>{(session || m.note_session_id) ? 'Продолжить конспект' : 'Конспект'}</AppButton>
                      <span title={m.meeting_link && !href ? 'Ссылка указана неверно. Откройте «⋯ → Изменить» и исправьте' : !m.meeting_link ? 'Добавьте ссылку Zoom/Meet' : !join ? 'Вход доступен за 10 минут до начала' : undefined}><AppButton colorPrefix="w" size="sm" disabled={!join} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>Войти</AppButton></span>
                      <details className="relative"><summary aria-label="Действия встречи" className="cursor-pointer list-none rounded-ctl px-3 py-1 text-xl text-w-muted">⋯</summary><div className="absolute right-0 z-20 grid w-44 gap-1 rounded-ctl border border-w-line bg-w-panel p-2 shadow-lg"><AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => editMeeting(m)}>Изменить</AppButton><AppButton colorPrefix="w" size="sm" variant="danger" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(m.id)}>Отменить</AppButton><AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => m.note_session_id ? navigate(`/workspace/meetings/session/${m.note_session_id}`) : createNoteSessionMutation.mutate(m)}>Записать встречу</AppButton></div></details>
                    </>}
                    {activeScope === 'completed' && <div className="flex flex-wrap items-center gap-2">
                      <Pill colorPrefix="w" tone={m.recording_url || session?.has_audio ? 'good' : 'neutral'}>Запись: {m.recording_url || session?.has_audio ? 'есть' : processing ? 'в обработке' : 'нет'}</Pill>
                      <Pill colorPrefix="w" tone={m.transcript_url || session?.transcript_count ? 'good' : 'neutral'}>Транскрипт: {m.transcript_url || session?.transcript_count ? 'есть' : processing ? 'в обработке' : 'нет'}</Pill>
                      <Pill colorPrefix="w" tone={hasNote(m) ? 'good' : 'neutral'}>Конспект: {hasNote(m) ? 'есть' : processing ? 'в обработке' : 'нет'}</Pill>
                      <AppButton colorPrefix="w" size="sm" variant="subtle" disabled={createNoteSessionMutation.isPending} onClick={() => session ? navigate(session.note_id ? `/workspace/meetings/notes/${session.note_id}` : `/workspace/meetings/session/${session.id}`) : createNoteSessionMutation.mutate(m)}>{hasNote(m) ? 'Открыть конспект' : 'Создать конспект'}</AppButton>
                    </div>}
                  </div>
                })}
              </div>
            </section>)}
          </div>
        </QueryState>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent><DialogTitle>{editing ? 'Изменить встречу' : 'Новая встреча'}</DialogTitle><DialogDescription>Выберите студента и время встречи.</DialogDescription>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!missing.length && !createMutation.isPending) createMutation.mutate() }}>
            <label className="grid gap-1.5 text-sm">Студент *<AppSelect aria-label="Студент" colorPrefix="w" value={studentId} disabled={Boolean(editing)} onChange={(e) => setStudentId(e.target.value)}><option value="">Выберите студента</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</AppSelect></label>
            <label className="grid gap-1.5 text-sm">Тип встречи<AppSelect colorPrefix="w" value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)}>{Object.entries(MEETING_TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</AppSelect></label>
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3"><label className="grid gap-1.5 text-sm">Дата и время *<span className="relative block rounded-ctl focus-within:ring-2 focus-within:ring-w-accentDim"><span aria-hidden="true" className={`flex min-h-10 items-center rounded-ctl border border-w-line bg-w-panel2 px-4 text-sm ${startsAt ? 'text-w-ink' : 'text-w-muted2'}`}>{startsAt ? new Date(startsAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Выберите дату и время'}</span><AppInput aria-label="Дата и время" colorPrefix="w" type="datetime-local" className={`absolute inset-0 z-10 h-full w-full cursor-pointer ${dateFocused || startsAt ? 'opacity-100' : 'opacity-0'}`} onFocus={() => setDateFocused(true)} onBlur={() => setDateFocused(false)} value={startsAt} onInput={(e) => setStartsAt(e.currentTarget.value)} onChange={(e) => setStartsAt(e.target.value)} /></span></label><label className="grid gap-1.5 text-sm">Минут *<AppInput aria-label="Длительность в минутах" colorPrefix="w" type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label></div>
            <label className="grid gap-1.5 text-sm">Ссылка Zoom/Meet<AppInput colorPrefix="w" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></label>
            <label className="grid gap-1.5 text-sm">Название (необязательно)<AppInput aria-label="Название встречи" colorPrefix="w" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Подставим тип встречи и имя студента" /></label>
            <label className="grid gap-1.5 text-sm">Повестка<textarea aria-label="Повестка" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink" /></label>
            <div className="flex justify-end gap-2"><AppButton colorPrefix="w" variant="subtle" onClick={() => setDialogOpen(false)}>Отмена</AppButton><span title={missing.length ? `Укажите ${missing.join(', ')}` : undefined}><AppButton colorPrefix="w" type="submit" disabled={Boolean(missing.length) || createMutation.isPending}>{createMutation.isPending ? 'Сохраняем...' : editing ? 'Сохранить' : 'Создать'}</AppButton></span></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
