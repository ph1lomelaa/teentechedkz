import React from 'react'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

interface AppInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  colorPrefix?: ColorPrefix
}

const LABEL_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-muted',
  p: 'text-p-muted',
  w: 'text-w-muted',
}

const FIELD_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-line bg-ds-panel2 text-ds-ink placeholder-ds-muted2 focus:border-ds-accent-dim',
  p: 'border-p-line bg-p-panel2 text-p-text placeholder-p-muted2 focus:border-p-accent-dim',
  w: 'border-w-line bg-w-panel2 text-w-ink placeholder-w-muted2 focus:border-w-accentDim',
}

const DANGER_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-danger',
  p: 'text-p-danger',
  w: 'text-w-danger',
}

const DANGER_BORDER_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-danger focus:border-ds-danger',
  p: 'border-p-danger focus:border-p-danger',
  w: 'border-w-danger focus:border-w-danger',
}

export const AppInput = React.forwardRef<HTMLInputElement, AppInputProps>(
  ({ label, error, className, colorPrefix = 'ds', type = 'text', placeholder, required, 'aria-label': ariaLabel, ...props }, ref) => {
    return (
      <label className="block">
        {label && (
          <span className={cn('mb-1.5 block text-2xs font-bold uppercase tracking-widest', LABEL_CLASS[colorPrefix])}>
            {label}
            {required && <span className={cn('ml-1', DANGER_CLASS[colorPrefix])}>*</span>}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          placeholder={placeholder}
          required={required}
          // No visible `label`? Fall back to the placeholder (or a generic
          // name) so the field still has an accessible name — placeholder
          // text alone isn't a substitute for one (WCAG).
          aria-label={label ? ariaLabel : ariaLabel || placeholder || 'Поле ввода'}
          className={cn(
            'w-full rounded-ctl border px-4 py-3 text-sm transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
            FIELD_CLASS[colorPrefix],
            error && DANGER_BORDER_CLASS[colorPrefix],
            className
          )}
          {...props}
        />
        {error && <span className={cn('mt-1 block text-[11px] font-medium', DANGER_CLASS[colorPrefix])}>{error}</span>}
      </label>
    )
  }
)

AppInput.displayName = 'AppInput'
