import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { emptyStep, learnerTasksApi } from '@/api/learnerTasks'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { getErrorMessage } from '@/lib/errorMessage'

/** Новый шаг прямо в плане, как задача в Roadmap: название, срок, что сдать, проверка и файл. */
export function AddStepInline({ studentId, participationId }: { studentId: string; participationId: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(() => ({ ...emptyStep(), requires_review: true }))
  const [key, setKey] = useState(() => crypto.randomUUID())
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () => learnerTasksApi.create({ ...step, title: step.title.trim(), creation_key: key, student_id: studentId, activity_participation_id: participationId }),
    onSuccess: () => {
      ['activities', 'portal', 'workspace', 'student-tasks'].forEach((k) => client.invalidateQueries({ queryKey: [k] }))
      // Форма остаётся открытой: следующий шаг можно добавить сразу.
      setStep({ ...emptyStep(), requires_review: step.requires_review })
      setKey(crypto.randomUUID())
    },
  })
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-ctl px-2 py-1.5 text-sm font-bold text-ds-muted transition hover:text-ds-ink">
    <Plus className="h-4 w-4" aria-hidden />Добавить шаг
  </button>
  return <form className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4" onSubmit={(e) => { e.preventDefault(); if (step.title.trim()) save.mutate() }}>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
      <label className="block text-sm font-semibold">Что сделать<Input className="mt-1" autoFocus maxLength={500} value={step.title} onChange={(e) => setStep({ ...step, title: e.target.value })} placeholder="Например: зарегистрироваться на сайте" /></label>
      <label className="block text-sm font-semibold">Срок<Input className="mt-1" type="date" value={step.due_date ?? ''} onChange={(e) => setStep({ ...step, due_date: e.target.value || null })} /></label>
    </div>
    <label className="block text-sm font-semibold">Что сдать<Input className="mt-1" maxLength={2000} value={step.expected_result} onChange={(e) => setStep({ ...step, expected_result: e.target.value })} placeholder="Например: скриншот подтверждения регистрации" /></label>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={step.requires_review} onChange={(e) => setStep({ ...step, requires_review: e.target.checked })} />Проверяю я</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={step.requires_evidence} onChange={(e) => setStep({ ...step, requires_evidence: e.target.checked })} />Нужен файл от ученика</label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <AppButton size="sm" type="submit" disabled={!step.title.trim() || save.isPending}>Добавить шаг</AppButton>
      <AppButton size="sm" variant="subtle" type="button" onClick={() => setOpen(false)}>Готово</AppButton>
    </div>
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
  </form>
}
