import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { ADMIN_TOKENS, type AdminColorPrefix } from '@/components/admin/tokens'
import { cn } from '@/lib/utils'

export interface PickedStudent {
  id: string
  name: string
}

/**
 * Выбор студента: серверный поиск по имени (без потолка в N загруженных карточек).
 * Выбранный студент сворачивается в одну строку с крестиком — список не висит
 * над остальной формой.
 */
export const StudentField: React.FC<{
  colorPrefix: AdminColorPrefix
  value: PickedStudent | null
  onChange: (value: PickedStudent | null) => void
  placeholder?: string
  autoFocus?: boolean
}> = ({ colorPrefix, value, onChange, placeholder = 'Начните вводить имя студента', autoFocus }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: ['students', 'task-picker', debounced],
    queryFn: () => studentsApi.list({ search: debounced || undefined, size: 8 }),
    enabled: !value,
  })

  if (value) {
    return (
      <div className={cn('flex items-center justify-between gap-2 rounded-ctl border px-3 py-2.5 text-sm', t.borderLine, t.panel2)}>
        <span className={cn('min-w-0 truncate font-bold', t.ink)}>{value.name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Убрать студента" className={cn('shrink-0', t.muted)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const items = data?.items ?? []
  return (
    <div className={cn('overflow-hidden rounded-ctl border', t.borderLine)}>
      <label className={cn('relative block border-b', t.borderLine, t.panel2)}>
        <Search className={cn('pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', t.muted2)} aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Поиск студента по имени"
          autoFocus={autoFocus}
          className={cn('h-11 w-full bg-transparent pl-10 pr-3 text-sm outline-none placeholder:opacity-60', t.ink)}
        />
      </label>
      <div className={cn('max-h-44 overflow-y-auto', t.panel2)} role="listbox" aria-label="Студенты">
        {items.length === 0 ? (
          <p className={cn('px-3 py-3 text-xs', t.muted)}>{isFetching ? 'Ищем…' : 'Никто не найден'}</p>
        ) : (
          items.map((student) => (
            <button
              key={student.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onChange({ id: student.id, name: student.full_name })}
              className={cn('block w-full truncate px-3 py-2.5 text-left text-sm font-bold transition hover:bg-current/5', t.ink)}
            >
              {student.full_name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
