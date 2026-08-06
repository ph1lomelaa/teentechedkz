import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { complaintsApi, ComplaintCategory, ComplaintKind } from '@/api/complaints'
import { studentsApi } from '@/api/students'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'

const KIND_LABELS: Record<ComplaintKind, string> = {
  complaint: 'Жалоба',
  recommendation: 'Рекомендация',
}
const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  student: 'Студент', parent: 'Родитель', deadline: 'Сроки', quality: 'Качество',
  specialist_change: 'Смена специалиста', communication: 'Коммуникация', refund: 'Возврат',
  suggestion: 'Предложение', other: 'Другое',
}

/** Новое обращение — один диалог для всех ролей.
 *
 * Бэкенд никогда не ограничивал создание по ролям и принимает student_id, но
 * форма до этого была только у студента в портале: ментор и админ не могли
 * написать обращение вообще. Здесь ментор может привязать обращение к своему
 * студенту — или оставить поле пустым, если вопрос общий.
 *
 * `withStudentPicker` включает выбор студента: в портале он не нужен, там
 * автор и есть студент.
 */
export const CreateComplaintDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  withStudentPicker?: boolean
  colorPrefix?: 'ds' | 'p' | 'w'
  /** Ключи, которые надо обновить после отправки — у каждой оболочки свои. */
  invalidateKeys?: unknown[][]
}> = ({ open, onOpenChange, withStudentPicker = false, colorPrefix = 'w', invalidateKeys = [] }) => {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ComplaintKind>('complaint')
  const [category, setCategory] = useState<ComplaintCategory>('other')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [studentId, setStudentId] = useState('')

  // scope: 'mine' — ментор видит только своих, админ и МЗК всех.
  const { data: studentsPage } = useQuery({
    queryKey: ['complaint-students'],
    queryFn: () => studentsApi.list({ scope: 'mine', size: 200 }),
    enabled: open && withStudentPicker,
  })
  const students = studentsPage?.items ?? []

  const reset = () => {
    setKind('complaint')
    setCategory('other')
    setSubject('')
    setBody('')
    setStudentId('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      complaintsApi.create({
        kind,
        category,
        applicant_type: 'student',
        subject: subject.trim(),
        body: body.trim(),
        ...(studentId ? { student_id: studentId } : {}),
      }),
    onSuccess: () => {
      for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: key })
      toast({ title: 'Обращение отправлено' })
      reset()
      onOpenChange(false)
    },
    onError: (err) =>
      toast({ title: 'Не удалось отправить обращение', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const canSubmit = subject.trim() && body.trim() && !mutation.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Новое обращение</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-p-muted2">Тип обращения</p>
            <div className="flex rounded-ctl border border-p-line bg-p-bg p-1 text-xs" role="group" aria-label="Тип обращения">
            {(['complaint', 'recommendation'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={`flex-1 rounded-ctl px-3 py-2 font-bold transition-colors ${
                  kind === value
                    ? 'bg-[#FFD400] text-black shadow-sm'
                    : 'text-p-muted hover:bg-p-panel2 hover:text-p-text'
                }`}
              >
                {KIND_LABELS[value]}
              </button>
            ))}
            </div>
          </div>

          {withStudentPicker && (
            <label className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-p-muted2">Студент</span>
                <span className="text-[11px] text-p-muted2">Необязательно</span>
              </span>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className={CONTROL}
              >
                <option value="">Общее обращение — без студента</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-p-muted2">Категория <b className="text-p-accent">*</b></span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ComplaintCategory)} className={CONTROL}>
              {(Object.keys(CATEGORY_LABELS) as ComplaintCategory[]).map((value) => (
                <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-p-muted2">Тема <b className="text-p-accent">*</b></span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Например: не получил ответ по документам"
              className={CONTROL}
              maxLength={160}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-p-muted2">Подробности <b className="text-p-accent">*</b></span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Опишите ситуацию: что произошло, когда и какой результат вы ожидаете"
              className="min-h-32 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand-dim"
              maxLength={5000}
            />
            <span className="mt-1 block text-right text-[11px] text-p-muted2">{body.length}/5000</span>
          </label>
        </div>

        <DialogFooter className="mt-1">
          <AppButton variant="ghost" colorPrefix={colorPrefix} onClick={() => onOpenChange(false)}>
            Отмена
          </AppButton>
          <AppButton colorPrefix={colorPrefix} disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Отправляем…' : 'Отправить'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CONTROL =
  'h-11 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim'
