import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

interface StudentPickerDialogProps {
  open: boolean
  title: string
  onClose: () => void
  onSelect: (studentId: string) => void
  isPending?: boolean
  excludeStudentId?: string | null
  description?: string
  currentStudentLabel?: string | null
  confirmBeforeSelect?: boolean
}

export function StudentPickerDialog({
  open,
  title,
  onClose,
  onSelect,
  isPending,
  excludeStudentId,
  description,
  currentStudentLabel,
  confirmBeforeSelect = false,
}: StudentPickerDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: allStudents = [] } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
    enabled: open,
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = excludeStudentId ? allStudents.filter((s) => s.id !== excludeStudentId) : allStudents
    if (!q) return pool.slice(0, 30)
    return pool.filter((s) => s.full_name.toLowerCase().includes(q)).slice(0, 30)
  }, [allStudents, query, excludeStudentId])

  const selectedStudent = useMemo(
    () => allStudents.find((s) => s.id === selectedId),
    [allStudents, selectedId]
  )

  const handleClose = () => {
    setQuery('')
    setSelectedId('')
    setConfirming(false)
    onClose()
  }

  const handlePrimary = () => {
    if (!selectedId) return
    if (confirmBeforeSelect && !confirming) {
      setConfirming(true)
      return
    }
    onSelect(selectedId)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {confirming && selectedStudent ? (
          <div className="space-y-3">
            <div className="rounded-[2px] border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Сейчас привязан</p>
              <p className="mt-1 text-sm font-medium text-gray-900">{currentStudentLabel || 'Не указан'}</p>
            </div>
            <div className="rounded-[2px] border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Будет привязан</p>
              <p className="mt-1 text-sm font-semibold text-gray-950">{selectedStudent.full_name}</p>
              <p className="mt-1 text-xs text-amber-800">
                Год поступления: {selectedStudent.intake_year ?? '—'}
                {selectedStudent.phone ? ` · ${selectedStudent.phone}` : ''}
              </p>
            </div>
            <p className="text-xs text-gray-500">
              После подтверждения новые сообщения и AI-разбор будут относиться к выбранному студенту.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Поиск студента..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-[2px] divide-y divide-gray-100">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedId(s.id)
                    setConfirming(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    selectedId === s.id ? 'bg-black text-white' : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {s.full_name}
                  <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-gray-500 text-xs ml-2'}>
                    {s.intake_year}
                  </span>
                  {s.phone && (
                    <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-gray-500 text-xs ml-2'}>
                      {s.phone}
                    </span>
                  )}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">Не найдено</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={confirming ? () => setConfirming(false) : handleClose}>
            {confirming ? 'Назад к выбору' : 'Отмена'}
          </Button>
          <Button disabled={!selectedId || isPending} onClick={handlePrimary}>
            {isPending ? 'Сохраняем…' : confirming ? 'Подтвердить' : confirmBeforeSelect ? 'Проверить выбор' : 'Выбрать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
