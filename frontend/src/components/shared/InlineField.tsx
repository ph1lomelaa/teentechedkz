import type React from 'react'
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

/** Текст, который правится по клику: Enter сохраняет, Esc отменяет. Как в Roadmap. */
export const InlineField: React.FC<{ value: string; canEdit: boolean; onSave: (value: string) => void; label: string; className?: string; multiline?: boolean; required?: boolean; emptyLabel?: string }> = ({ value, canEdit, onSave, label, className, multiline, required, emptyLabel }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const skipBlur = useRef(false)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) { skipBlur.current = false; input.current?.select() } }, [editing])
  useEffect(() => { if (editing && input.current instanceof HTMLTextAreaElement) { input.current.style.height = 'auto'; input.current.style.height = `${input.current.scrollHeight}px` } }, [draft, editing])
  const save = () => {
    if (skipBlur.current) { skipBlur.current = false; return }
    const next = draft.trim()
    setEditing(false)
    if (next !== value && (!required || next)) onSave(next)
  }
  if (!canEdit && !value) return null
  if (!editing) return canEdit ? <button type="button" onClick={() => setEditing(true)} className={cn('max-w-full whitespace-pre-wrap text-left hover:underline focus-visible:outline-2 focus-visible:outline-w-accent', className)} aria-label={`Изменить: ${label}`}>{value || emptyLabel}</button> : <span className={cn('whitespace-pre-wrap', className)}>{value}</span>
  const common = { ref: input, value: draft, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value), onBlur: save, onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (event.key === 'Escape') { skipBlur.current = true; setEditing(false); setDraft(value) } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); skipBlur.current = true } }, 'aria-label': label, className: 'w-full rounded-ctl border border-w-accentDim bg-w-panel px-2 py-1 text-sm text-w-ink outline-none focus:border-w-accent' }
  return multiline ? <textarea {...common} rows={Math.max(2, draft.split('\n').length)} /> : <input {...common} />
}
