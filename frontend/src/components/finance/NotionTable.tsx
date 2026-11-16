/**
 * Таблица финансиста в стиле «Договоров и актов» / «Пайплайна» (как в Notion):
 * быстрые чипы, поиск, «+ Фильтр», группировка с раскрытием, сортировка по
 * заголовку, выбор полей. Одна на все списки раздела (09.11.2026), чтобы
 * «Договоры» и списки на «Сегодня» выглядели и работали одинаково.
 * Данные приходят целиком, фильтрация — здесь же, без ожидания сервера.
 */
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Download, Search } from 'lucide-react'
import { MultiFilter } from '@/components/shared/MultiFilter'
import { EMPTY, NO_GROUP, type Filters } from '@/components/students/pipeline/viewState'
import { getErrorMessage } from '@/lib/errorMessage'
import { FinButton, InCardContext } from './ui'
import { downloadCsv } from './format'

export type QuickFilter<T> = { key: string; label: string; test: (row: T) => boolean; /** Виден только когда выбран (переход по ссылке). */ hidden?: boolean }

export interface NotionTableProps<T> {
  rows: T[] | undefined
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  rowKey: (row: T) => string
  /** Первая колонка: имя ученика, всегда видна, по нажатию открывает договор. */
  title: { field: string; text: (row: T) => string; onOpen?: (row: T) => void; /** Страница ученика в Notion — ссылка рядом с именем. */ notion?: (row: T) => string | null | undefined }
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
  /** Вкладки сверху: по умолчанию выбрана одна. false — можно включить несколько. */
  exclusiveQuick?: boolean
  /** Поля с выпадающим фильтром «МЗК: все» в строке поиска (по умолчанию — поля группировки). */
  filterFields?: string[]
  /** Итоговая строка по текущему фильтру: значения по полям («Сумма» → «12 000 000 ₸»). */
  totals?: (rows: T[]) => Partial<Record<string, ReactNode>>
  initialQuick?: string[]
  groupFields: string[]
  /** Порядок групп, если он не по алфавиту: «Месяц» — по дате, а не «Декабрь» раньше «Ноября». */
  groupSortKey?: (row: T, group: string) => string | undefined
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
  const inCard = useContext(InCardContext)
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
  const groupKey = (row: T) => props.groupSortKey?.(row, group) ?? groupOf(row)
  // Группы идут в том же направлении, что и сортировка таблицы.
  const rows = group === NO_GROUP ? filtered : [...filtered].sort((a, b) => {
    const order = groupKey(a).localeCompare(groupKey(b), 'ru', { numeric: true })
    return direction === 'desc' && props.groupSortKey?.(a, group) !== undefined ? -order : order
  })
  const counts = rows.reduce((m, r) => m.set(groupOf(r), (m.get(groupOf(r)) ?? 0) + 1), new Map<string, number>())
  const optionCounts = (field: string): { options: { value: string; count: number }[]; empty: number } => {
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

  const pad = inCard ? 'px-5' : ''
  // Вкладки как в «Общей базе»: выбран ровно один вид, рядом число строк.
  const given = props.quick ?? []
  const tabs: QuickFilter<T>[] = !given.length || given.some(q => q.key === 'all') ? given : [{ key: 'all', label: 'Все', test: () => true }, ...given]
  const isOn = (key: string) => quick.has(key) || (key === 'all' && quick.size === 0)
  const tabCount = (q: QuickFilter<T>) => all.filter(q.test).length
  const filterFields = (props.filterFields ?? props.groupFields).filter(f => !numeric.has(f) && !dates.has(f))
  const chosen = (field: string) => filters[field]?.values ?? []
  const setChosen = (field: string, list: string[]) => setFilters(old => {
    const next = { ...old }
    if (list.length) next[field] = { operator: 'is', values: list }; else delete next[field]
    return next
  })
  const hasFilters = !!search || Object.keys(filters).length > 0
  return <div className="space-y-3">
    <div className={`flex flex-wrap items-center gap-2 ${pad}`}>
      <div className="relative w-full sm:w-[260px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-p-muted2" aria-hidden="true" />
        <input aria-label="Поиск" placeholder="Имя, телефон" value={search} onChange={e => setSearch(e.target.value)}
          className="h-9 w-full rounded-ctl border border-p-line bg-p-panel pl-8 pr-2 text-sm text-p-text placeholder:text-p-muted2" />
      </div>
      {tabs.length > 0 && <ViewSelect options={tabs.filter(q => !q.hidden || quick.has(q.key)).map(q => ({ key: q.key, label: q.label, count: props.rows ? tabCount(q) : undefined }))}
        value={tabs.find(q => isOn(q.key))?.key ?? 'all'} onChange={key => setQuick(new Set([key]))} />}
      {filterFields.map(field => <MultiFilter key={field} label={field} value={chosen(field)} onChange={list => setChosen(field, list)}
        options={optionCounts(field).options.map(o => ({ value: o.value, label: o.value, count: o.count }))} />)}
      {props.extraControls}
      {hasFilters && <button type="button" className="h-9 px-2 text-xs text-p-muted underline underline-offset-2 hover:text-p-text"
        onClick={() => { setSearch(''); setFilters({}) }}>Сбросить</button>}
      <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
        {props.groupFields.length > 0 && <>
          <span className="text-xs font-semibold text-p-muted">Группировка</span>
          <div className="flex rounded-[10px] bg-p-panel2 p-[3px]">
            {[NO_GROUP, ...props.groupFields].map(f => <button key={f} type="button" aria-pressed={group === f} onClick={() => setGroup(f)}
              className={`min-h-8 rounded-lg px-2.5 text-xs font-semibold ${group === f ? 'bg-white text-p-text shadow-sm' : 'text-p-muted hover:text-p-text'}`}>{f === NO_GROUP ? 'Нет' : f}</button>)}
          </div>
        </>}
        {toggleable.length > shown.length || (props.extra ?? []).length > 0 ? <ColumnsMenu fields={toggleable} shown={shown} onChange={setVisible} /> : null}
        <FinButton size="sm" disabled={!rows.length} onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true" />Экспорт</FinButton>
      </div>
    </div>
    {props.loading && <p role="status" className={`text-sm text-p-muted ${pad}`}>Загрузка…</p>}
    {!!props.error && <p role="alert" className={`text-sm ${pad}`}>{getErrorMessage(props.error, 'Не удалось загрузить список')} {props.onRetry && <button className="underline" onClick={props.onRetry}>Повторить</button>}</p>}
    {props.rows && <p className={`text-sm text-p-muted ${pad}`}>
      {props.countLabel}: {rows.length}{rows.length !== all.length ? ` из ${all.length}` : ''}
      {props.summary && rows.length > 0 && <span className="ml-2 font-semibold text-p-text">{props.summary(rows)}</span>}
    </p>}
    {/* Один вид таблиц во всём разделе: белая карточка, серая шапка, только горизонтальные линии. */}
    {props.rows && !!rows.length && <div className={inCard ? 'overflow-x-auto border-y border-p-line bg-white' : 'overflow-x-auto rounded-xl border border-p-line bg-white'}>
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead><tr className="bg-[var(--fin-head)]">
          {fields.map(field => <th key={field} className={`h-11 whitespace-nowrap border-b border-p-line px-3 py-2 text-xs font-semibold text-p-muted ${field === title.field ? 'sticky left-0 z-20 bg-[var(--fin-head)]' : ''} ${numeric.has(field) ? 'text-right' : ''}`}>
            <button type="button" onClick={() => { setSort(field); setDirection(sort === field && direction === 'asc' ? 'desc' : 'asc') }}>{field} {sort === field ? direction === 'asc' ? '↑' : '↓' : ''}</button>
          </th>)}
          {props.action && <th className="sticky right-0 z-20 border-b border-l border-p-line bg-[var(--fin-head)] px-3 py-2"><span className="sr-only">Действие</span></th>}
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
              {fields.map(field => <td key={field} className={`h-11 whitespace-nowrap px-3 py-2 align-middle ${field === title.field ? 'sticky left-0 z-10 bg-white font-medium group-hover:bg-p-panel' : ''} ${numeric.has(field) ? 'text-right tabular-nums' : ''}`}>
                {field === title.field
                  ? (title.onOpen
                    ? <button type="button" className="underline decoration-p-line underline-offset-4 hover:decoration-p-text" onClick={() => title.onOpen!(row)}>{title.text(row)}</button>
                    : title.text(row))
                  : render(row, field)}
                {field === title.field && title.notion?.(row) && <a href={title.notion(row)!} target="_blank" rel="noreferrer"
                  className="ml-2 text-xs font-normal text-p-muted underline underline-offset-2 hover:text-p-text" title="Открыть страницу ученика в Notion">Notion ↗</a>}
              </td>)}
              {/* Кнопка действия всегда видна: колонка закреплена справа. */}
              {props.action && <td className="sticky right-0 z-10 whitespace-nowrap border-l border-p-line bg-white px-3 py-1.5 text-right align-middle group-hover:bg-p-panel">{props.action(row)}</td>}
            </tr>}
          </Fragment>
        })}</tbody>
        {props.totals && (() => {
          const t = props.totals(rows)
          return <tfoot><tr className="bg-p-panel2 font-semibold">
            {fields.map(field => <td key={field} className={`h-11 whitespace-nowrap border-t border-p-line px-3 py-2 ${field === title.field ? 'sticky left-0 z-10 bg-p-panel2' : ''} ${numeric.has(field) ? 'text-right tabular-nums' : ''}`}>
              {field === title.field ? `Итого: ${rows.length}` : t[field] ?? ''}
            </td>)}
            {props.action && <td className="border-t border-p-line" />}
          </tr></tfoot>
        })()}
      </table>
    </div>}
    {props.rows && !rows.length && <p className={`text-sm text-p-muted ${pad}`}>{props.empty ?? 'По выбранным условиям ничего нет.'}</p>}
  </div>
}

/** «Столбцы · N»: какие колонки показывать. Как в «Общей базе». */
function ColumnsMenu({ fields, shown, onChange }: { fields: string[]; shown: string[]; onChange: (list: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return <div ref={root} className="relative">
    <FinButton size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>Столбцы · {shown.length + 1}</FinButton>
    {open && <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-p-line bg-white p-3 text-sm text-p-text shadow-lg">
      <p className="mb-2 text-xs font-bold text-p-muted">Показывать столбцы</p>
      {fields.map(f => <label key={f} className="flex min-h-8 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={shown.includes(f)} onChange={() => onChange(shown.includes(f) ? shown.filter(x => x !== f) : fields.filter(x => x === f || shown.includes(x)))} />{f}
      </label>)}
    </div>}
  </div>
}

/** Вид списка («Активные», «С просрочкой», «Все») — одной выпадашкой в строке фильтров. */
function ViewSelect({ options, value, onChange }: { options: { key: string; label: string; count?: number }[]; value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  const current = options.find(o => o.key === value) ?? options[0]
  const isAll = current?.key === 'all'
  return <div ref={root} className="relative">
    <button type="button" aria-label="Показать" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
      className={`flex min-h-9 items-center gap-2 rounded-ctl border px-3 text-xs ${isAll ? 'border-p-line bg-p-panel text-p-text' : 'border-p-accent-dim bg-p-chip text-p-chip-text'}`}>
      <span>Показать: <b className="font-semibold">{current?.label}</b>{current?.count != null && <span className="ml-1 tabular-nums opacity-70">{current.count}</span>}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
    {open && <div role="listbox" aria-label="Показать" className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-p-line bg-white p-1.5 text-sm text-p-text shadow-lg">
      {options.map(o => <button key={o.key} type="button" role="option" aria-selected={o.key === current?.key} onClick={() => { onChange(o.key); setOpen(false) }}
        className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left hover:bg-p-panel2 ${o.key === current?.key ? 'font-semibold' : ''}`}>
        <Check className={`h-3.5 w-3.5 shrink-0 ${o.key === current?.key ? '' : 'invisible'}`} aria-hidden="true" />
        <span className="flex-1">{o.label}</span>{o.count != null && <span className="text-xs tabular-nums text-p-muted">{o.count}</span>}
      </button>)}
    </div>}
  </div>
}
