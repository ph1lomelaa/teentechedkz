import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notionApi, type NotionPipelineRow } from '@/api/notion'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { PageHeader } from '@/components/ui'
import { Button } from '@/components/ui/primitives/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/primitives/sheet'
import { MENTOR_ROLE_LABELS } from '@/types'
import { StudentPeekPanel } from '@/components/students/StudentPeekPanel'
import { StudentAssignmentBar, useCanSelectStudents } from '@/components/students/StudentAssignmentBar'
import { PipelineToolbar, type OptionCount } from '@/components/students/pipeline/PipelineToolbar'
import { PipelineViewTabs } from '@/components/students/pipeline/PipelineViewTabs'
import { SyncStatusLine } from '@/components/students/pipeline/SyncStatusLine'
import {
  ASSIGNED, DEFAULT_BOARD_FIELDS, DEFAULT_GROUP, DEFAULT_SORT, EMPTY, NO_GROUP, PARAM, TITLE_FIELD,
  fieldLabel, parseFieldList, parseFilters, parseView, resolveVisibleFields, serializeFieldList, serializeFilters,
  type Filters, type PipelineView,
} from '@/components/students/pipeline/viewState'

const NOT_SET = 'Не заполнено'
const STATUS_ORDER = ['Активная работа', 'На визе', 'На возврате', 'Не оплачено', 'Пауза',
  'Перевели на другой продукт', 'Передумали', 'Пересдача IELTS', 'Подвешено',
  'Проблема', 'Пропал абитуриент', 'Работа окончена', 'Работа окончена- Поступил', 'Переподача']
const OPTION_COLORS: Record<string, string> = {
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
  gray: 'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100',
  brown: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  orange: 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
  yellow: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100',
  green: 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100',
  blue: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  purple: 'bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100',
  pink: 'bg-pink-100 text-pink-900 dark:bg-pink-900 dark:text-pink-100',
  red: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
}

function cellValues(row: NotionPipelineRow, field: string): string[] {
  if (field === ASSIGNED) return row.responsibles.map((person) => `${person.role}: ${person.name}`)
  const raw = row.values[field]
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'object') return [JSON.stringify(raw)]
  return [String(raw)]
}

function matches(row: NotionPipelineRow, filters: Filters): boolean {
  return Object.entries(filters).every(([field, condition]) => {
    const values = cellValues(row, field)
    if (condition.operator === 'is_empty') return values.length === 0
    if (condition.operator === 'is_not_empty') return values.length > 0
    if (!condition.values.length) return true
    const hit = condition.values.some((option) => option === EMPTY ? values.length === 0 : values.includes(option))
    if (condition.operator === 'is') return hit
    if (condition.operator === 'is_not') return !hit
    const contains = condition.values.some((option) => values.some((value) => value.toLocaleLowerCase().includes(option.toLocaleLowerCase())))
    if (condition.operator === 'contains') return contains
    if (condition.operator === 'does_not_contain') return !contains
    const numericThreshold = Number(condition.values[0])
    const threshold = condition.values[0] && Number.isFinite(numericThreshold) ? numericThreshold : Date.parse(condition.values[0])
    if (!Number.isFinite(threshold)) return false
    return values.some((value) => {
      const parsed = Number(value)
      const numeric = Number.isFinite(parsed) ? parsed : Date.parse(value)
      return Number.isFinite(numeric) && (condition.operator === 'greater' ? numeric > threshold : numeric < threshold)
    })
  })
}

function displayValue(row: NotionPipelineRow, field: string): string {
  return cellValues(row, field).join(', ') || '—'
}

/** Ключ группы строки: первое значение поля, пустое — «Не заполнено». */
function groupKey(row: NotionPipelineRow, field: string): string {
  return cellValues(row, field)[0] || NOT_SET
}

function readRememberedFields(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key)
    const value = raw ? JSON.parse(raw) : null
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
  } catch {
    return null
  }
}

/** Фактическое распределение из CRM — то, что видно «напротив» ученика. */
function ResponsibleChips({ row }: { row: NotionPipelineRow }) {
  if (!row.responsibles.length) return <span className="text-p-muted2">Не назначены</span>
  return <div className="flex flex-wrap gap-1">{row.responsibles.map((person, index) =>
    <span key={`${person.id ?? person.name}-${index}`} title={MENTOR_ROLE_LABELS[person.role] ?? person.role}
      className="rounded-pill bg-brand/15 px-2 py-0.5 font-medium text-p-text">{person.name || '—'}</span>
  )}</div>
}

export function NotionPipelineTable({ overview = false }: { overview?: boolean }) {
  const [params, setParams] = useSearchParams()
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const canSelectStudents = useCanSelectStudents()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notion', 'pipeline-table', overview ? 'source' : 'all'], queryFn: () => notionApi.pipelineTable(overview),
    staleTime: 60_000,
  })
  const [showReport, setShowReport] = useState(false)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const selectedRowRef = useRef<string | null>(null)
  const [resolvedStudentId, setResolvedStudentId] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  // Ученик открывается в той же правой панели, что и на CRM-доске, а не в Notion.
  const [peekStudent, setPeekStudent] = useState<{ id: string; name: string } | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [targetUserId, setTargetUserId] = useState('')
  const [collapsedIntakes, setCollapsedIntakes] = useState<Set<string>>(() => new Set())
  const toggleIntake = (intake: string) => setCollapsedIntakes((current) => {
    const next = new Set(current)
    if (next.has(intake)) next.delete(intake)
    else next.add(intake)
    return next
  })
  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['notion', 'pipeline-report'], queryFn: notionApi.pipelineReport, enabled: showReport,
  })
  const { data: syncStatus } = useQuery({
    queryKey: ['notion', 'status'], queryFn: notionApi.status,
  })
  const sync = useMutation({
    mutationFn: notionApi.run,
    onSuccess: ({ counters }) => {
      queryClient.invalidateQueries({ queryKey: ['notion'] })
      toast({ title: 'Notion синхронизирован', description: `Записей: ${counters.total} · новых: ${counters.created} · обновлено: ${counters.updated}` })
    },
    onError: (error: unknown) => {
      // Ошибка видна и в строке статуса: после неудачи бэкенд пишет её в last_run.
      queryClient.invalidateQueries({ queryKey: ['notion', 'status'] })
      toast({ title: 'Синк Notion не выполнен', description: getErrorMessage(error), variant: 'destructive' })
    },
  })
  const view: PipelineView = parseView(params)
  const boardView = view === 'board'
  const filters = useMemo(() => parseFilters(params.get(PARAM.filters)), [params])
  const search = params.get(PARAM.search) || ''
  const sort = params.get(PARAM.sort) || DEFAULT_SORT
  const direction = params.get(PARAM.dir) === 'desc' ? 'desc' : 'asc'
  const rawGroup = params.get(PARAM.group) || DEFAULT_GROUP[view]
  // На доске колонки нужны всегда: «без группировки» бывает только у таблицы.
  const group = boardView && rawGroup === NO_GROUP ? DEFAULT_GROUP.board : rawGroup

  const updateParams = useCallback((changes: Record<string, string | null>, options: { push?: boolean } = {}) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
      next.delete('nv')
      return next
    }, { replace: !options.push })
  }, [setParams])
  const updateFilters = (next: Filters) => updateParams({ [PARAM.filters]: serializeFilters(next) })
  // Смена вида — отдельная запись в истории, чтобы «Назад» возвращал прежний вид.
  // Группировка и поля у видов свои, поэтому при переключении их сбрасываем.
  const setView = (next: PipelineView) => {
    if (next !== view) updateParams({ [PARAM.view]: next, [PARAM.group]: null, [PARAM.fields]: null }, { push: true })
  }
  const onSearch = useCallback((value: string) => updateParams({ [PARAM.search]: value || null }), [updateParams])
  const resetFilters = () => updateParams({ [PARAM.filters]: null, [PARAM.search]: null })
  const columns = useMemo(() => data?.columns || [], [data])
  const fields = useMemo(() => [...columns, ASSIGNED], [columns])
  const toggleableFields = fields.filter((field) => field !== TITLE_FIELD)
  const fieldsStorageKey = `pipeline:fields:${view}:${user?.id ?? 'anon'}`
  // Что пользователь выбрал в «Полях» в этой сессии; иначе — из localStorage.
  const [rememberedByKey, setRememberedByKey] = useState<Record<string, string[]>>({})
  const remembered = rememberedByKey[fieldsStorageKey] ?? readRememberedFields(fieldsStorageKey)
  const defaultFields = boardView ? DEFAULT_BOARD_FIELDS : [ASSIGNED, ...columns.filter((field) => field !== TITLE_FIELD)]
  const visibleFields = resolveVisibleFields(parseFieldList(params.get(PARAM.fields)), remembered, defaultFields, toggleableFields)
  const setVisibleFields = (next: string[]) => {
    try { localStorage.setItem(fieldsStorageKey, JSON.stringify(next)) } catch { /* приватный режим — останется только URL */ }
    setRememberedByKey((current) => ({ ...current, [fieldsStorageKey]: next }))
    updateParams({ [PARAM.fields]: serializeFieldList(next) })
  }
  const sourceRows = useMemo(() => data?.items || [], [data])
  const selectedRow = sourceRows.find((row) => row.id === selectedRowId)
  const profileStudentId = resolvedStudentId || selectedRow?.student_id
  const profile = useQuery({
    queryKey: ['student', profileStudentId],
    queryFn: () => studentsApi.get(profileStudentId!),
    enabled: !!selectedRow && !!profileStudentId,
  })
  const linkStudent = useMutation({
    mutationFn: ({ snapshotId, studentId }: { snapshotId: string; studentId: string }) => notionApi.link(snapshotId, studentId),
    onSuccess: (snapshot, { snapshotId }) => {
      if (selectedRowRef.current === snapshotId) {
        setResolvedStudentId(snapshot.student_id || null)
        setPanelError(null)
      }
      queryClient.invalidateQueries({ queryKey: ['notion', 'pipeline-table'] })
    },
    onError: (error: unknown) => setPanelError(getErrorMessage(error)),
  })
  const openRow = (row: NotionPipelineRow) => {
    if (selectionMode) {
      toggleSelected(row)
      return
    }
    if (row.student_id) {
      setPeekStudent({ id: row.student_id, name: displayValue(row, 'е') })
      return
    }
    // Карточки CRM нет — только показываем данные Notion. Карточку отсюда НЕ
    // создаём: при несовпадении написания имени это был бы дубль рядом с
    // настоящей карточкой, где ментор, кабинет и переписка. Связывают такие
    // записи вручную в «Привязках Notion».
    selectedRowRef.current = row.snapshot_id || null
    setSelectedRowId(row.id)
    setResolvedStudentId(null)
    setPanelError(null)
  }
  const isMine = (row: NotionPipelineRow) => row.responsibles.some((person) =>
    person.id && (person.id === user?.id || (targetUserId && person.id === targetUserId)))
  // Назначать можно только тех, у кого есть карточка CRM: назначение уходит на
  // реальный аккаунт ученика, а не на строку Notion.
  const isSelectable = (row: NotionPipelineRow) => !isMine(row) && !!row.student_id
  function toggleSelected(row: NotionPipelineRow) {
    if (!isSelectable(row)) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }
  const closeSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setTargetUserId('')
  }
  const resolveSelectedStudentIds = async () => {
    const ids: string[] = []
    for (const row of sourceRows.filter((item) => selectedIds.has(item.id))) {
      if (row.student_id) ids.push(row.student_id)
    }
    return ids
  }
  const options = useMemo(() => {
    const result: Record<string, string[]> = {}
    ;[...columns, ASSIGNED].forEach((field) => {
      result[field] = [...new Set(sourceRows.flatMap((row) => cellValues(row, field)))].sort((a, b) => a.localeCompare(b, 'ru'))
    })
    return result
  }, [sourceRows, columns])
  const optionCounts = useMemo(() => {
    const cache = new Map<string, { options: OptionCount[]; empty: number }>()
    return (field: string) => {
      const cached = cache.get(field)
      if (cached) return cached
      const counts = new Map<string, number>()
      let empty = 0
      for (const row of sourceRows) {
        const values = cellValues(row, field)
        if (!values.length) empty += 1
        new Set(values).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
      }
      const result = {
        options: [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'ru', { numeric: true })),
        empty,
      }
      cache.set(field, result)
      return result
    }
  }, [sourceRows])
  // Группировать есть смысл по полям с короткими списками значений: статусы,
  // наборы, степени. Поле с сотней разных телефонов в группы не годится.
  const groupFields = useMemo(() => fields.filter((field) => field !== TITLE_FIELD &&
    (data?.option_colors?.[field] || ((options[field]?.length ?? 0) > 0 && (options[field]?.length ?? 0) <= 40))),
  [fields, data, options])
  /** Порядок групп: как опции в Notion, затем остальные значения; пустые — с краю. */
  const groupOrder = useCallback((field: string, emptyFirst: boolean) => {
    const known = [...new Set([
      ...Object.keys(data?.option_colors?.[field] || {}),
      ...(field === 'Статус выплат' && !overview ? STATUS_ORDER : []),
      ...[...(options[field] || [])].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })),
    ])].filter((value) => value !== NOT_SET)
    return emptyFirst ? [NOT_SET, ...known] : [...known, NOT_SET]
  }, [data, options, overview])
  const tableGroup = !boardView && group !== NO_GROUP ? group : null
  const tableGroupOrder = useMemo(() => tableGroup ? groupOrder(tableGroup, false) : [], [tableGroup, groupOrder])
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const rows = sourceRows.filter((row) => {
      if (!matches(row, filters)) return false
      return !query || row.responsibles.some((person) => person.name.toLocaleLowerCase().includes(query)) ||
        columns.some((field) => displayValue(row, field).toLocaleLowerCase().includes(query))
    })
    rows.sort((a, b) => {
      if (tableGroup) {
        const byGroup = tableGroupOrder.indexOf(groupKey(a, tableGroup)) - tableGroupOrder.indexOf(groupKey(b, tableGroup))
        if (byGroup) return byGroup
      }
      // trim(): у части имён в Notion в начале пробел или неразрывный пробел —
      // без него « Елгонды» вставал выше «Аблаковой». Данные не трогаем.
      const order = displayValue(a, sort).trim().localeCompare(displayValue(b, sort).trim(), 'ru', { numeric: true })
      return direction === 'desc' ? -order : order
    })
    return rows
  }, [sourceRows, filters, search, sort, direction, columns, tableGroup, tableGroupOrder])
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (tableGroup) filtered.forEach((row) => counts.set(groupKey(row, tableGroup), (counts.get(groupKey(row, tableGroup)) ?? 0) + 1))
    return counts
  }, [filtered, tableGroup])
  const selectableIds = filtered.filter(isSelectable).map((row) => row.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const boardColumns = boardView ? groupOrder(group, true) : []
  // Секции по набору, как раньше; если колонки уже по Intake — одна общая секция.
  const sectionField = group === 'Intake' ? null : 'Intake'
  const sectionOf = (row: NotionPipelineRow) => sectionField ? groupKey(row, sectionField) : 'all'
  const boardIntakes = [...new Set(filtered.map(sectionOf))]
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
  const formatted = (row: NotionPipelineRow, field: string) => {
    const raw = row.values[field]
    const meta = data?.field_meta?.[field]
    if (typeof raw === 'number') {
      if (meta?.number_format === 'percent') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(raw * 100)} %`
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(raw)
    }
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)) {
      const [year, month, day] = raw.slice(0, 10).split('-')
      return `${day}.${month}.${year}`
    }
    return displayValue(row, field)
  }
  const renderCell = (row: NotionPipelineRow, field: string) => {
    const values = cellValues(row, field)
    if (field === 'е') return <span className="flex items-center gap-2">
      {selectionMode && selectMark(row)}
      <button type="button" className="font-medium underline" onClick={() => openRow(row)}>{displayValue(row, field)}</button>
    </span>
    const colors = data?.option_colors?.[field]
    if (colors && values.length) return <div className="flex gap-1">{values.map((value, index) =>
      <span key={`${value}-${index}`} className={`rounded-pill px-2 py-0.5 ${OPTION_COLORS[colors[value]] || OPTION_COLORS.default}`}>{value}</span>
    )}</div>
    return formatted(row, field)
  }
  const selectMark = (row: NotionPipelineRow) => {
    if (isMine(row)) return <span className="shrink-0 rounded-pill border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">Уже мой</span>
    const checked = selectedIds.has(row.id)
    return <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" disabled={!isSelectable(row)} checked={checked}
      aria-label={`${checked ? 'Убрать' : 'Выбрать'} ${displayValue(row, 'е')}`}
      onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(row)} />
  }
  const fieldInputType = (field: string): 'date' | 'number' | 'text' => data?.field_meta?.[field]?.type === 'date' ? 'date' :
    data?.field_meta?.[field]?.type === 'number' || sourceRows.some((row) => typeof row.values[field] === 'number') ? 'number' : 'text'

  const recordsTotal = syncStatus?.last_run?.counters?.total ?? sourceRows.length
  const tableFields = [TITLE_FIELD, ...visibleFields]

  return <div className="space-y-4">
    <PageHeader eyebrow={overview ? 'Обзор' : 'Студенты'} title={overview ? 'Пайплайн клиентов' : 'Общая база'} className="!mb-2 sm:!mb-3"
      description={<SyncStatusLine status={syncStatus} total={recordsTotal} pending={sync.isPending}
        onSync={can('notion', 'create') ? () => sync.mutate() : undefined} />}
      action={<div className="flex flex-wrap gap-2">
        {!overview && can('assignment_overview', 'view') && <Button asChild variant="outline" size="sm"><Link to="/students/distribution">Распределение</Link></Button>}
        {!overview && can('sync', 'manage') && <Button asChild variant="outline" size="sm"><Link to="/students?inbox=1">Входящие</Link></Button>}
        {!overview && can('notion', 'manage') && <Button asChild variant="outline" size="sm"><Link to="/students?notion=1">Привязки</Link></Button>}
        {overview && canSelectStudents && (selectionMode
          ? <Button variant="outline" size="sm" onClick={closeSelection}>Отменить выбор</Button>
          : <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>Выбрать студентов</Button>)}
        <Button variant="outline" size="sm" aria-expanded={showReport} onClick={() => setShowReport((value) => !value)}>Сверка с CRM</Button>
        {can('students', 'create') && <Button asChild size="sm"><Link to="/students/new"><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Клиент</Link></Button>}
      </div>} />
    {selectionMode && <StudentAssignmentBar
      selectedCount={selectedIds.size}
      selectableCount={selectableIds.length}
      allSelected={allSelected}
      onToggleAll={() => setSelectedIds(allSelected ? new Set() : new Set(selectableIds))}
      targetUserId={targetUserId}
      onTargetChange={setTargetUserId}
      resolveStudentIds={resolveSelectedStudentIds}
      onAssigned={closeSelection}
    />}
    <PipelineViewTabs value={view} onChange={setView} />
    <PipelineToolbar
      view={view}
      search={search}
      onSearch={onSearch}
      filters={filters}
      onFiltersChange={updateFilters}
      fields={fields}
      optionCounts={optionCounts}
      inputType={fieldInputType}
      group={group}
      groupFields={groupFields}
      onGroup={(field) => updateParams({ [PARAM.group]: field === DEFAULT_GROUP[view] ? null : field })}
      sort={sort}
      direction={direction}
      onSort={(field, dir) => updateParams({ [PARAM.sort]: field === DEFAULT_SORT ? null : field, [PARAM.dir]: dir === 'asc' ? null : dir })}
      toggleableFields={toggleableFields}
      visibleFields={visibleFields}
      onVisibleFields={setVisibleFields}
      onReset={resetFilters}
    />
    {showReport && <div className="rounded-panel border border-p-line bg-p-bg p-3 text-sm">
      {reportLoading ? 'Считаем расхождения…' : report ? <>
        <p>Notion: {report.source_total} · связаны: {report.linked} (подтверждены: {report.verified}) · только CRM: {report.crm_only} · изменений: {report.changes} · требуют проверки: {report.review}</p>
        <p className="mt-1">Бибинур: Notion после фильтров Intake 2026–2028 и «Активная работа» — {report.bibinur_comparison.notion_lead_filtered}; все строки Lead-Mentor — {report.bibinur_comparison.notion_lead_all}; назначения CRM во всех ролях — {report.bibinur_comparison.platform_assigned_any_role}, в роли lead — {report.bibinur_comparison.platform_assigned_lead}.</p>
        <details className="mt-2"><summary className="cursor-pointer">Строки на проверку ({report.review})</summary>
          <div className="mt-2 max-h-64 overflow-auto space-y-1">{report.rows.filter((row) => row.issues.length).map((row) =>
            <p key={row.notion_page_id}>{row.full_name || '(без имени)'} · {row.notion_page_id}: {row.issues.join('; ')}</p>)}</div>
        </details>
        <p className="mt-1 text-p-muted">Сверка только показывает расхождения: в CRM отсюда ничего не переносится, распределение и карточки не меняются.</p>
        <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = 'notion-pipeline-report.json'; link.click(); URL.revokeObjectURL(url)
        }}>Скачать построчный отчёт</Button>
        </div>
      </> : 'Не удалось получить отчёт сверки.'}
    </div>}
    {isError && <div role="alert">Не удалось загрузить пайплайн. <Button onClick={() => refetch()}>Повторить</Button></div>}
    {isLoading && <div>Загрузка пайплайна…</div>}
    {data && filtered.length === 0 && <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-p-line px-4 py-12 text-center">
      <p className="text-sm font-semibold text-p-text">Ничего не найдено</p>
      <p className="text-sm text-p-muted">Попробуйте изменить поиск или условия фильтров.</p>
      <Button variant="outline" size="sm" onClick={resetFilters}>Сбросить фильтры</Button>
    </div>}
    {data && boardView && filtered.length > 0 && <div className="space-y-5">
      {boardIntakes.map((intake) => <section key={intake}>
        {sectionField && <h2 className="mb-2">
          <button type="button" aria-expanded={!collapsedIntakes.has(intake)} onClick={() => toggleIntake(intake)}
            className="flex w-full items-center gap-2 rounded-ctl bg-p-bg px-3 py-2 text-left text-sm font-semibold hover:bg-p-panel">
            <span aria-hidden="true" className="w-4 text-center">{collapsedIntakes.has(intake) ? '+' : '−'}</span>
            Intake {intake} · {filtered.filter((row) => sectionOf(row) === intake).length}
          </button>
        </h2>}
        {!collapsedIntakes.has(intake) && <div className="flex gap-3 overflow-x-auto pb-3">
          {boardColumns.filter((status) => filtered.some((row) =>
            sectionOf(row) === intake && groupKey(row, group) === status)).map((status) => {
            const cards = filtered.filter((row) => sectionOf(row) === intake && groupKey(row, group) === status)
            const color = data.option_colors?.[group]?.[status] || 'default'
            return <div key={status} className="w-64 flex-none rounded-card border border-p-line bg-p-bg p-2">
              <div className={`mb-2 rounded-panel px-3 py-2 text-sm font-semibold ${OPTION_COLORS[color] || OPTION_COLORS.default}`}>{status} · {cards.length}</div>
              <div className="space-y-2">{cards.map((row) => <div key={row.id} role="button" tabIndex={0} onClick={() => openRow(row)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRow(row) } }}
                className={`block w-full cursor-pointer rounded-panel border bg-p-panel p-3 text-left text-xs shadow-sm hover:border-p-accent ${selectedIds.has(row.id) ? 'border-brand bg-brand/10' : 'border-p-line'}`}>
                <div className="mb-2 flex items-start gap-2 font-semibold">{selectionMode && selectMark(row)}<span className="min-w-0 flex-1">{displayValue(row, 'е')}</span></div>
                {visibleFields.filter((field) => field !== ASSIGNED).map((field) => cellValues(row, field).length > 0 &&
                  <div key={field} className="mt-1 flex flex-wrap gap-1">
                    {overview && <span className="text-p-muted">{fieldLabel(field)}:</span>}{renderCell(row, field)}
                  </div>)}
                {visibleFields.includes(ASSIGNED) && <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-p-line pt-2">
                  <span className="text-p-muted">Ответственные:</span><ResponsibleChips row={row} />
                </div>}
                {row.source === 'crm' && <div className="mt-2 text-p-muted">Без страницы Notion</div>}
              </div>)}</div>
            </div>
          })}
        </div>}
      </section>)}
    </div>}
    {data && !boardView && filtered.length > 0 && <div className="overflow-x-auto rounded-panel border border-p-line">
      <table className="min-w-max border-collapse text-left text-xs">
        <thead><tr className="bg-p-bg">{tableFields.map((field) => <th key={field} className="whitespace-nowrap border-b border-r border-p-line px-3 py-2">
          {field === ASSIGNED ? fieldLabel(field) : <button type="button" onClick={() => updateParams({ [PARAM.sort]: field, [PARAM.dir]: sort === field && direction === 'asc' ? 'desc' : null })}>
            {fieldLabel(field)} {sort === field ? direction === 'asc' ? '↑' : '↓' : ''}
          </button>}
        </th>)}{!overview && <th className="px-3 py-2">Источник</th>}</tr></thead>
        <tbody>{filtered.map((row, index) => {
          const key = tableGroup ? groupKey(row, tableGroup) : null
          const startsGroup = key !== null && (index === 0 || groupKey(filtered[index - 1], tableGroup!) !== key)
          const color = tableGroup ? data.option_colors?.[tableGroup]?.[key!] : undefined
          return <Fragment key={row.id}>
            {startsGroup && <tr className="bg-p-panel2">
              <th scope="colgroup" colSpan={tableFields.length + (overview ? 0 : 1)} className="border-b border-p-line px-3 py-2 text-left text-xs font-semibold text-p-text">
                <span className="text-p-muted">{fieldLabel(tableGroup!)}:</span>{' '}
                <span className={color ? `rounded-pill px-2 py-0.5 ${OPTION_COLORS[color] || OPTION_COLORS.default}` : ''}>{key}</span>
                <span className="ml-2 font-normal text-p-muted">{groupCounts.get(key!) ?? 0}</span>
              </th>
            </tr>}
            <tr className={`border-b border-p-line hover:bg-p-bg ${selectedIds.has(row.id) ? 'bg-brand/10' : ''}`}>
              {tableFields.map((field) => <td key={field} className="max-w-64 truncate whitespace-nowrap border-r border-p-line px-3 py-2" title={field === ASSIGNED ? undefined : formatted(row, field)}>
                {field === ASSIGNED ? <ResponsibleChips row={row} /> : renderCell(row, field)}
              </td>)}
              {!overview && <td className="px-3 py-2">{row.source === 'crm' ? 'Без страницы Notion' : row.link_status === 'linked' ? 'Связано с карточкой' : 'Карточка при открытии'}</td>}
            </tr>
          </Fragment>
        })}</tbody>
      </table>
    </div>}
    {peekStudent && <StudentPeekPanel studentId={peekStudent.id} fallbackName={peekStudent.name} onClose={() => setPeekStudent(null)} />}
    <Sheet open={!!selectedRow} onOpenChange={(open) => { if (!open) { selectedRowRef.current = null; setSelectedRowId(null); setResolvedStudentId(null) } }}>
      <SheetContent className="overflow-y-auto p-6">
        <SheetTitle className="pr-10 text-xl font-semibold">{selectedRow ? displayValue(selectedRow, 'е') : 'Студент'}</SheetTitle>
        <SheetDescription className="mt-1 text-sm text-p-muted">Данные Notion и рабочая карточка студента</SheetDescription>
        {selectedRow && <div className="mt-6 space-y-5 text-sm">
          {profileStudentId ? <div className="rounded border border-p-line bg-p-bg p-4">
            {profile.isLoading && <p>Загружаем рабочую карточку…</p>}
            {profile.isError && <p role="alert">Не удалось открыть рабочую карточку: {getErrorMessage(profile.error)}</p>}
            {profile.data && <div className="space-y-3">
              <p className="font-semibold">Рабочая карточка</p>
              <p>{profile.data.full_name}</p>
              <p className="text-p-muted">Ответственные: {profile.data.mentor_assignments?.filter((assignment) => assignment.is_active !== false).map((assignment) => assignment.mentor_name || assignment.role).join(', ') || 'не назначены'}</p>
              <p className="text-p-muted">Конспекты: {profile.data.notes?.length ?? 0} · Личный кабинет: {profile.data.user_id ? 'доступ открыт' : 'доступ не открыт'}</p>
              <Link to={`/students/${profileStudentId}`} className="inline-flex rounded bg-p-accent px-3 py-2 font-semibold text-black hover:brightness-95">Открыть карточку студента</Link>
              {(profile.data.notes || []).slice(0, 3).map((note) => <div key={note.id} className="border-t border-p-line pt-2">
                <Link to={`/notes/${note.id}`} className="font-medium hover:underline">{note.title || 'Конспект'}</Link>
              </div>)}
            </div>}
          </div> : <div className="rounded border border-p-line bg-p-bg p-4 space-y-3">
            {panelError && <p role="alert" className="text-red-700">{panelError}</p>}
            {selectedRow.suggested_student_id && <div className="space-y-2">
              <p>Есть похожая карточка: {selectedRow.suggested_student_name || 'студент'}.</p>
              {can('students', 'manage') && <Button type="button" variant="outline" disabled={linkStudent.isPending || !selectedRow.snapshot_id} onClick={() =>
                linkStudent.mutate({ snapshotId: selectedRow.snapshot_id!, studentId: selectedRow.suggested_student_id! })
              }>Привязать существующую карточку</Button>}
            </div>}
            {!selectedRow.suggested_student_id && !panelError &&
              <p>Эта запись Notion не связана с карточкой CRM. Связать её можно вручную в «Общая база → Notion».</p>}
          </div>}
          <div className="space-y-2 rounded border border-p-line p-4">
            <p className="font-semibold">Данные из Notion</p>
            {['Intake', 'Статус выплат', 'Degree', 'Lead-Mentor', 'Mentors', 'МЗК', 'Main country', 'Other countries', 'Номер тел'].map((field) =>
              <p key={field}><span className="text-p-muted">{field}:</span> {displayValue(selectedRow, field)}</p>)}
            {selectedRow.notion_url && <a href={selectedRow.notion_url} target="_blank" rel="noreferrer" className="inline-block font-medium underline">Открыть страницу в Notion</a>}
          </div>
        </div>}
      </SheetContent>
    </Sheet>
  </div>
}
