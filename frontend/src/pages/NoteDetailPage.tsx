import React from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, X } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/primitives/accordion'
import { Markdown } from '@/components/shared/Markdown'
import { splitNoteMarkdown, countListItems } from '@/lib/noteBlocks'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'

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
  const inWorkspace = location.pathname.startsWith('/workspace/')
  const notesHome = inWorkspace ? '/workspace/meetings?tab=notes' : '/notes'
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [editedSummary, setEditedSummary] = React.useState('')
  const [editedStudentSummary, setEditedStudentSummary] = React.useState('')
  const [editedProfileNotes, setEditedProfileNotes] = React.useState<string[]>([])
  const [rejectConfirmOpen, setRejectConfirmOpen] = React.useState(false)
  const [pubTitle, setPubTitle] = React.useState('')
  const [hiddenBlocks, setHiddenBlocks] = React.useState<Set<string>>(new Set())
  const [enabledChangeKeys, setEnabledChangeKeys] = React.useState<Set<string>>(new Set())

  const { data: note, isLoading } = useQuery({
    queryKey: ['note', id],
    queryFn: () => notesApi.get(id!),
    enabled: Boolean(id),
  })

  const { data: diff } = useQuery({
    queryKey: ['note-diff', id],
    queryFn: () => notesApi.diff(id!),
    enabled: Boolean(id),
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
      queryClient.invalidateQueries({ queryKey: ['note', id] })
      if (updated.student_id) {
        queryClient.invalidateQueries({ queryKey: ['student', updated.student_id] })
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
      toast({ title: 'Убрано из кабинета' })
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось убрать из кабинета', variant: 'destructive' })
    },
  })

  if (isLoading) {
    return <div className={cn('py-12 text-center', inWorkspace ? 'text-slate-400' : 'text-p-muted2')}>Загрузка...</div>
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

  // Управление (approve/reject/publish/редактирование) живёт только в кабинете
  // ментора (/workspace/meetings/notes/:id). В общем CRM-доступе (/notes/:id,
  // видна admin/mzk_manager/mentor через общий сайдбар) страница — только чтение.
  const canControl = inWorkspace

  // NoteDetailPage is shared between the CRM (dark p-* theme) and the mentor's
  // dark workspace shell — inWorkspace forces a clean light "document" surface
  // there (literal slate colors, matches PortalNotesPage), while the CRM branch
  // uses the same p-*/crm-* semantic tokens as the rest of the CRM.
  const borderClass = inWorkspace ? 'border-slate-200' : 'border-p-line'
  const backLinkClass = inWorkspace ? 'text-slate-600 hover:text-slate-950' : 'text-p-muted hover:text-p-text'
  const eyebrowClass = inWorkspace ? 'text-yellow-500' : 'text-p-accent'
  const titleClass = inWorkspace ? 'text-slate-950' : 'text-p-text'
  const mutedClass = inWorkspace ? 'text-slate-500' : 'text-p-muted'
  const cardClass = inWorkspace ? 'border-slate-200 bg-white' : 'border-p-line bg-white'
  const cardTitleClass = inWorkspace ? 'text-base text-slate-900' : 'text-base text-p-text'
  const panelClass = inWorkspace ? 'border-slate-200 bg-slate-50' : 'border-p-line bg-p-bg'
  const panelMutedClass = inWorkspace ? 'text-slate-500' : 'text-p-muted'

  const renderSummaryPreview = (markdown: string) => {
    const { hero, sections } = splitNoteMarkdown(markdown)
    return (
      <div className="space-y-4">
        {hero && (
          <div className={cn('border-l-4 py-1 pl-4', inWorkspace ? 'border-yellow-400' : 'border-p-accent')}>
            <Markdown className={cn('text-lg font-medium leading-snug', titleClass)}>{hero}</Markdown>
          </div>
        )}
        {sections.length > 0 && (
          <Accordion type="multiple" defaultValue={[sections[0].heading]} className={cn('rounded-panel border', panelClass)}>
            {sections.map((section) => {
              const count = countListItems(section.content)
              return (
                <AccordionItem key={section.heading} value={section.heading} className={cn('border-b px-4 last:border-b-0', borderClass)}>
                  <AccordionTrigger className={cn('text-sm font-semibold', titleClass)}>
                    <span className="flex items-center gap-2">
                      {section.heading}
                      {count !== undefined && (
                        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-normal', borderClass, panelMutedClass)}>
                          {count}
                        </span>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Markdown>{section.content}</Markdown>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
        {!hero && sections.length === 0 && (
          <div className={cn('border-l-4 py-1 pl-4', inWorkspace ? 'border-yellow-400' : 'border-p-accent')}>
            <Markdown className={cn('text-lg font-medium leading-snug', titleClass)}>{markdown}</Markdown>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('space-y-5 max-w-6xl', inWorkspace && 'rounded-card border border-w-line bg-white p-6 text-slate-900')}>
      <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b pb-5', borderClass)}>
        <div>
          <Button variant="ghost" size="sm" asChild className={cn('mb-3 px-0', backLinkClass)}>
            <Link to={notesHome}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              К списку
            </Link>
          </Button>
          <div className={cn('mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em]', eyebrowClass)}>Конспект</div>
          <h1 className={cn('font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl', titleClass)}>
            {note.title}
          </h1>
          <div className={cn('mt-2 flex flex-wrap items-center gap-2 text-sm', mutedClass)}>
            <span>{note.student_name ?? 'Без привязки к студенту'}</span>
            <span>·</span>
            <span>{formatDate(note.created_at)}</span>
            <span className={cn('rounded-full border bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.2em]', borderClass, mutedClass)}>
              {note.status}
            </span>
          </div>
        </div>

        {note.student_id && note.status === 'draft' && can('notes', 'manage') && canControl && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setRejectConfirmOpen(true)}
              disabled={reviewMutation.isPending}
            >
              <X className="w-4 h-4 mr-2" />
              Отклонить
            </Button>
            <Button
              onClick={() => reviewMutation.mutate({
                action: 'approve',
                summary_markdown: editedSummary,
                student_summary_markdown: editedStudentSummary,
                suggested_changes: editedSuggestedChanges,
              })}
              disabled={reviewMutation.isPending}
            >
              <Check className="w-4 h-4 mr-2" />
              Сохранить конспект
            </Button>
          </div>
        )}
      </div>

      {note.status === 'draft' && canControl && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { number: 1, label: 'Подготовка' },
            { number: 2, label: 'Запись' },
            { number: 3, label: 'Проверка' },
          ].map((step) => (
            <div
              key={step.number}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-panel border px-3 py-2.5 text-sm transition-colors',
                step.number === 3
                  ? 'border-[#FFD400]/70 bg-[#FFD400]/10 text-[#FFD400]'
                  : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500',
              )}
            >
              <span className={cn(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                step.number === 3
                  ? 'bg-[#FFD400] text-black'
                  : 'bg-emerald-500 text-white',
              )}>
                {step.number < 3 ? <Check className="h-3.5 w-3.5" /> : step.number}
              </span>
              <span className="truncate font-medium">{step.label}</span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={rejectConfirmOpen} onOpenChange={setRejectConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отклонить конспект?</DialogTitle>
            <DialogDescription>
              AI-черновик будет отклонён без возможности вернуть его на повторную проверку.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRejectConfirmOpen(false)
                reviewMutation.mutate({ action: 'reject' })
              }}
              disabled={reviewMutation.isPending}
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className={cardTitleClass}>Конспект</CardTitle>
            <CardDescription>Итог разговора</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <h3 className={cn('text-sm font-semibold mb-2', mutedClass)}>Содержание</h3>
              {note.status === 'draft' && canControl ? (
                <Textarea
                  value={editedSummary}
                  onChange={(event) => setEditedSummary(event.target.value)}
                  className={cn('min-h-[260px]', inWorkspace ? 'bg-slate-50' : 'bg-p-bg')}
                />
              ) : renderSummaryPreview(note.summary_markdown)}
            </div>
          </CardContent>
        </Card>

        <Card className={cardClass}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className={cardTitleClass}>Для ученика</CardTitle>
                <CardDescription>Отдельная формулировка — без менторского языка</CardDescription>
              </div>
              {canControl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateStudentSummaryMutation.mutate()}
                  disabled={regenerateStudentSummaryMutation.isPending}
                >
                  {regenerateStudentSummaryMutation.isPending ? 'Перегенерирую…' : 'Перегенерировать для ученика'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {note.status === 'draft' && canControl ? (
              <Textarea
                value={editedStudentSummary}
                onChange={(event) => setEditedStudentSummary(event.target.value)}
                className={cn('min-h-[180px]', inWorkspace ? 'bg-slate-50' : 'bg-p-bg')}
              />
            ) : (
              renderSummaryPreview(note.student_summary_markdown || note.summary_markdown)
            )}

            {note.student_id && (
              <div className={cn('pt-4 border-t space-y-3', inWorkspace ? 'border-slate-100' : 'border-p-line')}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className={mutedClass}>В кабинете ученика</span>
                  <span className={note.published_to_student ? 'text-emerald-600 font-medium' : titleClass}>
                    {note.published_to_student ? 'отправлен' : 'не отправлен'}
                  </span>
                </div>
                {!canControl ? null : note.status === 'approved' ? (
                  <>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Заголовок для ученика</label>
                      <input
                        type="text"
                        value={pubTitle}
                        onChange={(e) => setPubTitle(e.target.value)}
                        placeholder="напр. «Наша встреча»"
                        className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-ctl focus:outline-none focus:border-slate-500"
                      />
                    </div>
                    {note.blocks && note.blocks.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 mb-1.5">Показывать ученику блоки</p>
                        <div className="space-y-1">
                          {note.blocks.map((b) => (
                            <label key={b.key} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={!hiddenBlocks.has(b.key)}
                                onChange={() =>
                                  setHiddenBlocks((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(b.key)) next.delete(b.key)
                                    else next.add(b.key)
                                    return next
                                  })
                                }
                              />
                              <span className="truncate">{b.heading}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() =>
                          publishMutation.mutate({
                            student_title: pubTitle.trim() || null,
                            hidden_blocks: Array.from(hiddenBlocks),
                          })
                        }
                        disabled={publishMutation.isPending}
                      >
                        {note.published_to_student ? 'Обновить отправку' : 'Отправить ученику'}
                      </Button>
                      {note.published_to_student && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unpublishMutation.mutate()}
                          disabled={unpublishMutation.isPending}
                        >
                          Убрать
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">
                    Отправить можно после проверки конспекта.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        <div className="space-y-4">
          <Card className={cardClass}>
          <CardHeader>
            <CardTitle className={cardTitleClass}>Состояние</CardTitle>
          </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className={mutedClass}>Статус</span>
                  <span className={titleClass}>{note.status}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className={mutedClass}>Создан</span>
                  <span className={titleClass}>{formatDate(note.created_at)}</span>
                </div>
                {note.reviewed_at && (
                  <div className="flex items-center justify-between gap-4">
                    <span className={mutedClass}>Проверен</span>
                    <span className={titleClass}>{formatDate(note.reviewed_at)}</span>
                  </div>
                )}
                {note.student_id && (
                  <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                    <Link to={inWorkspace ? `/workspace/students/${note.student_id}#meetings` : `/students/${note.student_id}`}>Открыть студента</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className={cardClass}>
          <CardHeader>
            <CardTitle className={cardTitleClass}>Предлагаемые изменения</CardTitle>
            <CardDescription>
              {note.status === 'draft' && canControl
                ? 'Оставьте включёнными только те изменения, которые нужно записать в профиль'
                : 'Какие поля предлагается обновить в профиле'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {note.status === 'draft' && canControl ? (
              (diff?.preview ?? Object.entries(fieldChanges).map(([field, newValue]) => ({
                field,
                old_value: undefined,
                new_value: newValue,
              }))).length ? (
                <div className="grid gap-2">
                  {(diff?.preview ?? Object.entries(fieldChanges).map(([field, newValue]) => ({
                    field,
                    old_value: undefined,
                    new_value: newValue,
                  }))).map((item) => {
                    const enabled = enabledChangeKeys.has(item.field)
                    return (
                      <label
                        key={item.field}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-panel border p-3 transition',
                          enabled
                            ? inWorkspace ? 'border-yellow-300 bg-yellow-50' : 'border-p-text bg-p-bg'
                            : inWorkspace ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-p-line bg-p-bg opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => setEnabledChangeKeys((current) => {
                            const next = new Set(current)
                            if (next.has(item.field)) next.delete(item.field)
                            else next.add(item.field)
                            return next
                          })}
                          className="mt-1 h-4 w-4 shrink-0 accent-black"
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-xs font-semibold uppercase tracking-[0.16em]', mutedClass)}>
                            {humanizeKey(item.field)}
                          </span>
                          <span className="mt-2 grid gap-1 text-sm">
                            <span className="flex items-start justify-between gap-3">
                              <span className={mutedClass}>Сейчас</span>
                              <span className={cn('text-right', titleClass)}>{humanizeValue(item.old_value)}</span>
                            </span>
                            <span className="flex items-start justify-between gap-3">
                              <span className={mutedClass}>После</span>
                              <span className={cn('text-right font-medium', titleClass)}>{humanizeValue(item.new_value)}</span>
                            </span>
                          </span>
                        </span>
                      </label>
                    )
                  })}
                  <p className={cn('mt-1 text-xs', mutedClass)}>
                    Выбрано изменений: {enabledChangeKeys.size}
                  </p>
                </div>
              ) : (
                <p className={cn('text-sm', mutedClass)}>Изменений профиля нет — можно сохранить только конспект.</p>
              )
            ) : diff
              ? renderDiffPreview(diff.preview, inWorkspace)
              : renderEntries(fieldChanges, 'Нет предлагаемых изменений', inWorkspace)}
          </CardContent>
        </Card>

          {(profileNotes.length > 0 || note.status === 'draft') && (
            <Card className={cardClass}>
              <CardHeader>
                <CardTitle className={cardTitleClass}>В заметки профиля</CardTitle>
                <CardDescription>
                  {note.status === 'approved'
                    ? `Сохранено в заметки студента: ${savedNotesCount ?? profileNotes.length}`
                    : 'Важное из разговора — сохранится в заметки студента при подтверждении'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {note.status === 'draft' && canControl ? (
                  <div className="grid gap-2">
                    {editedProfileNotes.map((text, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Textarea
                          value={text}
                          className="min-h-[68px] bg-amber-50"
                          onChange={(event) => setEditedProfileNotes(
                            editedProfileNotes.map((item, index) => index === i ? event.target.value : item)
                          )}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 px-2"
                          onClick={() => setEditedProfileNotes(editedProfileNotes.filter((_, index) => index !== i))}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditedProfileNotes([...editedProfileNotes, ''])}
                    >
                      Добавить заметку
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {profileNotes.map((text, i) => (
                      <div key={i} className={cn('rounded-panel border border-amber-200 bg-amber-50 p-3 text-sm', titleClass)}>
                        {text}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}
