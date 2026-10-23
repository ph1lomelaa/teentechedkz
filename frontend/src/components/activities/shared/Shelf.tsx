import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { ExperienceKey, ShelfCell } from '@/api/activities'
import { cn } from '@/lib/utils'
import { SHELF_TYPES } from '@/lib/portfolio/dictionary'

const CELL: Record<ShelfCell['state'], string> = {
  filled: 'border-ds-good/40 bg-ds-good/[0.07]',
  in_work: 'border-ds-line bg-ds-panel2',
  empty: 'border-dashed border-ds-line bg-ds-panel',
}

function Entries({ items, mark, base, tone }: { items: ShelfCell['achievements']; mark: string; base: string; tone?: string }) {
  return <>{items.map((entry) => <li key={entry.participation_id} className={cn('flex gap-1.5 text-xs leading-snug', tone)}>
    <span aria-hidden className="shrink-0">{mark}</span>
    <Link to={`${base}/activities/participations/${entry.participation_id}`} className="min-w-0 break-words hover:underline">{entry.title}</Link>
  </li>)}</>
}

/**
 * Полка: шесть типов опыта. Заполнена — есть достижение, в работе — есть участие,
 * пусто — кнопка подбора в каталог. Один компонент у ученика и у ментора.
 * `focusTypes` помечает ячейки, которые ментор просит усилить.
 */
export function Shelf({ cells, base, pickPath, focus, focusTypes = [], wide = false }: {
  cells: ShelfCell[] | undefined
  base: '/portal' | '/workspace'
  pickPath: (key: ExperienceKey) => string
  /** Блок фокуса над сеткой (текст ментора или редактор у сотрудника). */
  focus?: ReactNode
  focusTypes?: ExperienceKey[]
  wide?: boolean
}) {
  const list = SHELF_TYPES.map((t) => cells?.find((c) => c.key === t.key) ?? { key: t.key, label: t.label, state: 'empty' as const, achievements: [], in_work: [], recommended: [] })
  const filled = list.filter((c) => c.state === 'filled').length
  return <section aria-labelledby="shelf-title" className="space-y-3 rounded-card border border-ds-line bg-ds-panel p-4">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="shelf-title" className="text-base font-bold">Полка</h2>
      <span className="text-xs text-ds-muted">{filled} из 6 заполнено</span>
    </div>
    {focus}
    <ul className={cn('grid grid-cols-2 gap-2', wide && 'sm:grid-cols-3')}>
      {list.map((cell) => {
        const short = SHELF_TYPES.find((t) => t.key === cell.key)!.short
        return <li key={cell.key} className={cn('flex min-w-0 flex-col gap-1.5 rounded-panel border p-3', CELL[cell.state])}>
          <p className="flex items-center justify-between gap-2 text-xs font-bold" title={cell.label}>
            {short}
            {focusTypes.includes(cell.key) && <span className="rounded-pill bg-ds-ink px-1.5 py-0.5 text-2xs font-bold text-ds-bg">фокус</span>}
          </p>
          <ul className="space-y-1">
            <Entries items={cell.achievements} mark="✓" base={base} tone="text-ds-good" />
            <Entries items={cell.in_work} mark="◐" base={base} />
            <Entries items={cell.recommended} mark="→" base={base} tone="text-ds-muted" />
          </ul>
          {cell.state === 'empty' && <>
            {!cell.recommended.length && <p className="text-xs text-ds-muted">Пусто</p>}
            <Link to={pickPath(cell.key)} className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-ds-ink underline-offset-4 hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden />Подобрать
            </Link>
          </>}
        </li>
      })}
    </ul>
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ds-muted" aria-hidden>
      <span><span className="text-ds-good">✓</span> заполнено</span><span>◐ в работе</span><span>пунктир: пусто</span>
    </p>
  </section>
}
