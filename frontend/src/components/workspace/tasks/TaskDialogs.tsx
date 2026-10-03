import React, { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/api'
import { roadmapApi } from '@/api/roadmap'
import { AppButton, AppSelect } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import type { WorkItem } from './workItems'

const FIELD = 'border-w-line bg-w-panel2 text-w-ink'

/**
 * Решение по присланному результату. Один диалог на оба вида задач:
 * у поручения решение уходит в `tasksApi.update`, у шага roadmap — в
 * `roadmapApi.reviewTask`. Различия (комментарий обязателен только при возврате
 * шага, 409 при гонке с другим проверяющим) сидят здесь, а не в странице.
 */
export const ReviewDialog: React.FC<{
  item: WorkItem
  initialDecision: 'accept' | 'return'
  onClose: () => void
  onDone: () => void
}> = ({ item, initialDecision, onClose, onDone }) => {
  const [decision, setDecision] = useState<'accept' | 'return'>(initialDecision)
  const [note, setNote] = useState(item.delegated?.review_note ?? '')
  const isRoadmap = item.kind === 'roadmap'
  const needsNote = decision === 'return' && isRoadmap
  const missingNote = needsNote && !note.trim()

  const mutation = useMutation({
    mutationFn: (): Promise<unknown> => {
      const comment = note.trim()
      if (isRoadmap) {
        return roadmapApi.reviewTask(item.id, {
          action: decision === 'accept' ? 'approve' : 'return',
          ...(comment ? { comment } : {}),
        })
      }
      return tasksApi.update(item.id, {
        status: decision === 'accept' ? 'accepted' : 'needs_revision',
        review_note: comment || undefined,
      })
    },
    onSuccess: () => {
      toast({ title: decision === 'accept' ? 'Результат принят' : 'Отправлено на доработку' })
      onDone()
    },
    onError: (error) =>
      toast({
        title: getErrorStatus(error) === 409 ? 'Эту задачу уже разобрали' : 'Не удалось сохранить решение',
        description: getErrorStatus(error) === 409 ? undefined : getErrorMessage(error),
        variant: 'destructive',
      }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-w-line bg-w-panel">
        <DialogHeader>
          <DialogTitle className="text-w-ink">Проверка результата</DialogTitle>
          <p className="text-sm text-w-muted">
            {item.title}
            {item.studentName ? ` · ${item.studentName}` : ''}
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <AppSelect
            colorPrefix="w"
            aria-label="Решение"
            className="w-full"
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
          >
            <option value="accept">Принять результат</option>
            <option value="return">Вернуть на доработку</option>
          </AppSelect>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-w-muted">
              Комментарий{needsNote ? '' : ' (необязательно)'}
            </Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={decision === 'return' ? 'Что нужно исправить' : 'Можно оставить пустым'}
              rows={4}
              className={FIELD}
            />
            {missingNote && <p className="text-xs text-w-danger">При возврате нужен комментарий — студент увидит его.</p>}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" onClick={onClose}>Отмена</AppButton>
          <AppButton colorPrefix="w" disabled={missingNote || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Сохраняем…' : 'Сохранить решение'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Загрузка подтверждающего файла к поручению. Только поручения: у шага roadmap подтверждений нет. */
export const EvidenceDialog: React.FC<{
  item: WorkItem
  onClose: () => void
  onDone: () => void
}> = ({ item, onClose, onDone }) => {
  const required = item.delegated?.required_documents ?? []
  const [requirement, setRequirement] = useState(required[0] ?? '')
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    setRequirement(required[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const { data: uploaded, isLoading } = useQuery({
    queryKey: ['workspace', 'task-evidence', item.id],
    queryFn: () => tasksApi.listEvidence(item.id),
  })

  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Файл не выбран')
      return tasksApi.uploadEvidence(item.id, file, requirement || undefined)
    },
    onSuccess: () => {
      toast({ title: 'Подтверждение загружено' })
      onDone()
    },
    onError: (error) =>
      toast({ title: 'Не удалось загрузить файл', description: getErrorMessage(error), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-w-line bg-w-panel">
        <DialogHeader>
          <DialogTitle className="text-w-ink">Подтверждение к задаче</DialogTitle>
          <p className="text-sm text-w-muted">{item.title}</p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-panel border border-w-line bg-w-panel2 p-3">
            <p className="mb-2 text-xs font-bold text-w-ink">Уже загружено</p>
            {isLoading ? (
              <p className="text-xs text-w-muted">Загрузка списка…</p>
            ) : uploaded?.length ? (
              <ul className="space-y-1.5">
                {uploaded.map((evidence) => (
                  <li key={evidence.id} className="flex items-center justify-between gap-3 text-xs text-w-muted">
                    <span className="truncate">{evidence.requirement || 'Без требования'}</span>
                    <span className="shrink-0 text-w-muted2">{evidence.file_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-w-muted">Пока ничего нет.</p>
            )}
          </div>
          <AppSelect
            colorPrefix="w"
            aria-label="Какое требование закрывает файл"
            className="w-full"
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
          >
            <option value="">Выберите требование</option>
            {required.map((doc) => <option key={doc} value={doc}>{doc}</option>)}
          </AppSelect>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Файл подтверждения"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-xs text-w-muted file:mr-3 file:rounded-ctl file:border-0 file:bg-w-accent file:px-3 file:py-2 file:text-xs file:font-bold file:text-black"
          />
        </div>
        <DialogFooter className="gap-2">
          <AppButton colorPrefix="w" variant="subtle" onClick={onClose}>Закрыть</AppButton>
          <AppButton colorPrefix="w" disabled={!requirement || !file || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Загружаем…' : 'Загрузить файл'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
