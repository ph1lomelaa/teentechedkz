import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Input } from '@/components/ui/primitives/input'

/**
 * Спросить причину замены ответственного.
 *
 * Зачем отдельным компонентом
 * ---------------------------
 * Замена пишется в историю назначений, поэтому причина обязательна — это
 * правило бэкенда (`_assign_one` возвращает `needs_reason`), а не украшение
 * экрана. Спрашивают её теперь два места: общая база (массовое назначение) и
 * доска распределения (перетаскивание карточки). Пока диалог жил внутри
 * страницы списка, доске пришлось бы завести второй такой же — и формулировки
 * с поведением разъехались бы на первом же изменении.
 *
 * Компонент отвечает только за текст и ввод: запрос делает вызывающий, он же
 * решает, по каким студентам его повторять.
 */
interface ReplacementReasonDialogProps {
  /** Кого заменяем. null — диалог закрыт. */
  studentCount: number | null
  /** Имя нового ответственного, если известно, — иначе спрашиваем «вслепую». */
  targetName?: string | null
  isPending?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export const ReplacementReasonDialog: React.FC<ReplacementReasonDialogProps> = ({
  studentCount,
  targetName,
  isPending,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('')
  const open = studentCount !== null

  // Причина относится к конкретной замене: оставить её от прошлой — значит
  // записать в историю чужое объяснение.
  useEffect(() => {
    if (open) setReason('')
  }, [open, studentCount, targetName])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Нужна причина замены</DialogTitle>
          <DialogDescription>
            {studentCount === 1
              ? 'У этого студента уже есть ответственный этой роли. Замена попадёт в историю — укажите причину.'
              : `У ${studentCount} студентов уже есть ответственный этой роли. Замена попадёт в историю — укажите причину.`}
            {targetName ? ` Новый ответственный — ${targetName}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например: ментор ушёл в отпуск"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && reason.trim() && !isPending) onConfirm(reason.trim())
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={!reason.trim() || isPending} onClick={() => onConfirm(reason.trim())}>
            {isPending ? 'Заменяем…' : 'Заменить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
