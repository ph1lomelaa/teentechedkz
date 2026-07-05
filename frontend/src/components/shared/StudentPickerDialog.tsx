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
  DialogFooter,
} from '@/components/ui/dialog'

interface StudentPickerDialogProps {
  open: boolean
  title: string
  onClose: () => void
  onSelect: (studentId: string) => void
  isPending?: boolean
  excludeStudentId?: string | null
}

export function StudentPickerDialog({
  open,
  title,
  onClose,
  onSelect,
  isPending,
  excludeStudentId,
}: StudentPickerDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')

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

  const handleClose = () => {
    setQuery('')
    setSelectedId('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
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
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id ? 'bg-black text-white' : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-gray-500 text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">Не найдено</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Отмена
          </Button>
          <Button disabled={!selectedId || isPending} onClick={() => onSelect(selectedId)}>
            {isPending ? 'Сохраняем…' : 'Выбрать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
