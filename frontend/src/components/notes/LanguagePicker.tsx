import React from 'react'
import { cn } from '@/lib/utils'
import { NOTE_SESSION_LANGUAGE_OPTIONS } from '@/lib/noteSessionUi'
import type { NoteSessionLanguage } from '@/types'

/** Язык разговора: от него зависит качество распознавания (казахский — отдельно, `multi` его не покрывает). */
export const LanguagePicker: React.FC<{
  value: NoteSessionLanguage
  onChange: (language: NoteSessionLanguage) => void
  disabled?: boolean
  inWorkspace: boolean
}> = ({ value, onChange, disabled, inWorkspace }) => (
  <div>
    <p className={cn('mb-2 text-sm font-semibold', inWorkspace ? 'text-w-ink' : 'text-p-text')}>Язык разговора</p>
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Язык разговора">
      {NOTE_SESSION_LANGUAGE_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              'rounded-ctl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60',
              selected
                ? 'border-[#FFD400] bg-[#FFD400] text-black'
                : inWorkspace ? 'border-w-line text-w-muted hover:border-w-accentDim' : 'border-p-line text-p-muted hover:border-p-muted2',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
    <p className={cn('mt-1.5 text-xs', inWorkspace ? 'text-w-muted2' : 'text-p-muted2')}>
      Выберите язык, на котором в основном идёт встреча, — от этого зависит качество текста.
    </p>
  </div>
)
