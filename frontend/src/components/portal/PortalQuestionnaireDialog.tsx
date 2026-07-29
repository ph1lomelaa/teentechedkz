import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import {
  questionnairesApi,
  AnswerValue,
  QuestionnaireQuestion,
} from '@/api/questionnaires'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

export const PortalQuestionnaireDialog: React.FC<{
  questionnaireId: string
  open: boolean
  onClose: () => void
}> = ({ questionnaireId, open, onClose }) => {
  const queryClient = useQueryClient()
  const { data: q, isLoading } = useQuery({
    queryKey: ['questionnaire', questionnaireId],
    queryFn: () => questionnairesApi.get(questionnaireId),
    enabled: open,
  })
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (q) setAnswers(q.answers || {})
  }, [q])

  const readOnly = q?.status === 'submitted' || q?.status === 'reviewed'

  const submitMut = useMutation({
    mutationFn: () => questionnairesApi.respond(questionnaireId, answers, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionnaire', questionnaireId] })
      queryClient.invalidateQueries({ queryKey: ['portal', 'questionnaires'] })
      toast({ title: 'Ответы отправлены', description: 'Ментор получит уведомление.' })
      onClose()
    },
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
      if (d && typeof d === 'object' && 'message' in d) setError(String((d as { message: unknown }).message))
      else setError(typeof d === 'string' ? d : 'Не удалось отправить')
    },
  })

  if (!open) return null

  const setAnswer = (id: string, value: AnswerValue) => setAnswers((a) => ({ ...a, [id]: value }))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-card border border-p-line bg-p-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-p-line px-5 py-4">
          <div className="min-w-0">
            <p className="font-display text-[10px] font-black uppercase tracking-[0.24em] text-brand">Анкета</p>
            <div className="truncate font-display text-lg font-black text-p-text">{q?.title || 'Анкета'}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-ctl border border-p-line text-p-muted transition hover:text-p-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {isLoading || !q ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : (
            <div className="space-y-5">
              {q.description && <p className="text-sm text-p-muted">{q.description}</p>}
              {readOnly && (
                <div className="rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-xs font-bold text-p-muted">
                  {q.status === 'reviewed' ? 'Анкета проверена ментором' : 'Ответы отправлены'} — только просмотр.
                </div>
              )}
              {q.questions.map((question, i) => (
                <QuestionField
                  key={question.id}
                  index={i}
                  question={question}
                  value={answers[question.id]}
                  onChange={(v) => setAnswer(question.id, v)}
                  disabled={readOnly}
                />
              ))}
              {error && <p className="text-sm font-bold text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center justify-end gap-2 border-t border-p-line px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-ctl border border-p-line px-4 py-2 text-xs font-bold text-p-muted transition hover:text-p-text"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={submitMut.isPending}
              onClick={() => { setError(null); submitMut.mutate() }}
              className="inline-flex items-center gap-1.5 rounded-ctl bg-brand px-4 py-2 text-xs font-black text-black transition disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {submitMut.isPending ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const QuestionField: React.FC<{
  index: number
  question: QuestionnaireQuestion
  value: AnswerValue | undefined
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}> = ({ index, question, value, onChange, disabled }) => {
  const label = (
    <div className="mb-2">
      <label className="block whitespace-normal break-words text-[15px] font-bold leading-6 text-p-text">
        {index + 1}. {question.label}
        {question.required && <span className="text-brand"> *</span>}
      </label>
      {question.help_text && <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-p-muted">{question.help_text}</p>}
    </div>
  )
  const base = 'w-full rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand disabled:opacity-60'

  if (question.kind === 'long_text') {
    return (
      <div>
        {label}
        <textarea disabled={disabled} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} className={cn(base, 'min-h-36 resize-y leading-6')} />
      </div>
    )
  }
  if (question.kind === 'bool') {
    return (
      <div>
        {label}
        <div className="flex gap-2">
          {([['Да', true], ['Нет', false]] as Array<[string, boolean]>).map(([lbl, val]) => (
            <button
              key={String(val)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(val)}
              className={cn(
                'rounded-ctl border px-4 py-2 text-sm font-bold transition',
                (value === val) ? 'border-brand bg-brand text-black' : 'border-p-line text-p-muted hover:text-p-text',
                disabled && 'opacity-60'
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (question.kind === 'choice') {
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {question.options.map((opt) => (
            <label key={opt} className={cn('flex items-center gap-2 rounded-ctl border px-3 py-2 text-sm', value === opt ? 'border-brand text-p-text' : 'border-p-line text-p-muted')}>
              <input type="radio" disabled={disabled} checked={value === opt} onChange={() => onChange(opt)} className="accent-brand" />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }
  if (question.kind === 'multi') {
    const arr = Array.isArray(value) ? value : []
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {question.options.map((opt) => {
            const checked = arr.includes(opt)
            return (
              <label key={opt} className={cn('flex items-center gap-2 rounded-ctl border px-3 py-2 text-sm', checked ? 'border-brand text-p-text' : 'border-p-line text-p-muted')}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={checked}
                  onChange={() => onChange(checked ? arr.filter((x) => x !== opt) : [...arr, opt])}
                  className="accent-brand"
                />
                {opt}
              </label>
            )
          })}
        </div>
      </div>
    )
  }
  // text
  return (
    <div>
      {label}
      <input disabled={disabled} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} className={base} />
    </div>
  )
}
