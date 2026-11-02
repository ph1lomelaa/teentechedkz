import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { actsApi, type ActCell, type ActsTableRow } from '@/api/acts'
import { useAuth } from '@/contexts/AuthContext'
import { PipelineToolbar, type OptionCount } from '@/components/students/pipeline/PipelineToolbar'
import { EMPTY, NO_GROUP, type Filters } from '@/components/students/pipeline/viewState'
import { StudentActsPanel } from '@/components/students/StudentActsPanel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/primitives/sheet'
import { DEGREE_LEVEL_LABELS, MENTOR_ROLE_LABELS, PIPELINE_STATUS_LABELS, type DegreeLevel, type PipelineStatus } from '@/types'
import { getErrorMessage } from '@/lib/errorMessage'
import { downloadBlob } from '@/lib/utils'
import { recordNumber } from '@/components/students/contractPresentation'

// Таблица «Договоры и акты» в виде «Пайплайна»: строка — студент, столбец —
// услуга договора. Ячейка: акт отправлен / создан, не отправлен / не создан / —.
const NAME = 'Ученик'
const BASE = ['Ответственные', 'Договор', 'Услуг', 'Закрыто']
const EXTRA = ['Статус', 'Intake', 'Degree', 'МЗК', 'Телефон']
const NUMERIC = new Set(['Услуг', 'Закрыто', 'Intake'])
const STATE_LABEL = { sent: 'Отправлен', ready: 'Создан, не отправлен', missing: 'Не создан', none: '—' } as const
const STATE_CLASS = { sent: 'bg-emerald-500/15 text-emerald-700', ready: 'bg-amber-400/20 text-amber-800', missing: 'bg-p-panel2 text-p-muted', none: '' }
const FIELDS_KEY = 'acts-table-fields'
const QUICK = [['no_contract', 'Без договора'], ['open', 'Есть незакрытые услуги'], ['unsent', 'Акт не отправлен']] as const
type Quick = typeof QUICK[number][0]
const date = (iso?: string | null) => iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('.') : ''
const statusLabel = (s: string | null) => s ? PIPELINE_STATUS_LABELS[s as PipelineStatus] ?? s : ''

function readFields(): string[] | null {
  try { const raw = localStorage.getItem(FIELDS_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}

export function ActsTable({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { user } = useAuth()
  const mentor = user?.role === 'mentor'
  const table = useQuery({ queryKey: ['acts-table'], queryFn: actsApi.table, retry: false })
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [quick, setQuick] = useState<Set<Quick>>(new Set())
  const [mine, setMine] = useState(false)
  const [group, setGroup] = useState<string>('Статус')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState(NAME)
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const services = useMemo(() => table.data?.columns ?? [], [table.data])
  const allToggleable = useMemo(() => [...BASE, ...services.map(c => c.label), ...EXTRA], [services])
  const [visible, setVisible] = useState<string[] | null>(() => readFields())
  const shown = (visible ?? [...BASE, ...services.map(c => c.label)]).filter(f => allToggleable.includes(f))
  useEffect(() => { try { if (visible) localStorage.setItem(FIELDS_KEY, JSON.stringify(visible)) } catch { /* необязательная настройка */ } }, [visible])
  const serviceKey = useMemo(() => Object.fromEntries(services.map(c => [c.label, c.key])), [services])

  const values = (row: ActsTableRow, field: string): string[] => {
    if (field === NAME) return [row.full_name]
    if (field === 'Ответственные') return row.responsibles.map(p => p.name)
    if (field === 'Договор') return row.contracts.map(c => recordNumber(c.number))
    if (field === 'Услуг') return row.services_total ? [String(row.services_total)] : []
    if (field === 'Закрыто') return row.percent == null ? [] : [String(row.percent)]
    if (field === 'Статус') return row.status ? [statusLabel(row.status)] : []
    if (field === 'Intake') return row.intake ? [String(row.intake)] : []
    if (field === 'Degree') return row.degree ? [DEGREE_LEVEL_LABELS[row.degree as DegreeLevel] ?? row.degree] : []
    if (field === 'МЗК') return row.mzk ? [row.mzk.name] : []
    if (field === 'Телефон') return row.phone ? [row.phone] : []
    const cell = row.cells[serviceKey[field]]
    return cell && cell.state !== 'none' ? [STATE_LABEL[cell.state]] : []
  }
  const matches = (row: ActsTableRow) => Object.entries(filters).every(([field, condition]) => {
    const list = values(row, field)
    if (condition.operator === 'is_empty') return !list.length
    if (condition.operator === 'is_not_empty') return list.length > 0
    if (!condition.values.length) return true
    const hit = condition.values.some(v => v === EMPTY ? !list.length : list.includes(v))
    if (condition.operator === 'is') return hit
    if (condition.operator === 'is_not') return !hit
    const contains = condition.values.some(v => list.some(x => x.toLocaleLowerCase().includes(v.toLocaleLowerCase())))
    if (condition.operator === 'contains') return contains
    if (condition.operator === 'does_not_contain') return !contains
    const limit = Number(condition.values[0])
    return list.some(x => condition.operator === 'greater' ? Number(x) > limit : Number(x) < limit)
  })
  const needle = search.trim().toLocaleLowerCase()
  const filtered = useMemo(() => (table.data?.rows ?? []).filter(row =>
    (!mine || row.mine)
    && (!needle || [row.full_name, row.phone ?? '', ...row.contracts.map(c => `${c.number ?? ''} ${c.name}`)].some(v => v.toLocaleLowerCase().includes(needle)))
    && (!quick.has('no_contract') || !row.contracts.length)
    && (!quick.has('open') || (row.services_total > row.services_closed))
    && (!quick.has('unsent') || Object.values(row.cells).some(c => c.state === 'ready'))
    && matches(row)
  ).sort((a, b) => {
    const [x, y] = [values(a, sort)[0] ?? '', values(b, sort)[0] ?? '']
    const order = NUMERIC.has(sort) ? Number(x || -1) - Number(y || -1) : x.localeCompare(y, 'ru')
    return direction === 'asc' ? order : -order
  }),
  // values/matches зависят только от перечисленного
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [table.data, mine, needle, quick, filters, sort, direction, serviceKey])
  const groupOf = (row: ActsTableRow) => group === NO_GROUP ? '' : values(row, group)[0] || 'Не заполнено'
  // Сортировка по группе устойчивая: внутри группы остаётся выбранный порядок.
  const rows = group === NO_GROUP ? filtered : [...filtered].sort((a, b) => groupOf(a).localeCompare(groupOf(b), 'ru'))
  const counts = rows.reduce((m, r) => m.set(groupOf(r), (m.get(groupOf(r)) ?? 0) + 1), new Map<string, number>())
  const optionCounts = (field: string): { options: OptionCount[]; empty: number } => {
    const tally = new Map<string, number>(); let empty = 0
    for (const row of table.data?.rows ?? []) { const list = values(row, field); if (!list.length) empty++; list.forEach(v => tally.set(v, (tally.get(v) ?? 0) + 1)) }
    return { options: [...tally].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count), empty }
  }

  const download = useMutation({ mutationFn: async ({ id, name }: { id: string; name: string }) => downloadBlob(await actsApi.pdf(id), name), retry: false })
  const contractPdf = useMutation({ mutationFn: async ({ row, id }: { row: ActsTableRow; id: string }) =>
    downloadBlob(await actsApi.contractPdf(row.student_id, id), `Договор-${row.full_name}.pdf`), retry: false })
  const selectedRow = table.data?.rows.find(r => r.student_id === selected)

  const cell = (row: ActsTableRow, field: string) => {
    if (field === 'Ответственные') return row.responsibles.length ? <div className="flex flex-wrap gap-1">{row.responsibles.map((p, i) =>
      <span key={`${p.id}-${i}`} title={MENTOR_ROLE_LABELS[p.role] ?? p.role} className="rounded-pill bg-brand/15 px-2 py-0.5 font-medium text-p-text">{p.name}</span>)}</div>
      : <span className="text-p-muted2">Не назначены</span>
    if (field === 'Договор') {
      const [first, ...rest] = row.contracts
      return first ? <button type="button" className="hover:underline" title="Скачать PDF договора" onClick={() => contractPdf.mutate({ row, id: first.id })}>
        {recordNumber(first.number)}{rest.length ? <span className="text-p-muted"> +{rest.length}</span> : null}</button> : <span className="text-p-muted2">Нет договора</span>
    }
    if (field === 'Закрыто') return row.percent == null ? <span className="text-p-muted2">—</span> : <div className="flex min-w-28 items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-p-panel2"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${row.percent}%` }} /></div>
      <span className="tabular-nums">{row.services_closed}/{row.services_total}</span></div>
    if (field in serviceKey) {
      const c: ActCell = row.cells[serviceKey[field]] ?? { state: 'none' }
      if (c.state === 'none') return <span className="text-p-muted2">—</span>
      const text = c.state === 'missing' ? 'Не создан' : `${c.state === 'sent' ? 'Отправлен' : 'Создан'} ${date(c.date)}${c.state === 'ready' ? ', не отправлен' : ''}`
      return c.act_id ? <button type="button" title="Скачать акт" className={`rounded-md px-1.5 py-0.5 font-medium hover:underline ${STATE_CLASS[c.state]}`}
        onClick={() => download.mutate({ id: c.act_id!, name: c.file_name || 'Акт.pdf' })}>{text}</button>
        : <span className={`rounded-md px-1.5 py-0.5 ${STATE_CLASS[c.state]}`}>{text}</span>
    }
    const list = values(row, field)
    return list.length ? list.join(', ') : <span className="text-p-muted2">—</span>
  }

  const fields = [NAME, ...shown]
  const error = download.error || contractPdf.error
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {!mentor && <div role="group" aria-label="Чьи студенты" className="inline-flex rounded-ctl border border-p-line p-0.5 text-sm">
        {([['all', 'Все'], ['mine', 'Мои']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mine === (key === 'mine')}
          onClick={() => setMine(key === 'mine')} className={`rounded-[6px] px-3 py-1 ${mine === (key === 'mine') ? 'bg-p-text text-p-bg' : 'text-p-muted hover:text-p-text'}`}>{label}</button>)}
      </div>}
      {QUICK.map(([key, label]) => <button key={key} type="button" aria-pressed={quick.has(key)} onClick={() => setQuick(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })}
        className={`h-8 rounded-pill border px-3 text-sm ${quick.has(key) ? 'border-p-text bg-p-chip text-p-chip-text' : 'border-dashed border-p-line text-p-muted hover:text-p-text'}`}>{label}</button>)}
    </div>
    <PipelineToolbar view="table" search={search} onSearch={setSearch} filters={filters} onFiltersChange={setFilters}
      fields={[NAME, ...allToggleable]} optionCounts={optionCounts} inputType={f => NUMERIC.has(f) ? 'number' : 'text'}
      group={group} groupFields={['Статус', 'Intake', 'Degree', 'МЗК', 'Договор']} onGroup={setGroup}
      sort={sort} direction={direction} onSort={(f, d) => { setSort(f); setDirection(d) }}
      toggleableFields={allToggleable} visibleFields={shown} onVisibleFields={setVisible}
      onReset={() => { setSearch(''); setFilters({}); setQuick(new Set()); setMine(false) }} />
    {table.isPending && <p role="status" className="text-sm text-p-muted">Загружаем договоры и акты…</p>}
    {table.error && <p role="alert" className="text-sm">{getErrorMessage(table.error, 'Не удалось загрузить таблицу')} <button className="underline" onClick={() => table.refetch()}>Повторить</button></p>}
    {error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(error, 'Не удалось скачать PDF')}</p>}
    {table.data && <p className="text-sm text-p-muted">Студентов: {rows.length}{rows.length !== table.data.rows.length ? ` из ${table.data.rows.length}` : ''}</p>}
    {table.data && !!rows.length && <div className="overflow-x-auto rounded-panel border border-p-line bg-p-bg">
      <table className="min-w-max border-collapse text-left text-xs">
        <thead><tr className="bg-p-bg">{fields.map(field => <th key={field} className={`whitespace-nowrap border-b border-r border-p-line px-3 py-2 ${field === NAME ? 'sticky left-0 z-20 bg-p-bg' : ''} ${NUMERIC.has(field) ? 'text-right' : ''}`}>
          <button type="button" onClick={() => { setSort(field); setDirection(sort === field && direction === 'asc' ? 'desc' : 'asc') }}>{field} {sort === field ? direction === 'asc' ? '↑' : '↓' : ''}</button>
        </th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const key = groupOf(row)
          const starts = group !== NO_GROUP && (index === 0 || groupOf(rows[index - 1]) !== key)
          return <Fragment key={row.student_id}>
            {starts && <tr className="bg-p-panel2"><th scope="colgroup" colSpan={fields.length} className="border-b border-p-line p-0 text-left text-xs font-semibold">
              <button type="button" aria-expanded={!collapsed.has(key)} onClick={() => setCollapsed(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })}
                className="sticky left-0 inline-flex items-center gap-2 px-3 py-2 hover:text-p-muted">
                <span aria-hidden="true" className="w-3 text-center">{collapsed.has(key) ? '+' : '−'}</span>{key} <span className="font-normal text-p-muted">· {counts.get(key) ?? 0}</span>
              </button></th></tr>}
            {!collapsed.has(key) && <tr className="group border-b border-p-line hover:bg-p-panel">
              {fields.map(field => <td key={field} className={`whitespace-nowrap border-r border-p-line px-3 py-2 ${field === NAME ? 'sticky left-0 z-10 bg-p-bg font-medium group-hover:bg-p-panel' : ''} ${NUMERIC.has(field) ? 'text-right tabular-nums' : ''}`}>
                {field === NAME ? <button type="button" className="underline decoration-p-line underline-offset-4 hover:decoration-p-text" onClick={() => onSelect(row.student_id)}>{row.full_name}</button> : cell(row, field)}
              </td>)}
            </tr>}
          </Fragment>
        })}</tbody>
      </table>
    </div>}
    {table.data && !rows.length && <p className="text-sm text-p-muted">По выбранным условиям студентов нет.</p>}
    <Sheet open={!!selected} onOpenChange={open => { if (!open) onSelect(null) }}>
      <SheetContent className="overflow-y-auto p-6 sm:!max-w-3xl">
        <SheetTitle className="pr-10 text-xl font-semibold">{selectedRow?.full_name ?? 'Студент'}</SheetTitle>
        <SheetDescription className="mt-1 text-sm text-p-muted">Договоры и акты студента</SheetDescription>
        {selected && <div className="mt-5"><StudentActsPanel key={selected} studentId={selected} /></div>}
      </SheetContent>
    </Sheet>
  </div>
}
