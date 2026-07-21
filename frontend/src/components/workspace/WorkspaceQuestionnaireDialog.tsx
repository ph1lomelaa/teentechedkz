import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Send, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  questionnairesApi,
  Questionnaire,
  QuestionKind,
  QUESTION_KIND_LABEL,
  QUESTIONNAIRE_STATUS_LABEL,
} from '@/api/questionnaires'
import { WorkspaceButton, WorkspaceInput, WorkspaceSelect } from '@/components/workspace/ui'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

interface EditQuestion {
  key: string
  kind: QuestionKind
  label: string
  helpText: string
  required: boolean
  options: string // comma-separated, for choice/multi
}

let keySeq = 0
const newKey = () => `q_${Date.now()}_${keySeq++}`

function toEdit(q: Questionnaire): EditQuestion[] {
  return q.questions.map((x) => ({
    key: x.id,
    kind: x.kind,
    label: x.label,
    helpText: x.help_text || '',
    required: x.required,
    options: (x.options || []).join(', '),
  }))
}

export const WorkspaceQuestionnaireDialog: React.FC<{
  taskId: string
  taskTitle: string
  studentId: string
  open: boolean
  onClose: () => void
}> = ({ taskId, taskTitle, studentId, open, onClose }) => {
  const queryClient = useQueryClient()
  const { data: q, isLoading } = useQuery({
    queryKey: ['questionnaire', 'task', taskId],
    queryFn: () => questionnairesApi.forTask(taskId),
    enabled: open,
  })

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<EditQuestion[]>([])
  const [editingQuestionKey, setEditingQuestionKey] = useState<string | null>(null)

  useEffect(() => {
    if (q) {
      setTitle(q.title)
      setDescription(q.description)
      setQuestions(toEdit(q))
      setEditingQuestionKey(null)
    } else if (q === null) {
      const key = newKey()
      setTitle(taskTitle)
      setDescription('')
      setQuestions([{ key, kind: 'text', label: '', helpText: '', required: true, options: '' }])
      setEditingQuestionKey(key)
    }
  }, [q, taskTitle])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['questionnaire', 'task', taskId] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'roadmap'] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'roadmap-tasks'] })
  }

  const buildQuestions = () =>
    questions
      .filter((x) => x.label.trim())
      .map((x) => ({
        kind: x.kind,
        label: x.label.trim(),
        help_text: x.helpText.trim(),
        required: x.required,
        options: ['choice', 'multi'].includes(x.kind)
          ? x.options.split(',').map((o) => o.trim()).filter(Boolean)
          : [],
      }))

  const createMut = useMutation({
    mutationFn: () => questionnairesApi.create(taskId, { title: title.trim() || taskTitle, description, questions: buildQuestions() }),
    onSuccess: () => { invalidate(); toast({ title: 'Анкета создана' }) },
    onError: (e: unknown) => toast({ title: 'Не удалось создать', description: detail(e), variant: 'destructive' }),
  })
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!q) return
      await questionnairesApi.update(q.id, { title: title.trim() || taskTitle, description })
      return questionnairesApi.putQuestions(q.id, buildQuestions())
    },
    onSuccess: () => { invalidate(); toast({ title: 'Анкета сохранена' }) },
    onError: (e: unknown) => toast({ title: 'Не удалось сохранить', description: detail(e), variant: 'destructive' }),
  })
  const sendMut = useMutation({
    mutationFn: () => questionnairesApi.send(q!.id),
    onSuccess: () => { invalidate(); toast({ title: 'Отправлено студенту', description: 'Студент получит уведомление.' }) },
    onError: (e: unknown) => toast({ title: 'Не удалось отправить', description: detail(e), variant: 'destructive' }),
  })
  const reviewMut = useMutation({
    mutationFn: () => questionnairesApi.review(q!.id),
    onSuccess: () => { invalidate(); toast({ title: 'Отмечено проверенной' }) },
    onError: (e: unknown) => toast({ title: 'Ошибка', description: detail(e), variant: 'destructive' }),
  })

  if (!open) return null

  const exists = Boolean(q)
  const status = q?.status
  const readOnly = status === 'submitted' || status === 'reviewed'
  const busy = createMut.isPending || saveMut.isPending || sendMut.isPending || reviewMut.isPending

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-questionnaire-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-w-line bg-w-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-w-line px-6 py-4">
          <div className="min-w-0">
            <div id="workspace-questionnaire-title" className="font-display text-lg font-black text-w-ink">Анкета к задаче</div>
            <div className="truncate text-xs text-w-muted">{taskTitle}</div>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <span className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
                status === 'draft' && 'border border-w-line text-w-muted',
                status === 'sent' && 'bg-w-accent/15 text-w-accentText',
                status === 'submitted' && 'bg-w-good/15 text-w-good',
                status === 'reviewed' && 'bg-w-good text-black',
              )}>
                {QUESTIONNAIRE_STATUS_LABEL[status]}
              </span>
            )}
            <button type="button" aria-label="Закрыть анкету" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[10px] border border-w-line text-w-muted transition hover:text-w-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <p className="text-sm text-w-muted">Загрузка…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-w-muted2">Название</label>
                <WorkspaceInput disabled={readOnly} value={title} onChange={(e) => setTitle(e.target.value)} className="bg-w-panel2" placeholder="Название анкеты" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-w-muted2">Описание</label>
                <textarea
                  value={description}
                  disabled={readOnly}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Короткое пояснение для студента"
                  className="min-h-16 w-full rounded-[12px] border border-w-line bg-w-panel2 px-3 py-2 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-wide text-w-muted2">Вопросы</label>
                  {!readOnly && <button
                    type="button"
                    onClick={() => {
                      const key = newKey()
                      setQuestions((qs) => [...qs, { key, kind: 'text', label: '', helpText: '', required: true, options: '' }])
                      setEditingQuestionKey(key)
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-w-accentText hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Вопрос
                  </button>}
                </div>
                <div className="space-y-3">
                  {questions.map((item, idx) => {
                    const answer = q?.answers?.[item.key]
                    return (
                      <div key={item.key} className="rounded-[14px] border border-w-line bg-w-panel2 p-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-2 text-xs font-bold text-w-muted2">{idx + 1}.</span>
                          <div className="min-w-0 flex-1 space-y-2">
                            {readOnly || editingQuestionKey !== item.key ? (
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 whitespace-pre-wrap break-words text-base font-black leading-6 text-w-ink">{item.label || 'Новый вопрос'}</div>
                                {!readOnly && <button type="button" onClick={() => setEditingQuestionKey(item.key)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-w-muted transition hover:text-w-accentText"><Pencil className="h-3 w-3" />Изменить</button>}
                              </div>
                            ) : (
                              <textarea
                                rows={2}
                                value={item.label}
                                onChange={(e) => setQuestions((qs) => qs.map((x) => x.key === item.key ? { ...x, label: e.target.value } : x))}
                                placeholder="Текст вопроса"
                                className="min-h-16 w-full resize-y whitespace-pre-wrap break-words rounded-[11px] border border-w-line bg-w-panel px-3 py-2.5 text-base font-black leading-6 text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
                              />
                            )}
                            <textarea
                              disabled={readOnly}
                              value={item.helpText}
                              onChange={(e) => setQuestions((qs) => qs.map((x) => x.key === item.key ? { ...x, helpText: e.target.value } : x))}
                              placeholder="Описание или подсказка под вопросом"
                              className="min-h-20 w-full resize-y rounded-[11px] border border-w-line bg-w-panel px-3 py-2 text-sm leading-5 text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim disabled:opacity-70"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <WorkspaceSelect
                                value={item.kind}
                                disabled={readOnly}
                                onChange={(e) => setQuestions((qs) => qs.map((x) => x.key === item.key ? { ...x, kind: e.target.value as QuestionKind } : x))}
                                className="h-9 py-0"
                              >
                                {(Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]).map((k) => (
                                  <option key={k} value={k}>{QUESTION_KIND_LABEL[k]}</option>
                                ))}
                              </WorkspaceSelect>
                              <label className="flex items-center gap-1.5 text-xs font-bold text-w-muted">
                                <input
                                  type="checkbox"
                                  disabled={readOnly}
                                  checked={item.required}
                                  onChange={(e) => setQuestions((qs) => qs.map((x) => x.key === item.key ? { ...x, required: e.target.checked } : x))}
                                  className="accent-w-accent"
                                />
                                Обязательный
                              </label>
                            </div>
                            {['choice', 'multi'].includes(item.kind) && (
                              <WorkspaceInput
                                disabled={readOnly}
                                value={item.options}
                                onChange={(e) => setQuestions((qs) => qs.map((x) => x.key === item.key ? { ...x, options: e.target.value } : x))}
                                placeholder="Варианты через запятую: A, B, C"
                              />
                            )}
                            {answer !== undefined && answer !== '' && (
                              <div className="rounded-[10px] border border-w-good/30 bg-w-good/10 px-3 py-2 text-sm text-w-ink">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-w-good">Ответ студента</span>
                                <div className="mt-0.5">{Array.isArray(answer) ? answer.join(', ') : String(answer)}</div>
                              </div>
                            )}
                          </div>
                          {!readOnly && <button
                            type="button"
                            onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== item.key))}
                            className="mt-1 text-w-muted2 transition hover:text-w-danger"
                            aria-label="Удалить вопрос"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>}
                        </div>
                      </div>
                    )
                  })}
                  {questions.length === 0 && <p className="text-sm text-w-muted2">Добавьте вопросы.</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-w-line px-6 py-4">
          {!exists ? (
            <WorkspaceButton disabled={busy || !questions.some((x) => x.label.trim())} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Создаём…' : 'Создать анкету'}
            </WorkspaceButton>
          ) : (
            <>
              {!readOnly && <WorkspaceButton variant="ghost" disabled={busy} onClick={() => saveMut.mutate()}>
                <Check className="mr-1.5 h-4 w-4" /> Сохранить
              </WorkspaceButton>}
              {status === 'submitted' && (
                <WorkspaceButton variant="ghost" disabled={busy} onClick={() => reviewMut.mutate()}>
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Проверено
                </WorkspaceButton>
              )}
              {!readOnly && <WorkspaceButton disabled={busy || !q?.questions.length} onClick={() => sendMut.mutate()}>
                <Send className="mr-1.5 h-4 w-4" /> {status === 'draft' ? 'Отправить студенту' : 'Отправить снова'}
              </WorkspaceButton>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function detail(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message)
  return 'Ошибка'
}
