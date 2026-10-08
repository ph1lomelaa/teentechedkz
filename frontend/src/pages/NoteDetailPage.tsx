import React from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, X, Pencil, Send, FileText, User, ChevronRight, Trash2 } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Textarea } from '@/components/ui/primitives/textarea'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { QueryError } from '@/components/shared/QueryState'
import { getErrorStatus } from '@/lib/errorMessage'
import { invalidateStudent } from '@/lib/queryKeys'
import { NoteReader } from '@/components/notes/NoteReader'
import { RecordingQualityBanner } from '@/components/notes/RecordingQualityBanner'

function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    full_name: 'ФИО',
    phone: 'Телефон',
    city: 'Город',
    age: 'Возраст',
    degree_level: 'Уровень',
    specialty: 'Специальность',
    group_direction: 'Направление',
    additional_sphere: 'Доп. сфера',
    gpa: 'GPA',
    achievements_text: 'Достижения',
    budget_per_year: 'Бюджет в год',
    transcript_resume_url: 'Транскрипт / резюме',
    intake_year: 'Год поступления',
    intake_season: 'Сезон поступления',
  }
  return labels[key] ?? key.replace(/_/g, ' ')
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map((item) => humanizeValue(item)).join(' · ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderEntries(data: Record<string, unknown>, emptyLabel = 'Нет данных', workspace = false) {
  const entries = Object.entries(data)
  const mutedClass = workspace ? 'text-slate-400' : 'text-p-muted2'
  if (!entries.length) return <p className={cn('text-sm', mutedClass)}>{emptyLabel}</p>
  return (
    <div className="grid gap-2">
      {entries.map(([key, value]) => (
        <div key={key} className={cn('rounded-panel border p-3', workspace ? 'border-slate-200 bg-slate-50' : 'border-p-line bg-p-bg')}>
          <div className={cn('text-xs uppercase tracking-[0.2em]', workspace ? 'text-slate-500' : 'text-p-muted')}>{humanizeKey(key)}</div>
          <div className={cn('mt-1 text-sm whitespace-pre-wrap break-words', workspace ? 'text-slate-900' : 'text-p-text')}>{humanizeValue(value)}</div>
        </div>
      ))}
    </div>
  )
}

function renderDiffPreview(
  preview: Array<{
    field: string
    old_value: unknown
    new_value: unknown
  }>,
  workspace = false,
) {
  const mutedClass = workspace ? 'text-slate-400' : 'text-p-muted2'
  if (!preview.length) return <p className={cn('text-sm', mutedClass)}>Нет предлагаемых изменений</p>
  return (
    <div className="grid gap-2">
      {preview.map((item) => (
        <div key={item.field} className={cn('rounded-panel border p-3', workspace ? 'border-slate-200 bg-slate-50' : 'border-p-line bg-p-bg')}>
          <div className={cn('text-xs uppercase tracking-[0.2em]', workspace ? 'text-slate-500' : 'text-p-muted')}>{humanizeKey(item.field)}</div>
          <div className="mt-2 grid gap-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <span className={workspace ? 'text-slate-500' : 'text-p-muted'}>Сейчас</span>
              <span className={cn('text-right whitespace-pre-wrap', workspace ? 'text-slate-900' : 'text-p-text')}>{humanizeValue(item.old_value)}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className={workspace ? 'text-slate-500' : 'text-p-muted'}>После</span>
              <span className={cn('text-right whitespace-pre-wrap', workspace ? 'text-slate-900' : 'text-p-text')}>{humanizeValue(item.new_value)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export const NoteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const inWorkspace = location.pathname.startsWith('/workspace/')
  const notesHome = inWorkspace ? '/workspace/notes' : '/notes'
  const queryClient = useQueryClient()
  const { can, user } = useAuth()
  const [view, setView] = React.useState<'mentor' | 'student' | 'source'>('mentor')
  const [editing, setEditing] = React.useState(false)
  const [editedSummary, setEditedSummary] = React.useState('')
  const [editedStudentSummary, setEditedStudentSummary] = React.useState('')
  const [editedProfileNotes, setEditedProfileNotes] = React.useState<string[]>([])
  const [rejectConfirmOpen, setRejectConfirmOpen] = React.useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false)
  const [pubTitle, setPubTitle] = React.useState('')
  const [hiddenBlocks, setHiddenBlocks] = React.useState<Set<string>>(new Set())
  const [enabledChangeKeys, setEnabledChangeKeys] = React.useState<Set<string>>(new Set())

  const { data: note, isLoading, error, refetch } = useQuery({
    queryKey: ['note', id],
    queryFn: () => notesApi.get(id!),
    enabled: Boolean(id),
  })

  const { data: diff } = useQuery({
    queryKey: ['note-diff', id],
    queryFn: () => notesApi.diff(id!),
    enabled: Boolean(id),
  })

  const deleteMutation = useMutation({
    mutationFn: () => notesApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['student-meeting-notes'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'notes'] })
      if (note?.student_id) invalidateStudent(queryClient, note.student_id)
      toast({ title: 'Конспект удалён' })
      navigate(notesHome)
    },
    onError: () => toast({ title: 'Не удалось удалить конспект', variant: 'destructive' }),
  })

  React.useEffect(() => {
    if (!note) return
    const rawProfileNotes = (note.suggested_changes as { profile_notes?: unknown })?.profile_notes
    setEditedSummary(note.summary_markdown ?? '')
    setEditedStudentSummary(note.student_summary_markdown ?? '')
    setPubTitle(note.student_title ?? '')
    setHiddenBlocks(new Set(note.hidden_blocks ?? []))
    setEnabledChangeKeys(new Set(Object.keys(note.suggested_changes ?? {}).filter((key) => key !== 'profile_notes')))
    setEditedProfileNotes(
      Array.isArray(rawProfileNotes)
        ? rawProfileNotes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : [],
    )
  }, [note])

  const reviewMutation = useMutation({
    mutationFn: (payload: { action: 'approve' | 'reject'; summary_markdown?: string; student_summary_markdown?: string; suggested_changes?: Record<string, unknown> }) =>
      notesApi.review(id!, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['student-meeting-notes'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      // Ревью конспекта — событие таймлайна («Конспект»/«AI-черновик»),
      // а раньше сбрасывался только профиль студента.
      if (updated.student_id) {
        invalidateStudent(queryClient, updated.student_id)
      }
      toast({ title: 'Сохранено' })
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось обновить конспект', variant: 'destructive' })
    },
  })

  const regenerateStudentSummaryMutation = useMutation({
    mutationFn: () => notesApi.regenerateStudentSummary(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      toast({ title: 'Перегенерировано для ученика' })
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось перегенерировать текст', variant: 'destructive' })
    },
  })

  const publishMutation = useMutation({
    mutationFn: (payload: { student_title?: string | null; hidden_blocks?: string[] }) =>
      notesApi.publish(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['student-meeting-notes'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'notes'] })
      toast({ title: 'Опубликовано ученику' })
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось опубликовать', variant: 'destructive' })
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: () => notesApi.unpublish(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['student-meeting-notes'] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'notes'] })
      toast({ title: 'Убрано из кабинета' })
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось убрать из кабинета', variant: 'destructive' })
    },
  })

  if (isLoading) {
    return <div className={cn('py-12 text-center', inWorkspace ? 'text-slate-400' : 'text-p-muted2')}>Загрузка...</div>
  }

  // «Конспект не найден» — правда только при 404. Та же подмена, что была в
  // карточке студента: 500 и обрыв связи отправляли искать пропавшую запись.
  if (error && getErrorStatus(error) !== 404) {
    return <QueryError colorPrefix={inWorkspace ? 'w' : 'ds'} error={error} onRetry={refetch} />
  }

  if (!note) {
    return (
      <div className="py-12 text-center">
        <p className={inWorkspace ? 'text-slate-500' : 'text-p-muted'}>Конспект не найден</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link to={notesHome}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад к списку
          </Link>
        </Button>
      </div>
    )
  }

  const { profile_notes: rawProfileNotes, ...fieldChanges } = note.suggested_changes as {
    profile_notes?: unknown
  } & Record<string, unknown>
  const profileNotes = Array.isArray(rawProfileNotes)
    ? rawProfileNotes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : []
  const savedNotesCount = (note.applied_changes as { profile_notes_saved?: number })?.profile_notes_saved
  const editedSuggestedChanges = {
    ...Object.fromEntries(Object.entries(fieldChanges).filter(([key]) => enabledChangeKeys.has(key))),
    ...(editedProfileNotes.filter((item) => item.trim()).length
      ? { profile_notes: editedProfileNotes.filter((item) => item.trim()) }
      : {}),
  }

  const canControl = can('notes', 'manage')
  const draft = note.status === 'draft'
  const statusLabel = { draft: 'На проверке', approved: 'Проверен', rejected: 'Отклонён' }[note.status]
  const preview = diff?.preview ?? Object.entries(fieldChanges).map(([field, new_value]) => ({ field, old_value: undefined, new_value }))
  const approve = () => reviewMutation.mutate({ action: 'approve', summary_markdown: editedSummary, student_summary_markdown: editedStudentSummary, suggested_changes: editedSuggestedChanges })
  const readingText = view === 'student' ? editedStudentSummary || editedSummary : editedSummary
  const busy = reviewMutation.isPending || publishMutation.isPending

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <Link to={notesHome} className="inline-flex items-center gap-2 text-sm text-p-muted hover:text-p-text"><ArrowLeft className="h-4 w-4" />Все конспекты</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-p-muted">Итоги встречи · {formatDate(note.created_at)}</p>
          <h1 className="text-2xl font-bold tracking-tight text-p-text sm:text-3xl">{note.student_name || note.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className={cn('rounded-full px-3 py-1.5 font-medium', draft ? 'bg-amber-100 text-amber-900' : note.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>{statusLabel}</span>
            <span className="rounded-full border border-p-line px-3 py-1.5 text-p-muted">{note.published_to_student ? 'Виден ученику' : 'Только для команды'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {note.student_id && <Button variant="outline" asChild><Link to={inWorkspace ? `/workspace/students/${note.student_id}#meetings` : `/students/${note.student_id}`}><User className="mr-2 h-4 w-4" />Карточка студента<ChevronRight className="ml-2 h-4 w-4" /></Link></Button>}
          {(can('notes', 'manage') || note.created_by === user?.id) && <Button variant="outline" className="text-red-700" onClick={() => setDeleteConfirmOpen(true)}><Trash2 className="mr-2 h-4 w-4" />Удалить</Button>}
        </div>
      </header>

      {draft && <RecordingQualityBanner recording={note.recording} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="note-paper min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-8">
            <div className="flex gap-1" role="tablist" aria-label="Версия конспекта">
              {([{ value: 'mentor', label: 'Итог встречи' }, { value: 'student', label: 'Для ученика' }, { value: 'source', label: 'Расшифровка' }] as const).map(tab => <button key={tab.value} type="button" role="tab" aria-selected={view === tab.value} onClick={() => { setView(tab.value); setEditing(false) }} className={cn('rounded-xl px-3 py-2 text-sm font-medium transition', view === tab.value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>{tab.label}</button>)}
            </div>
            {draft && canControl && view !== 'source' && <button type="button" onClick={() => setEditing(!editing)} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"><Pencil className="h-4 w-4" />{editing ? 'Читать' : 'Редактировать'}</button>}
          </div>
          <div className="p-5 sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-semibold tracking-tight">{view === 'mentor' ? 'Главное из разговора' : view === 'student' ? 'Что увидит ученик' : 'Исходный разговор'}</h2><p className="mt-1 text-sm text-slate-500">{view === 'mentor' ? 'Итоги, решения и следующие шаги.' : view === 'student' ? 'Проверьте формулировки перед отправкой в кабинет.' : 'Сверьте детали с текстом встречи.'}</p></div>
              {view === 'student' && canControl && draft && <Button variant="outline" size="sm" disabled={regenerateStudentSummaryMutation.isPending} onClick={() => regenerateStudentSummaryMutation.mutate()}>{regenerateStudentSummaryMutation.isPending ? 'Готовим…' : 'Обновить текст'}</Button>}
            </div>
            {view === 'source' ? <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{note.source_text || 'Расшифровка отсутствует.'}</div> : editing ? <><Textarea aria-label={view === 'student' ? 'Текст для ученика' : 'Итог встречи'} value={view === 'student' ? editedStudentSummary : editedSummary} onChange={event => view === 'student' ? setEditedStudentSummary(event.target.value) : setEditedSummary(event.target.value)} className="min-h-[360px] bg-slate-50 text-base leading-7" /><p className="mt-3 text-xs text-slate-500">Изменения сохранятся при нажатии «Одобрить конспект».</p></> : <NoteReader markdown={readingText} />}
          </div>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="rounded-2xl border border-p-line bg-p-panel p-5">
            <div className="mb-3 flex items-center gap-2 text-p-text"><Check className="h-4 w-4" /><h2 className="font-semibold">{draft ? 'Проверка конспекта' : 'Конспект проверен'}</h2></div>
            <p className="mb-4 text-sm leading-6 text-p-muted">{draft ? 'Прочитайте итог встречи и версию для ученика. Затем одобрите конспект.' : note.status === 'approved' ? 'Можно отправить итог в кабинет ученика.' : 'Этот черновик отклонён.'}</p>
            {canControl && draft && note.student_id && <div className="space-y-2"><Button className="w-full" disabled={busy} onClick={approve}><Check className="mr-2 h-4 w-4" />{reviewMutation.isPending ? 'Сохраняем…' : 'Одобрить конспект'}</Button><Button variant="ghost" className="w-full text-p-muted" onClick={() => setRejectConfirmOpen(true)} disabled={busy}>Отклонить черновик</Button></div>}
            {note.reviewed_at && <p className="text-xs text-p-muted">Проверен {formatDate(note.reviewed_at)}</p>}
          </section>
          {note.student_id && <section className="rounded-2xl border border-p-line bg-p-panel p-5">
            <div className="mb-3 flex items-center gap-2 text-p-text"><Send className="h-4 w-4" /><h2 className="font-semibold">Кабинет ученика</h2></div>
            <p className="mb-4 text-sm leading-6 text-p-muted">{note.published_to_student ? 'Ученик видит опубликованный конспект в разделе «Конспекты».' : draft ? 'После одобрения здесь появится кнопка отправки.' : 'Отправьте проверенную версию ученику.'}</p>
            {canControl && note.status === 'approved' && <div className="space-y-3">
              <label className="block text-xs text-p-muted">Название для ученика<input value={pubTitle} onChange={event => setPubTitle(event.target.value)} placeholder="Итоги нашей встречи" className="mt-2 w-full rounded-xl border border-p-line bg-p-bg px-3 py-2 text-sm text-p-text" /></label>
              {!!note.blocks?.length && <details className="text-sm text-p-text"><summary className="cursor-pointer">Какие разделы показать</summary><div className="mt-3 space-y-2">{note.blocks.map(block => <label key={block.key} className="flex items-start gap-2"><input type="checkbox" checked={!hiddenBlocks.has(block.key)} onChange={() => setHiddenBlocks(current => { const next = new Set(current); if (next.has(block.key)) next.delete(block.key); else next.add(block.key); return next })} /><span>{block.heading}</span></label>)}</div></details>}
              <Button className="w-full" disabled={busy} onClick={() => publishMutation.mutate({ student_title: pubTitle.trim() || null, hidden_blocks: Array.from(hiddenBlocks) })}><Send className="mr-2 h-4 w-4" />{publishMutation.isPending ? 'Отправляем…' : note.published_to_student ? 'Обновить публикацию' : 'Отправить ученику'}</Button>
              {note.published_to_student && <Button variant="ghost" className="w-full" disabled={unpublishMutation.isPending} onClick={() => unpublishMutation.mutate()}>Убрать из кабинета</Button>}
            </div>}
          </section>}
          {preview.length > 0 && <section className="rounded-2xl border border-p-line bg-p-panel p-5"><h2 className="mb-3 font-semibold text-p-text">Обновления профиля <span className="text-p-muted">· {preview.length}</span></h2>{draft && canControl ? <div className="space-y-3">{preview.map(item => <label key={item.field} className="flex items-start gap-2 rounded-xl border border-p-line p-3 text-sm text-p-text"><input type="checkbox" checked={enabledChangeKeys.has(item.field)} onChange={() => setEnabledChangeKeys(current => { const next = new Set(current); if (next.has(item.field)) next.delete(item.field); else next.add(item.field); return next })} /><span className="min-w-0"><span className="block text-xs text-p-muted">{humanizeKey(item.field)}</span><span className="block mt-1 break-words">{humanizeValue(item.new_value)}</span></span></label>)}</div> : diff ? renderDiffPreview(diff.preview) : renderEntries(fieldChanges)}</section>}
          {(profileNotes.length > 0 || (draft && canControl)) && <details className="rounded-2xl border border-p-line bg-p-panel p-5"><summary className="cursor-pointer font-semibold text-p-text">Заметки в профиль {profileNotes.length > 0 && `· ${profileNotes.length}`}</summary><div className="mt-4 space-y-3">{draft && canControl ? <>{editedProfileNotes.map((text, index) => <div key={index} className="flex gap-2"><Textarea aria-label={`Заметка ${index + 1}`} value={text} onChange={event => setEditedProfileNotes(current => current.map((value, i) => i === index ? event.target.value : value))} /><Button variant="ghost" size="sm" aria-label="Удалить заметку" onClick={() => setEditedProfileNotes(current => current.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button></div>)}<Button variant="outline" size="sm" onClick={() => setEditedProfileNotes(current => [...current, ''])}>Добавить заметку</Button></> : <>{profileNotes.map((text, index) => <p key={index} className="text-sm leading-6 text-p-text">{text}</p>)}<p className="text-xs text-p-muted">Сохранено в профиль: {savedNotesCount ?? profileNotes.length}</p></>}</div></details>}
          <p className="flex items-center gap-2 px-1 text-xs text-p-muted"><FileText className="h-3.5 w-3.5" />Создан {formatDate(note.created_at)}</p>
        </aside>
      </div>
      <Dialog open={rejectConfirmOpen} onOpenChange={setRejectConfirmOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Отклонить черновик?</DialogTitle><DialogDescription>Конспект не будет применён к профилю или опубликован ученику. Вернуть его на проверку нельзя.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRejectConfirmOpen(false)}>Отмена</Button><Button variant="destructive" disabled={busy} onClick={() => { setRejectConfirmOpen(false); reviewMutation.mutate({ action: 'reject' }) }}>Отклонить</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Удалить конспект?</DialogTitle><DialogDescription>Конспект исчезнет из списка и кабинета ученика. Удаление нельзя отменить. Связь записи встречи с конспектом будет снята.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Отмена</Button><Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>{deleteMutation.isPending ? 'Удаляем…' : 'Удалить конспект'}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
