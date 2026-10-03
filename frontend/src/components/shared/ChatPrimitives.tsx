import React, { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronDown, Search, Send, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export function UserAvatar({
  name,
  photoUrl,
  size = 'list',
  className,
}: {
  name: string
  photoUrl?: string | null
  size?: 'message' | 'header' | 'list'
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const dimensions = size === 'message' ? 'h-7 w-7' : size === 'header' ? 'h-9 w-9' : 'h-11 w-11'

  useEffect(() => setFailed(false), [photoUrl])

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full border border-w-line bg-w-panel2 text-w-muted',
        dimensions,
        className,
      )}
      aria-label={`Аватар: ${name}`}
    >
      {photoUrl && !failed ? (
        <img src={photoUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[58%] w-[58%] fill-current">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.6 20a7.4 7.4 0 0 1 14.8 0H4.6Z" />
        </svg>
      )}
    </span>
  )
}

/** Palette switch: "telegram" maps --tg-* onto the chat tokens (see index.css);
 *  "internal" keeps the brand tokens. Shape and behaviour are shared. */
export type ChatVariant = 'telegram' | 'internal'

export function ChatHeader({
  title,
  source,
  photoUrl,
  aiPending = false,
  onAi,
  variant = 'internal',
}: {
  title: string
  source: string
  photoUrl?: string | null
  aiPending?: boolean
  onAi?: () => void
  variant?: ChatVariant
}) {
  return (
    <header data-chat-variant={variant} className="flex h-14 shrink-0 items-center gap-3 border-b border-w-line bg-w-panel px-3 sm:px-4">
      <UserAvatar name={title} photoUrl={photoUrl} size="header" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-extrabold text-w-ink">{title}</div>
        <div className="mt-0.5 text-[11px] font-semibold text-w-accentText">{source}</div>
      </div>
      {onAi && (
        <button
          type="button"
          onClick={onAi}
          disabled={aiPending}
          aria-label="AI-разбор"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-w-line bg-w-panel2 px-3 text-xs font-bold text-w-accentText transition hover:border-w-accentDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent disabled:opacity-50"
        >
          <Sparkles className={cn('h-3.5 w-3.5', aiPending && 'animate-pulse')} />
          <span className={aiPending ? 'inline' : 'hidden sm:inline'}>{aiPending ? 'Анализ…' : 'AI-разбор'}</span>
        </button>
      )}
    </header>
  )
}

export function DaySeparator({ date, variant = 'internal' }: { date: string; variant?: ChatVariant }) {
  const label = new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return (
    <div data-chat-variant={variant} className="flex justify-center py-2" role="separator" aria-label={label}>
      <span className="rounded-full bg-[var(--chat-pill-bg)] px-3 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--chat-pill-text)] shadow-sm">
        {label}
      </span>
    </div>
  )
}

export type GroupFlags = { groupStart: boolean; groupEnd: boolean; startsDay: boolean }

/** Groups consecutive messages: same author on the same day, and the same
 *  side. `authorKey` must be stable per participant. */
export function groupFlags<T>(
  items: T[],
  index: number,
  authorKey: (item: T) => string,
  createdAt: (item: T) => string,
): GroupFlags {
  const current = items[index]
  const previous = items[index - 1]
  const next = items[index + 1]
  const startsDay = !previous || !sameDay(createdAt(previous), createdAt(current))
  const groupStart = startsDay || authorKey(previous) !== authorKey(current)
  const groupEnd = !next || !sameDay(createdAt(next), createdAt(current)) || authorKey(next) !== authorKey(current)
  return { groupStart, groupEnd, startsDay }
}

const AVATAR_SLOT = 'w-7 shrink-0'

export function MessageBubble({
  outgoing,
  sender,
  showSender,
  timestamp,
  groupStart = true,
  groupEnd = true,
  avatar,
  status,
  children,
  id,
  highlighted = false,
  variant = 'internal',
}: {
  outgoing: boolean
  /** Shown only when showSender (group chats, first bubble of an incoming group). */
  sender?: string | null
  showSender?: boolean
  timestamp: string
  groupStart?: boolean
  groupEnd?: boolean
  /** Rendered beside the last incoming bubble of a group; others get a spacer. */
  avatar?: React.ReactNode
  /** Delivery state for outgoing messages; omitted when the data has none. */
  status?: 'sent' | 'read'
  children: React.ReactNode
  id?: string
  highlighted?: boolean
  variant?: ChatVariant
}) {
  const time = new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const Ticks = status === 'read' ? CheckCheck : Check
  const meta = (
    <>
      {time}
      {outgoing && status && <Ticks className="ml-0.5 inline h-3 w-3 align-[-2px]" aria-label={status === 'read' ? 'Прочитано' : 'Отправлено'} />}
    </>
  )
  return (
    <div
      id={id}
      data-chat-variant={variant}
      className={cn('flex items-end gap-2', outgoing ? 'justify-end' : 'justify-start', groupStart ? 'mt-2.5 first:mt-0' : 'mt-0.5')}
    >
      {!outgoing && (groupEnd && avatar ? <span className={AVATAR_SLOT}>{avatar}</span> : <span className={AVATAR_SLOT} aria-hidden="true" />)}
      <div
        className={cn(
          'relative w-fit min-w-0 max-w-[85%] rounded-[14px] border px-3 py-1.5 text-sm shadow-[0_1px_1px_rgb(0_0_0/0.06)] sm:max-w-[65%]',
          outgoing
            ? 'border-[var(--chat-outgoing-border)] bg-[var(--chat-outgoing)] text-[var(--chat-outgoing-text)]'
            : 'border-transparent bg-[var(--chat-incoming)] text-[var(--chat-incoming-text)]',
          groupEnd && (outgoing ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'),
          highlighted && 'ring-2 ring-w-accent',
        )}
      >
        {showSender && sender && (
          <div className="mb-0.5 truncate text-[12px] font-bold text-w-accentText">{sender}</div>
        )}
        <div className="whitespace-pre-wrap break-words leading-[1.4]">
          {children}
          {/* Invisible copy reserves room so the absolute time never overlaps text. */}
          <span aria-hidden="true" className="invisible ml-2 inline-block text-[10px] tabular-nums">{meta}{outgoing && status ? '\u00a0\u00a0' : ''}</span>
        </div>
        <span className={cn('absolute bottom-1 right-2.5 text-[10px] tabular-nums', outgoing ? 'text-[var(--chat-outgoing-muted)]' : 'text-[var(--chat-incoming-time)]')}>
          {meta}
        </span>
      </div>
    </div>
  )
}

export type ParticipantOption = {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

export function SearchableParticipantSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value?: string
  options: ParticipantOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const selected = options.find((option) => option.value === value)
  const filtered = options.filter((option) => `${option.label} ${option.detail || ''}`.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-w-muted">{label}</span>
      <details ref={detailsRef} className="group relative min-w-0 flex-1">
        <summary
          className={cn(
            'flex h-8 cursor-pointer list-none items-center gap-2 rounded-ctl border border-w-line bg-w-panel px-2.5 text-xs text-w-ink transition marker:hidden hover:border-w-accentDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{selected?.label || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-w-muted transition group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 top-9 z-30 w-[min(280px,75vw)] rounded-panel border border-w-line bg-w-panel p-2 shadow-xl">
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-w-muted2" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск участника"
              className="h-8 w-full rounded-ctl border border-w-line bg-w-panel2 pl-8 pr-2 text-xs text-w-ink outline-none focus:border-w-accentDim"
            />
          </div>
          <div className="max-h-44 overflow-y-auto chat-scrollbar">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-w-muted">Ничего не найдено</div>
            ) : filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  setQuery('')
                  detailsRef.current?.removeAttribute('open')
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-ctl px-2 py-2 text-left text-xs transition hover:bg-w-panel2 disabled:opacity-40',
                  option.value === value && 'bg-w-accent/10 text-w-accentText',
                )}
              >
                <UserAvatar name={option.label} size="message" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{option.label}</span>
                  {option.detail && <span className="block truncate text-[10px] text-w-muted">{option.detail}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </details>
    </label>
  )
}

export function MessageComposer({
  value,
  placeholder,
  disabled,
  leading,
  onChange,
  onSend,
  variant = 'internal',
}: {
  value: string
  placeholder: string
  disabled?: boolean
  leading?: React.ReactNode
  onChange: (value: string) => void
  onSend: () => void
  variant?: ChatVariant
}) {
  return (
    <div data-chat-variant={variant} className="flex shrink-0 items-center gap-2 border-t border-w-line bg-w-panel p-2.5 sm:p-3">
      {leading}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && value.trim() && !disabled) {
            event.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-full border border-w-line bg-w-panel2 px-4 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim focus:ring-2 focus:ring-w-accent/20"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!value.trim() || disabled}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--chat-send-bg)] text-[var(--chat-send-text)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent focus-visible:ring-offset-2 focus-visible:ring-offset-w-panel disabled:opacity-40"
        aria-label="Отправить"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  )
}

export function sameDay(left?: string, right?: string): boolean {
  if (!left || !right) return false
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
