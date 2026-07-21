import React from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, X } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/shared/Markdown'
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

function renderEntries(data: Record<string, unknown>, emptyLabel = 'Нет данных') {
  const entries = Object.entries(data)
  if (!entries.length) return <p className="text-sm text-slate-400">{emptyLabel}</p>
  return (
    <div className="grid gap-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-[2px] border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{humanizeKey(key)}</div>
          <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap break-words">{humanizeValue(value)}</div>
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
) {
  if (!preview.length) return <p className="text-sm text-slate-400">Нет предлагаемых изменений</p>
  return (
    <div className="grid gap-2">
      {preview.map((item) => (
        <div key={item.field} className="rounded-[2px] border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{humanizeKey(item.field)}</div>
          <div className="mt-2 grid gap-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-500">Сейчас</span>
              <span className="text-slate-900 text-right whitespace-pre-wrap">{humanizeValue(item.old_value)}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-500">После</span>
              <span className="text-slate-900 text-right whitespace-pre-wrap">{humanizeValue(item.new_value)}</span>
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
  const { hasRole } = useAuth()
  const [editedSummary, setEditedSummary] = React.useState('')
  const [editedProfileNotes, setEditedProfileNotes] = React.useState<string[]>([])
  const [rejectConfirmOpen, setRejectConfirmOpen] = React.useState(false)
  const [pubTitle, setPubTitle] = React.useState('')
  const [hiddenBlocks, setHiddenBlocks] = React.useState<Set<string>>(new Set())

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
    setPubTitle(note.student_title ?? '')
    setHiddenBlocks(new Set(note.hidden_blocks ?? []))
    setEditedProfileNotes(
      Array.isArray(rawProfileNotes)
        ? rawProfileNotes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : [],
    )
  }, [note])

  const reviewMutation = useMutation({
    mutationFn: (payload: { action: 'approve' | 'reject'; summary_markdown?: string; suggested_changes?: Record<string, unknown> }) =>
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
    return <div className="py-12 text-center text-slate-400">Загрузка...</div>
  }

  if (!note) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-500">Конспект не найден</p>
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
    ...fieldChanges,
    ...(editedProfileNotes.filter((item) => item.trim()).length
      ? { profile_notes: editedProfileNotes.filter((item) => item.trim()) }
      : {}),
  }

  const preview = diff ? renderDiffPreview(diff.preview) : renderEntries(fieldChanges, 'Нет предлагаемых изменений')

  return (
    // NoteDetailPage is light-themed and shared with the CRM. In the dark
    // workspace shell its slate text would be unreadable dark-on-dark, so we
    // render the конспект on a clean light "document" surface there (the student
    // portal does the same in PortalNotesPage).
    <div className={cn('space-y-5 max-w-6xl', inWorkspace && 'rounded-[24px] border border-w-line bg-white p-6 text-slate-900')}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-3 px-0 text-slate-600 hover:text-slate-950">
            <Link to={notesHome}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              К списку
            </Link>
          </Button>
          <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-yellow-500">Конспект</div>
          <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-slate-950 md:text-4xl">
            {note.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{note.student_name ?? 'Без привязки к студенту'}</span>
            <span>·</span>
            <span>{formatDate(note.created_at)}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
              {note.status}
            </span>
          </div>
        </div>

        {note.student_id && note.status === 'draft' && hasRole('admin', 'mzk_manager') && (
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
                suggested_changes: editedSuggestedChanges,
              })}
              disabled={reviewMutation.isPending}
            >
              <Check className="w-4 h-4 mr-2" />
              Подтвердить
            </Button>
          </div>
        )}
      </div>

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
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Конспект</CardTitle>
            <CardDescription>Итоговый текст и исходный транскрипт</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Содержание</h3>
              {note.status === 'draft' ? (
                <Textarea
                  value={editedSummary}
                  onChange={(event) => setEditedSummary(event.target.value)}
                  className="min-h-[260px] bg-slate-50"
                />
              ) : (
                <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4">
                  <Markdown>{note.summary_markdown ?? ''}</Markdown>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Исходный текст</h3>
              <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4 whitespace-pre-wrap text-sm text-slate-700">
                {note.source_text}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Состояние</CardTitle>
          </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Статус</span>
                  <span className="text-slate-900">{note.status}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">Создан</span>
                  <span className="text-slate-900">{formatDate(note.created_at)}</span>
                </div>
                {note.reviewed_at && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-500">Проверен</span>
                    <span className="text-slate-900">{formatDate(note.reviewed_at)}</span>
                  </div>
                )}
                {note.student_id && (
                  <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                    <Link to={inWorkspace ? `/workspace/students/${note.student_id}#meetings` : `/students/${note.student_id}`}>Открыть студента</Link>
                  </Button>
                )}
                {note.student_id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-500">В кабинете ученика</span>
                      <span className={note.published_to_student ? 'text-emerald-600 font-medium' : 'text-slate-900'}>
                        {note.published_to_student ? 'опубликован' : 'не опубликован'}
                      </span>
                    </div>
                    {note.status === 'approved' ? (
                      <>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Заголовок для ученика</label>
                          <input
                            type="text"
                            value={pubTitle}
                            onChange={(e) => setPubTitle(e.target.value)}
                            placeholder="напр. «Наша встреча»"
                            className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-[2px] focus:outline-none focus:border-slate-500"
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
                            {note.published_to_student ? 'Обновить публикацию' : 'Опубликовать ученику'}
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
                        Опубликовать можно после проверки конспекта.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Предлагаемые изменения</CardTitle>
            <CardDescription>Какие поля предлагается обновить в профиле</CardDescription>
          </CardHeader>
          <CardContent>{preview}</CardContent>
        </Card>

          {(profileNotes.length > 0 || note.status === 'draft') && (
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-base text-slate-900">В заметки профиля</CardTitle>
                <CardDescription>
                  {note.status === 'approved'
                    ? `Сохранено в заметки студента: ${savedNotesCount ?? profileNotes.length}`
                    : 'Важное из разговора — сохранится в заметки студента при подтверждении'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {note.status === 'draft' ? (
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
                      <div key={i} className="rounded-[2px] border border-amber-200 bg-amber-50 p-3 text-sm text-slate-900">
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
