import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, X } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Markdown } from '@/components/shared/Markdown'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

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
  const queryClient = useQueryClient()

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

  const reviewMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') => notesApi.review(id!, { action }),
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

  if (isLoading) {
    return <div className="py-12 text-center text-slate-400">Загрузка...</div>
  }

  if (!note) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-500">Конспект не найден</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/notes">
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

  const preview = diff ? renderDiffPreview(diff.preview) : renderEntries(fieldChanges, 'Нет предлагаемых изменений')

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-3 px-0 text-slate-600 hover:text-slate-950">
            <Link to="/notes">
              <ArrowLeft className="w-4 h-4 mr-2" />
              К списку
            </Link>
          </Button>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-950">
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

        {note.student_id && note.status === 'draft' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => reviewMutation.mutate('reject')}
              disabled={reviewMutation.isPending}
            >
              <X className="w-4 h-4 mr-2" />
              Отклонить
            </Button>
            <Button
              onClick={() => reviewMutation.mutate('approve')}
              disabled={reviewMutation.isPending}
            >
              <Check className="w-4 h-4 mr-2" />
              Подтвердить
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Конспект</CardTitle>
            <CardDescription>Итоговый текст и исходный транскрипт</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Содержание</h3>
              <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4">
                <Markdown>{note.summary_markdown ?? ''}</Markdown>
              </div>
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
                    <Link to={`/students/${note.student_id}`}>Открыть студента</Link>
                  </Button>
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

          {profileNotes.length > 0 && (
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
                <div className="grid gap-2">
                  {profileNotes.map((text, i) => (
                    <div key={i} className="rounded-[2px] border border-amber-200 bg-amber-50 p-3 text-sm text-slate-900">
                      {text}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}
