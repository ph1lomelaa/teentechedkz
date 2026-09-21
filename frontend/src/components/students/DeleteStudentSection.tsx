import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { studentKeys } from '@/lib/queryKeys'

/**
 * Полное удаление карточки — в самом низу карточки студента.
 *
 * Для мусора из импортов, а не для ушедших студентов (их архивируют). Удаление
 * необратимо и забирает договоры с платежами, поэтому кнопка подтверждения
 * включается только после того, как введено ФИО: случайный клик по красной
 * кнопке не должен стоить карточки.
 */
export const DeleteStudentSection: React.FC<{ studentId: string; fullName: string }> = ({
  studentId,
  fullName,
}) => {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  const confirmed = typed.trim().toLowerCase() === fullName.trim().toLowerCase()

  const mutation = useMutation({
    mutationFn: () => studentsApi.deletePermanent(studentId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: studentKeys.detail(studentId) })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Карточка удалена', description: fullName })
      navigate('/students', { replace: true })
    },
    onError: (err) => {
      toast({ title: 'Не удалось удалить', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const close = () => {
    if (mutation.isPending) return
    setOpen(false)
    setTyped('')
  }

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-red-200 bg-red-50/40 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-red-700">Удалить карточку</div>
          <div className="text-xs text-red-700/70">
            Насовсем, вместе с договорами, заявками и документами. Вернуть нельзя.
          </div>
        </div>
        <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
          Удалить карточку
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить карточку насовсем?</DialogTitle>
            <DialogDescription>
              Вместе с карточкой удалятся договоры и платежи, заявки, документы и файлы,
              назначения ответственных, задачи, роудмап и начисления менторам по этому
              студенту. Заметки и Telegram-чаты останутся, но отвяжутся. Отменить нельзя.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="delete-student-confirm">
              Чтобы подтвердить, введите ФИО: <span className="font-medium text-foreground">{fullName}</span>
            </label>
            <Input
              id="delete-student-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate()}
              disabled={!confirmed || mutation.isPending}
            >
              {mutation.isPending ? 'Удаляем…' : 'Удалить навсегда'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
