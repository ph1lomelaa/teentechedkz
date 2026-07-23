import React from 'react'
import { cn } from '@/lib/utils'

interface AppInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const AppInput = React.forwardRef<HTMLInputElement, AppInputProps>(
  ({ label, error, className, type = 'text', placeholder, required, ...props }, ref) => {
    return (
      <label className="block">
        {label && (
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-ds-muted">
            {label}
            {required && <span className="text-ds-danger ml-1">*</span>}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          placeholder={placeholder}
          required={required}
          className={cn(
            'w-full rounded-xl border border-ds-line bg-ds-panel2 px-4 py-3 text-[13.5px] text-ds-ink placeholder-ds-muted2 transition focus:border-ds-accent-dim focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-ds-danger focus:border-ds-danger',
            className
          )}
          {...props}
        />
        {error && <span className="mt-1 block text-[11px] text-ds-danger font-medium">{error}</span>}
      </label>
    )
  }
)

AppInput.displayName = 'AppInput'
