/**
 * Единые компоненты раздела «Финансы» (ТЗ бухгалтера, 01.11.2026): строгий
 * светлый инструмент. Делаются один раз и используются на всех страницах
 * раздела, чтобы кнопки, таблицы и окна выглядели одинаково везде.
 */
import React from 'react'
import { AlertTriangle, UploadCloud, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/primitives/dialog'
import { cn } from '@/lib/utils'
import type { ScheduleItem } from '@/api/finance'
import { formatAmountInput } from './format'

// ---------------------------------------------------------------- кнопки

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-black hover:bg-[#F0C800]',
  secondary: 'border border-p-line bg-white text-p-text hover:bg-[var(--fin-head)]',
  ghost: 'text-p-text hover:bg-[var(--fin-neutral-bg)]',
  danger: 'text-[var(--fin-bad)] hover:bg-[var(--fin-bad-bg)]',
}

export const FinButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'md' | 'sm' }
>(({ variant = 'secondary', size = 'md', className, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50',
      size === 'md' ? 'h-[38px] px-4 text-sm' : 'h-8 px-3 text-[13px]',
      BUTTON[variant],
      className,
    )}
    {...props}
  />
))
FinButton.displayName = 'FinButton'

// ---------------------------------------------------------------- каркас страницы

export function FinPageHeader({
  crumbs,
  title,
  description,
  badges,
  actions,
}: {
  crumbs?: React.ReactNode
  title: string
  description?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs && <nav aria-label="Путь" className="mb-2 text-[13px] text-p-muted">{crumbs}</nav>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.01em] text-p-text">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-1 text-sm text-p-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function FinCard({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title?: string
  meta?: React.ReactNode
  actions?: React.ReactNode
  /** Без содержимого — только заголовок (свёрнутый блок на «Сегодня»). */
  children?: React.ReactNode
  className?: string
}) {
  const hasBody = children !== undefined && children !== null && children !== false
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border border-p-line bg-white', className)}>
      {(title || actions) && (
        <header className={cn('flex flex-wrap items-center justify-between gap-3 px-5 py-3.5', hasBody && 'border-b border-p-line')}>
          <div className="flex items-baseline gap-3">
            {title && <h2 className="text-base font-bold text-p-text">{title}</h2>}
            {meta && <span className="text-[13px] text-p-muted">{meta}</span>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function FinTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="tablist" className="mb-5 flex gap-6 overflow-x-auto border-b border-p-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-2.5 pt-1 text-sm font-semibold transition-colors',
            value === t.value ? 'border-brand text-p-text' : 'border-transparent text-p-muted hover:text-p-text',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="min-w-[20px] rounded-full bg-[var(--fin-neutral-bg)] px-1.5 text-center text-xs font-bold text-p-text">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Первая строка карточки таблицы: слева поиск и фильтры, справа сводка. */
export function FinFilterBar({ children, summary }: { children?: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-p-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {summary && <div className="text-[13px] font-semibold text-p-text">{summary}</div>}
    </div>
  )
}

export type Tone = 'ok' | 'bad' | 'warn'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-[var(--fin-ok)]',
  bad: 'text-[var(--fin-bad)]',
  warn: 'text-[var(--fin-warn)]',
}

export function FinMetrics({
  items,
}: {
  items: { label: string; value: string; hint?: React.ReactNode; tone?: Tone; progress?: number }[]
  columns?: 3 | 4
}) {
  // Одна строка-сводка вместо сетки карточек: цифры читаются как текст отчёта.
  return (
    <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-3 border-b border-p-line pb-4">
      {items.map((m) => (
        <div key={m.label} className="min-w-0">
          <dt className="text-[13px] text-p-muted">{m.label}</dt>
          <dd className={cn('text-base font-semibold text-p-text', m.tone && TONE_TEXT[m.tone])}>
            {m.value}
            {m.hint && <span className="ml-2 text-[13px] font-normal text-[var(--fin-text-3)]">{m.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------- таблица

export function FinTable({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[15px]" style={{ minWidth }}>{children}</table>
    </div>
  )
}

export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={cn(
      'h-10 whitespace-nowrap border-b border-p-line bg-[var(--fin-head)] px-4 text-left text-[13px] font-semibold text-p-muted first:pl-5 last:pr-5',
      right && 'text-right',
      className,
    )}>
      {children}
    </th>
  )
}

export function Td({ children, right, className, colSpan }: { children?: React.ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn(
      'h-12 border-b border-[var(--fin-line-soft)] px-4 py-2.5 align-middle text-p-text first:pl-5 last:pr-5',
      right && 'whitespace-nowrap text-right',
      className,
    )}>
      {children}
    </td>
  )
}

export function GroupRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-p-line bg-[var(--fin-head)] px-5 py-2 text-[13px] font-semibold text-p-text">
        {children}
      </td>
    </tr>
  )
}

export function TotalRow({ children }: { children: React.ReactNode }) {
  return <tr className="[&>td]:border-b-0 [&>td]:bg-[var(--fin-head)] [&>td]:font-bold">{children}</tr>
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-p-muted">{children}</td>
    </tr>
  )
}

/** Ученик и МЗК второй строкой — так в каждой таблице раздела. */
export function StudentCell({ name, sub, onOpen }: { name: string; sub?: string | null; onOpen?: () => void }) {
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="text-left font-semibold text-p-text hover:underline">{name}</button>
      ) : (
        <span className="font-semibold">{name}</span>
      )}
      {sub && <div className="whitespace-nowrap text-[13px] text-[var(--fin-text-3)]">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- бейджи

export type BadgeTone = 'ok' | 'yellow' | 'neutral' | 'bad' | 'dashed'

const BADGE: Record<BadgeTone, string> = {
  ok: 'bg-[var(--fin-ok-bg)] text-[var(--fin-ok)]',
  yellow: 'bg-[var(--fin-warn-bg)] text-[var(--fin-warn)]',
  neutral: 'bg-[var(--fin-neutral-bg)] text-p-muted',
  bad: 'bg-[var(--fin-bad-bg)] text-[var(--fin-bad)]',
  dashed: 'border border-dashed border-[#D9A800] bg-transparent text-[var(--fin-warn)]',
}

export function FinBadge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-[13px] font-semibold', BADGE[tone])}>
      {children}
    </span>
  )
}

export function ItemStatus({ item }: { item: ScheduleItem; today?: string }) {
  switch (item.state) {
    case 'paid':
      return <FinBadge tone="ok">Оплачено</FinBadge>
    case 'today':
      return <FinBadge tone="yellow">Срок сегодня</FinBadge>
    case 'overdue':
      return <FinBadge tone="bad">Просрочено {item.days_overdue} дн.</FinBadge>
    default:
      // Срок и так виден в соседней колонке — «через N дн.» его только дублировал.
      return <FinBadge tone="neutral">Ожидается</FinBadge>
  }
}

// ---------------------------------------------------------------- поля

export function FinField({
  label,
  required,
  hint,
  children,
  wide,
  htmlFor,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
  htmlFor?: string
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-p-muted">
        {label}
        {required && <span className="ml-0.5 text-[var(--fin-bad)]">*</span>}
      </label>
      {children}
      {hint && <div className="mt-1 text-xs text-[var(--fin-text-3)]">{hint}</div>}
    </div>
  )
}

const CONTROL = 'h-[38px] w-full rounded-lg border border-p-line bg-white px-3 text-sm text-p-text placeholder:text-[var(--fin-text-3)] focus:border-black/40 focus:outline-none focus:ring-2 focus:ring-brand/40'

export const FinInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(CONTROL, className)} {...props} />,
)
FinInput.displayName = 'FinInput'

export function FinSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, 'pr-8', className)} {...props} />
}

/** Поле суммы: разряды ставятся сами при вводе — «450 000». */
export function MoneyInput({ value, onChange, id, ...rest }: { value: string; onChange: (v: string) => void; id?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <FinInput
      id={id}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(formatAmountInput(e.target.value))}
      className="text-right tabular-nums"
      {...rest}
    />
  )
}

export function FileDrop({ file, onFile, id }: { file: File | null; onFile: (f: File | null) => void; id: string }) {
  const [over, setOver] = React.useState(false)
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0] ?? null) }}
      className={cn(
        'flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-center text-sm focus-within:ring-2 focus-within:ring-brand/40',
        over ? 'border-black/40 bg-[var(--fin-head)]' : 'border-p-line text-[var(--fin-text-3)]',
      )}
    >
      <UploadCloud className="h-4 w-4 shrink-0" />
      {file ? <span className="truncate font-semibold text-p-text">{file.name}</span> : <span>Перетащите PDF или фото, или нажмите, чтобы выбрать</span>}
      <input id={id} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  )
}

// ---------------------------------------------------------------- окно и предупреждение

/** Окно: заголовок и строка контекста, поля в две колонки, внизу слева
 * опасное действие, справа «Отмена» и основная кнопка. Закрывается по
 * крестику, Esc и клику по фону — это даёт Radix Dialog. */
export function FinModal({
  open,
  onClose,
  title,
  context,
  children,
  danger,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  context?: React.ReactNode
  children: React.ReactNode
  danger?: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="fin max-w-[560px] gap-0 rounded-xl border-p-line bg-white p-0 text-p-text [&>button.absolute]:hidden">
        <div className="flex items-start justify-between gap-4 border-b border-p-line px-6 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] text-p-muted">{context ?? ' '}</DialogDescription>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-p-muted hover:bg-[var(--fin-neutral-bg)] hover:text-p-text">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-p-line bg-[var(--fin-head)] px-6 py-3">
          <div>{danger}</div>
          <div className="flex gap-2">{footer}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FinAlert({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="status" className="mb-5 flex flex-col items-start gap-3 rounded-xl border border-[#F2D675] sm:flex-row sm:flex-wrap sm:items-center bg-[var(--fin-warn-bg)] px-4 py-3 text-sm text-p-text">
      <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--fin-warn)]" />
      <div className="min-w-0 w-full flex-1 sm:w-auto">{children}</div>
      {action && <div className="max-w-full shrink-0 [&_button]:whitespace-normal">{action}</div>}
    </div>
  )
}
