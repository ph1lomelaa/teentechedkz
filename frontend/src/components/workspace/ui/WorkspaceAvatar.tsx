import { cn } from '@/lib/utils'

const palette = ['#FFD400', '#8BD46A', '#7DD3FC', '#C4B5FD', '#FDBA74', '#F9A8D4']

function colorFor(name: string) {
  const code = Array.from(name || 'T').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return palette[code % palette.length]
}

export function WorkspaceAvatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const initial = (name || 'T').trim().slice(0, 1).toUpperCase()
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-[12px] font-display font-black text-black', className)}
      style={{ width: size, height: size, backgroundColor: colorFor(name), fontSize: Math.max(12, size * 0.34) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
