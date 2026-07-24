import { cn } from '@/lib/utils'
import { UserRound } from 'lucide-react'

const palette = ['#FFD400', '#8BD46A', '#7DD3FC', '#C4B5FD', '#FDBA74', '#F9A8D4']

function colorFor(name: string) {
  const code = Array.from(name || 'T').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return palette[code % palette.length]
}

export function Avatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const iconColor = colorFor(name)
  const iconSize = Math.max(14, size * 0.44)
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-ctl border border-w-line bg-w-panel2', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <UserRound style={{ color: iconColor }} size={iconSize} strokeWidth={2.2} />
    </span>
  )
}
