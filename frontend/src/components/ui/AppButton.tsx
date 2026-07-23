import React from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'
type ButtonSize = 'sm' | 'md'
type ColorPrefix = 'ds' | 'p' | 'w'

interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  colorPrefix?: ColorPrefix
  children: React.ReactNode
}

const getVariantClass = (variant: ButtonVariant, prefix: ColorPrefix): string => {
  if (prefix === 'p') {
    const variants: Record<ButtonVariant, string> = {
      primary: 'bg-p-accent text-black hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(255,212,0,.22)]',
      ghost: 'border border-p-accent-dim text-p-accent hover:bg-p-accent/10',
      subtle: 'border border-p-line bg-p-panel text-p-muted hover:border-p-accent-dim hover:text-p-text',
      danger: 'border border-p-danger/50 text-p-danger hover:bg-p-danger/10',
    }
    return variants[variant]
  } else if (prefix === 'w') {
    const variants: Record<ButtonVariant, string> = {
      primary: 'bg-w-accent text-black hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(255,212,0,.22)]',
      ghost: 'border border-w-accentDim text-w-accent hover:bg-w-accent/10',
      subtle: 'border border-w-line bg-w-panel text-w-muted hover:border-w-accentDim hover:text-w-ink',
      danger: 'border border-w-danger/50 text-w-danger hover:bg-w-danger/10',
    }
    return variants[variant]
  }
  // Default ds
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ds-accent text-black hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(255,212,0,.22)]',
    ghost: 'border border-ds-accent-dim text-ds-accent hover:bg-ds-accent/10',
    subtle: 'border border-ds-line bg-ds-panel text-ds-muted hover:border-ds-accent-dim hover:text-ds-ink',
    danger: 'border border-ds-danger/50 text-ds-danger hover:bg-ds-danger/10',
  }
  return variants[variant]
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-5 py-3 text-[13px]',
}

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  ({ variant = 'primary', size = 'md', colorPrefix = 'ds', className, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl font-extrabold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50',
          getVariantClass(variant, colorPrefix),
          SIZES[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

AppButton.displayName = 'AppButton'
