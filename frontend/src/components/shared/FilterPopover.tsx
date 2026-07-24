import React, { useState } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'

/** Кнопка «Фильтры» с бейджем активных фильтров + выпадающая панель.
 * Визуально повторяет панель фильтров «Общей базы студентов», чтобы все
 * списки в CRM выглядели и вели себя одинаково. */
export function FilterPopover({
  activeCount,
  onReset,
  children,
}: {
  activeCount: number
  onReset: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        type="button"
        variant={activeCount > 0 ? 'default' : 'outline'}
        size="sm"
        className="h-9 gap-1.5"
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="w-3.5 h-3.5" />
        Фильтры
        {activeCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-white/15 text-[11px] font-semibold">
            {activeCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 max-w-[calc(100vw-2rem)] rounded-panel border border-p-line bg-white shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-p-line bg-p-bg">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Фильтры</p>
            <button type="button" className="text-p-muted2 hover:text-p-text" onClick={() => setOpen(false)} aria-label="Закрыть">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 space-y-4">{children}</div>
          <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-p-muted" onClick={onReset}>
              Сбросить
            </Button>
            <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">{label}</p>
      {children}
    </div>
  )
}

export interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

export function FilterChips({ chips, onResetAll }: { chips: FilterChip[]; onResetAll: () => void }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-pill border border-p-line bg-p-bg text-p-text"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="text-p-muted2 hover:text-black transition-colors"
            aria-label={`Убрать фильтр ${chip.label}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onResetAll}
        className="text-[12px] text-p-muted hover:text-black underline underline-offset-4 ml-1"
      >
        Сбросить всё
      </button>
    </div>
  )
}

/** Список ответственных (менторы + МЗК) с поиском по имени — та же панель,
 * что и в «Общей базе». `value === ''` значит «любой». */
export function ResponsiblePicker({
  users,
  value,
  onChange,
}: {
  users: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = users.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Найти по имени..."
        className="h-9 text-sm"
      />
      <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`w-full text-left px-2 py-1.5 text-sm rounded-ctl border transition-colors ${
            value === '' ? 'border-black bg-black text-white' : 'border-p-line bg-white hover:bg-p-bg text-p-text'
          }`}
        >
          Любой
        </button>
        {filtered.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => onChange(user.id)}
            className={`w-full text-left px-2 py-1.5 text-sm rounded-ctl border transition-colors ${
              value === user.id ? 'border-black bg-black text-white' : 'border-p-line bg-white hover:bg-p-bg text-p-text'
            }`}
          >
            {user.name}
          </button>
        ))}
        {filtered.length === 0 && <p className="px-2 py-2 text-sm text-p-muted">Пользователей нет</p>}
      </div>
    </div>
  )
}
