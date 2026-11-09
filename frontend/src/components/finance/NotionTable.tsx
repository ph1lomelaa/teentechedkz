/**
 * Таблица финансиста в стиле «Договоров и актов» / «Пайплайна» (как в Notion):
 * быстрые чипы, поиск, «+ Фильтр», группировка с раскрытием, сортировка по
 * заголовку, выбор полей. Одна на все списки раздела (09.11.2026), чтобы
 * «Договоры» и списки на «Сегодня» выглядели и работали одинаково.
 * Данные приходят целиком, фильтрация — здесь же, без ожидания сервера.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { PipelineToolbar, type OptionCount } from '@/components/students/pipeline/PipelineToolbar'
import { EMPTY, NO_GROUP, type Filters } from '@/components/students/pipeline/viewState'
import { getErrorMessage } from '@/lib/errorMessage'
import { FinButton } from './ui'
import { downloadCsv } from './format'

export type QuickFilter<T> = { key: string; label: string; test: (row: T) => boolean }

export interface NotionTableProps<T> {
  rows: T[] | undefined
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  rowKey: (row: T) => string
  /** Первая колонка: имя ученика, всегда видна, по нажатию открывает договор. */
  title: { field: string; text: (row: T) => string; onOpen?: (row: T) => void }
  /** Поля, видимые по умолчанию, и те, что можно включить в «Поля». */
  base: string[]
  extra?: string[]
  numeric?: string[]
  dates?: string[]
  /** Значения поля для фильтра, сортировки и группировки (числа — строкой без форматирования, даты — ISO). */
  values: (row: T, field: string) => string[]
  /** Как показать ячейку; по умолчанию — значения через запятую. */
  cell?: (row: T, field: string) => ReactNode | undefined
  /** Кнопка в конце строки («Отметить оплату»). */
  action?: (row: T) => ReactNode
  quick?: QuickFilter<T>[]
  initialQuick?: string[]
  groupFields: string[]
  defaultGroup?: string
  defaultSort?: { field: string; direction: 'asc' | 'desc' }
  searchText: (row: T) => string[]
  initialSearch?: string
  /** Ключ localStorage для набора полей. */
  storageKey: string
  countLabel: string
  /** Итог под фильтрами: «315 платежей · 383 051 412 ₸». */
  summary?: (rows: T[]) => ReactNode
  exportName?: string
  exportValue?: (row: T, field: string) => string
  /** Дополнительные элементы рядом с чипами (период, переключатель вида). */
  extraControls?: ReactNode
  empty?: string
}

const toggle = <V,>(set: Set<V>, value: V) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next }

function readFields(key: string): string[] | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}

export function NotionTable<T>(props: NotionTableProps<T>) {
  const { values, title } = props
  const numeric = useMemo(() => new Set(props.numeric ?? []), [props.numeric])
  const dates = useMemo(() => new Set(props.dates ?? []), [props.dates])
  const [search, setSearch] = useState(props.initialSearch ?? '')
  useEffect(() => { setSearch(props.initialSearch ?? '') }, [props.initialSearch])
  const [filters, setFilters] = useState<Filters>({})
  const [quick, setQuick] = useState<Set<string>>(() => new Set(props.initialQuick ?? []))
  const [group, setGroup] = useState<string>(props.defaultGroup ?? NO_GROUP)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState(props.defaultSort?.field ?? title.field)
  const [direction, setDirection] = useState<'asc' | 'desc'>(props.defaultSort?.direction ?? 'asc')
  const toggleable = [...props.base, ...(props.extra ?? [])]
  const [visible, setVisible] = useState<string[] | null>(() => readFields(props.storageKey))
  const shown = (visible ?? props.base).filter(f => toggleable.includes(f))
  useEffect(() => { try { if (visible) localStorage.setItem(props.storageKey, JSON.stringify(visible)) } catch { /* необязательная настройка */ } }, [visible, props.storageKey])

  const valuesOf = (row: T, field: string) => field === title.field ? [title.text(row)] : values(row, field)
  const matches = (row: T) => Object.entries(filters).every(([field, condition]) => {
    const list = valuesOf(row, field)
    if (condition.operator === 'is_empty') return !list.length
    if (condition.operator === 'is_not_empty') return list.length > 0
    if (!condition.values.length) return true
    const hit = condition.values.some(v => v === EMPTY ? !list.length : list.includes(v))
    if (condition.operator === 'is') return hit
    if (condition.operator === 'is_not') return !hit
    const contains = condition.values.some(v => list.some(x => x.toLocaleLowerCase().includes(v.toLocaleLowerCase())))
    if (condition.operator === 'contains') return contains
    if (condition.operator === 'does_not_contain') return !contains
    const limit = condition.values[0]
    const more = condition.operator === 'greater'
    return list.some(x => dates.has(field) ? (more ? x > limit : x < limit) : (more ? Number(x) > Number(limit) : Number(x) < Number(limit)))
  })
  const all = useMemo(() => props.rows ?? [], [props.rows])
  const needle = search.trim().toLocaleLowerCase()
  const quickTests = (props.quick ?? []).filter(q => quick.has(q.key))
  const filtered = useMemo(() => all.filter(row =>
    (!needle || props.searchText(row).some(v => v.toLocaleLowerCase().includes(needle)))
    && quickTests.every(q => q.test(row))
    && matches(row),
  ).sort((a, b) => {
    const [x, y] = [valuesOf(a, sort)[0] ?? '', valuesOf(b, sort)[0] ?? '']
    const order = numeric.has(sort) ? Number(x || -1) - Number(y || -1) : x.localeCompare(y, 'ru')
    return direction === 'asc' ? order : -order
  }),
  // valuesOf/matches/quickTests зависят только от перечисленного
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [all, needle, quick, filters, sort, direction])
  const groupOf = (row: T) => group === NO_GROUP ? '' : valuesOf(row, group)[0] || 'Не заполнено'
  const rows = group === NO_GROUP ? filtered : [...filtered].sort((a, b) => groupOf(a).localeCompare(groupOf(b), 'ru', { numeric: true }))
  const counts = rows.reduce((m, r) => m.set(groupOf(r), (m.get(groupOf(r)) ?? 0) + 1), new Map<string, number>())
  const optionCounts = (field: string): { options: OptionCount[]; empty: number } => {
    const tally = new Map<string, number>(); let empty = 0
    for (const row of all) { const list = valuesOf(row, field); if (!list.length) empty++; list.forEach(v => tally.set(v, (tally.get(v) ?? 0) + 1)) }
    return { options: [...tally].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count), empty }
  }

  const fields = [title.field, ...shown]
  const exportCsv = () => downloadCsv(`${props.exportName ?? 'список'}.csv`, fields, rows.map(r => fields.map(f =>
    f === title.field ? title.text(r) : props.exportValue?.(r, f) ?? valuesOf(r, f).join(', '))))
  const render = (row: T, field: string) => {
    const custom = props.cell?.(row, field)
    if (custom !== undefined) return custom
    const list = valuesOf(row, field)
    return list.length ? list.join(', ') : <span className="text-p-muted2">—</span>
  }
  const columns = fields.length + (props.action ? 1 : 0)

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {(props.quick ?? []).map(q => <button key={q.key} type="button" aria-pressed={quick.has(q.key)} onClick={() => setQuick(old => toggle(old, q.key))}
        className={`h-8 rounded-pill border px-3 text-sm ${quick.has(q.key) ? 'border-p-text bg-p-chip text-p-chip-text' : 'border-dashed border-p-line text-p-muted hover:text-p-text'}`}>{q.label}</button>)}
      {props.extraControls}
      <span className="ml-auto"><FinButton size="sm" disabled={!rows.length} onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true" />Экспорт</FinButton></span>
    </div>
    <PipelineToolbar view="table" search={search} onSearch={setSearch} filters={filters} onFiltersChange={setFilters}
      fields={[title.field, ...toggleable]} optionCounts={optionCounts}
      inputType={f => dates.has(f) ? 'date' : numeric.has(f) ? 'number' : 'text'}
      group={group} groupFields={props.groupFields} onGroup={setGroup}
      sort={sort} direction={direction} onSort={(f, d) => { setSort(f); setDirection(d) }}
      toggleableFields={toggleable} visibleFields={shown} onVisibleFields={setVisible}
      onReset={() => { setSearch(''); setFilters({}); setQuick(new Set()) }} />
    {props.loading && <p role="status" className="text-sm text-p-muted">Загрузка…</p>}
    {!!props.error && <p role="alert" className="text-sm">{getErrorMessage(props.error, 'Не удалось загрузить список')} {props.onRetry && <button className="underline" onClick={props.onRetry}>Повторить</button>}</p>}
    {props.rows && <p className="text-sm text-p-muted">
      {props.countLabel}: {rows.length}{rows.length !== all.length ? ` из ${all.length}` : ''}
      {props.summary && rows.length > 0 && <span className="ml-2 font-semibold text-p-text">{props.summary(rows)}</span>}
    </p>}
    {props.rows && !!rows.length && <div className="overflow-x-auto rounded-panel border border-p-line bg-p-bg">
      <table className="min-w-max border-collapse text-left text-xs">
        <thead><tr className="bg-p-bg">
          {fields.map(field => <th key={field} className={`whitespace-nowrap border-b border-r border-p-line px-3 py-2 ${field === title.field ? 'sticky left-0 z-20 bg-p-bg' : ''} ${numeric.has(field) ? 'text-right' : ''}`}>
            <button type="button" onClick={() => { setSort(field); setDirection(sort === field && direction === 'asc' ? 'desc' : 'asc') }}>{field} {sort === field ? direction === 'asc' ? '↑' : '↓' : ''}</button>
          </th>)}
          {props.action && <th className="border-b border-p-line px-3 py-2"><span className="sr-only">Действие</span></th>}
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const key = groupOf(row)
          const starts = group !== NO_GROUP && (index === 0 || groupOf(rows[index - 1]) !== key)
          return <Fragment key={props.rowKey(row)}>
            {starts && <tr className="bg-p-panel2"><th scope="colgroup" colSpan={columns} className="border-b border-p-line p-0 text-left text-xs font-semibold">
              <button type="button" aria-expanded={!collapsed.has(key)} onClick={() => setCollapsed(old => toggle(old, key))}
                className="sticky left-0 inline-flex items-center gap-2 px-3 py-2 hover:text-p-muted">
                <span aria-hidden="true" className="w-3 text-center">{collapsed.has(key) ? '+' : '−'}</span>{key} <span className="font-normal text-p-muted">· {counts.get(key) ?? 0}</span>
              </button></th></tr>}
            {!collapsed.has(key) && <tr className="group border-b border-p-line hover:bg-p-panel">
              {fields.map(field => <td key={field} className={`whitespace-nowrap border-r border-p-line px-3 py-2 align-middle ${field === title.field ? 'sticky left-0 z-10 bg-p-bg font-medium group-hover:bg-p-panel' : ''} ${numeric.has(field) ? 'text-right tabular-nums' : ''}`}>
                {field === title.field
                  ? (title.onOpen
                    ? <button type="button" className="underline decoration-p-line underline-offset-4 hover:decoration-p-text" onClick={() => title.onOpen!(row)}>{title.text(row)}</button>
                    : title.text(row))
                  : render(row, field)}
              </td>)}
              {props.action && <td className="whitespace-nowrap px-3 py-1.5 text-right align-middle">{props.action(row)}</td>}
            </tr>}
          </Fragment>
        })}</tbody>
      </table>
    </div>}
    {props.rows && !rows.length && <p className="text-sm text-p-muted">{props.empty ?? 'По выбранным условиям ничего нет.'}</p>}
  </div>
}
