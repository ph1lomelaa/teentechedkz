import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Plus, X } from 'lucide-react'
import { studentsApi, type StudentExportOptions } from '@/api/students'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/primitives/dialog'
import { downloadBlob } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { useAuth } from '@/contexts/AuthContext'
import { usersApi } from '@/api/index'
import { notionApi } from '@/api/notion'
import { DEGREE_LEVEL_LABELS, PIPELINE_STATUS_LABELS } from '@/types'

const FIELD_GROUPS = [
  { title: 'Студент', keys: ['full_name', 'phone', 'email', 'city', 'degree_level'] },
  { title: 'Процесс', keys: ['intake_year', 'notion_status', 'crm_status', 'status_match', 'countries', 'programs'] },
  { title: 'Команда', keys: ['lead_mentor', 'mzk', 'mentors'] },
  { title: 'Документы и доступ', keys: ['portal_access', 'active_chat', 'notion_link', 'notion_url'] },
] as const
const LABELS: Record<string, string> = {
  full_name: 'Студент', phone: 'Телефон', email: 'Email', city: 'Город', degree_level: 'Уровень',
  intake_year: 'Год набора', notion_status: 'Статус Notion', crm_status: 'Статус CRM',
  status_match: 'Статусы совпадают', countries: 'Страны', programs: 'Программы', lead_mentor: 'Lead-Mentor',
  mzk: 'МЗК', mentors: 'Менторы', portal_access: 'Доступ к платформе', active_chat: 'Активный чат',
  notion_link: 'Связь с Notion', notion_url: 'Ссылка на Notion',
}
const FIELD_ORDER: string[] = FIELD_GROUPS.flatMap((group) => group.keys)
const PRESETS: Record<string, string[]> = {
  'Кратко': ['full_name', 'phone', 'intake_year', 'notion_status', 'lead_mentor'],
  'Для менторов': ['full_name', 'phone', 'countries', 'degree_level', 'notion_status', 'mentors'],
  'Для МЗК': ['full_name', 'phone', 'city', 'countries', 'notion_status', 'mzk', 'portal_access', 'active_chat'],
  'Сверка с Notion': ['full_name', 'notion_link', 'notion_status', 'crm_status', 'status_match', 'notion_url'],
  'Все поля': [...FIELD_ORDER],
}
const DEFAULT_COLUMNS = ['full_name', 'phone', 'notion_status', 'crm_status', 'portal_access', 'active_chat', 'mzk', 'mentors']
type Source = 'current' | 'selected' | 'all'
type ThreeWay = 'any' | 'yes' | 'no'
type ExportFormat = 'xlsx' | 'csv' | 'tsv'
interface ExportTemplate { name: string; options: Partial<ExportSettings> }
interface ExportSettings {
  dataset: StudentExportOptions['dataset']; format: ExportFormat; columns: string[]; access: ThreeWay; chat: ThreeWay
  mzk: ThreeWay; mentor: ThreeWay; notion: ThreeWay; delimiter: ';' | ',' | '\t'; bom: boolean; totalRow: boolean
  intake_years: string[]; notion_statuses: string[]; crm_statuses: string[]; degrees: string[]; countries: string[]; lead_mentors: string[]
  responsible_role: string; responsible_name: string
  split_by: 'none' | 'intake_year' | 'notion_status' | 'mzk'
  only_active_notion: boolean; only_status_mismatch: boolean
  search: string
}
interface CurrentView {
  studentIds: string[]
  snapshotIds?: string[]
  selectedStudentIds?: string[]
  selectedNames?: string[]
  labels?: string[]
  label?: string
}
const defaults: ExportSettings = { dataset: 'all', format: 'xlsx', columns: DEFAULT_COLUMNS,
  access: 'any', chat: 'any', mzk: 'any', mentor: 'any', notion: 'any', delimiter: ';', bom: true, totalRow: false,
  intake_years: [], notion_statuses: [], crm_statuses: [], degrees: [], countries: [], lead_mentors: [], responsible_role: '', responsible_name: '', split_by: 'none', only_active_notion: false, only_status_mismatch: false, search: '' }
const storageKey = (userId?: string) => `teentech:student-export:v2:${userId || 'anonymous'}`
const templatesKey = (userId?: string) => `teentech:student-export:templates:v1:${userId || 'anonymous'}`
const DATE = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
})()

function readSettings(key: string): ExportSettings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } } catch { return defaults }
}
function safeFileName(name: string) { return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Студенты' }
function TriChoice({ label, value, onChange }: { label: string; value: ThreeWay; onChange: (next: ThreeWay) => void }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-sm text-p-text">{label}</span><div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-p-panel2 p-0.5 text-xs">
    {([['yes', 'Есть'], ['no', 'Нет'], ['any', 'Неважно']] as const).map(([key, text]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)} className={`min-h-7 rounded-md px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent ${value === key ? 'bg-p-panel font-semibold text-p-text shadow-sm' : 'text-p-muted'}`}>{text}</button>)}
  </div></div>
}
function MultiChoiceField({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (values: string[]) => void }) {
  if (!options.length) return null
  return <fieldset className="min-w-0 rounded-lg border border-p-line p-2"><legend className="px-1 text-xs font-semibold text-p-muted">{label}</legend><div className="max-h-24 space-y-1 overflow-auto">{options.map((option) => <label key={option} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.includes(option)} onChange={() => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])} />{option}</label>)}</div></fieldset>
}

export function StudentExportDialog({ open, onOpenChange, currentView }: { open: boolean; onOpenChange: (open: boolean) => void; currentView?: CurrentView }) {
  const { user, can } = useAuth()
  const userStorageKey = storageKey(user?.id)
  const userTemplatesKey = templatesKey(user?.id)
  const [settings, setSettings] = useState<ExportSettings>(() => readSettings(userStorageKey))
  const [source, setSource] = useState<Source>('all')
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const columnMenuRef = useRef<HTMLDivElement>(null)
  const [activeSheet, setActiveSheet] = useState('')
  const [customTouched, setCustomTouched] = useState(false)
  const [fileName, setFileName] = useState(`Студенты_Все_${DATE}`)
  const [fileNameTouched, setFileNameTouched] = useState(false)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [templates, setTemplates] = useState<ExportTemplate[]>(() => { try { return JSON.parse(localStorage.getItem(userTemplatesKey) || '[]') } catch { return [] } })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const [showSelected, setShowSelected] = useState(false)
  const [delayReady, setDelayReady] = useState(false)

  const currentIdsKey = (currentView?.studentIds ?? []).join(',')
  const snapshotIdsKey = (currentView?.snapshotIds ?? []).join(',')
  const selectedIdsKey = (currentView?.selectedStudentIds ?? []).join(',')
  const labelsKey = (currentView?.labels ?? []).join('|')
  const hasFilters = settings.intake_years.length + settings.notion_statuses.length + settings.crm_statuses.length + settings.degrees.length + settings.countries.length + settings.lead_mentors.length + Number(settings.search.trim().length > 0) + Number(settings.dataset === 'platform_access') + Number(settings.only_active_notion || settings.dataset === 'notion_active') + Number(settings.only_status_mismatch || settings.dataset === 'status_mismatch') + Number(settings.access !== 'any') + Number(settings.chat !== 'any') + Number(settings.mzk !== 'any') + Number(settings.mentor !== 'any') > 0
  useEffect(() => {
    if (!open) return
    setSource(selectedIdsKey ? 'selected' : 'all')
    setError('')
  }, [open, selectedIdsKey])
  useEffect(() => {
    try { localStorage.setItem(userStorageKey, JSON.stringify(settings)) } catch { /* private mode */ }
  }, [settings, userStorageKey])
  useEffect(() => {
    if (!fileNameTouched) setFileName(`Студенты_${source === 'current' ? safeFileName(currentView?.label || 'Текущий вид') : source === 'selected' ? 'Выбранные' : hasFilters ? 'Отбор' : 'Вся база'}_${DATE}`)
  }, [source, currentView?.label, fileNameTouched, hasFilters])
  useEffect(() => {
    if (!pending) { setDelayReady(false); return }
    const timer = window.setTimeout(() => setDelayReady(true), 3000)
    return () => window.clearTimeout(timer)
  }, [pending])
  useEffect(() => {
    if (!columnMenuOpen) return
    const onPointerDown = (event: PointerEvent) => { if (!columnMenuRef.current?.contains(event.target as Node)) setColumnMenuOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setColumnMenuOpen(false) } }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown, true) }
  }, [columnMenuOpen])
  const sourceIds = useMemo(() => source === 'current' ? currentIdsKey.split(',').filter(Boolean) : source === 'selected' ? selectedIdsKey.split(',').filter(Boolean) : undefined, [source, currentIdsKey, selectedIdsKey])
  const sourceSnapshotIds = useMemo(() => source === 'current' ? snapshotIdsKey.split(',').filter(Boolean) : undefined, [source, snapshotIdsKey])
  const effectiveDataset = source === 'all' && settings.dataset === 'platform_access' ? 'platform_access' : 'all'
  const requestOptions = useMemo<StudentExportOptions>(() => ({
    dataset: effectiveDataset, format: settings.format, columns: settings.columns,
    only_active_notion: source === 'all' && (settings.only_active_notion || settings.dataset === 'notion_active'),
    only_status_mismatch: source === 'all' && (settings.only_status_mismatch || settings.dataset === 'status_mismatch'),
    search: source === 'all' ? settings.search : '',
    student_ids: sourceIds,
    snapshot_ids: sourceSnapshotIds,
    restrict_to_ids: source === 'current' || source === 'selected',
    portal_access: source === 'all' ? settings.access : 'any', active_chat: source === 'all' ? settings.chat : 'any', has_mzk: source === 'all' ? settings.mzk : 'any',
    has_mentor: source === 'all' ? settings.mentor : 'any', notion_link: source === 'all' ? settings.notion : 'any', split_by: settings.format === 'xlsx' ? settings.split_by : 'none',
    delimiter: settings.delimiter, bom: settings.bom,
    total_row: settings.totalRow,
    intake_years: source === 'all' ? settings.intake_years : [],
    notion_statuses: source === 'all' ? settings.notion_statuses : [],
    crm_statuses: source === 'all' ? settings.crm_statuses : [],
    degrees: source === 'all' ? settings.degrees : [],
    countries: source === 'all' ? settings.countries : [],
    lead_mentors: source === 'all' ? settings.lead_mentors : [],
    responsible_role: source === 'all' ? settings.responsible_role : undefined,
    responsible_name: source === 'all' ? settings.responsible_name : undefined,
  }), [effectiveDataset, settings, sourceIds, source, sourceSnapshotIds])
  const [debouncedOptions, setDebouncedOptions] = useState(requestOptions)
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedOptions(requestOptions), 250); return () => window.clearTimeout(timer) }, [requestOptions])
  const preview = useQuery({
    queryKey: ['student-export-preview', debouncedOptions], queryFn: () => studentsApi.previewExport(debouncedOptions),
    enabled: open && !pending, staleTime: 0,
  })
  const { data: facets } = useQuery({ queryKey: ['student-export-facets'], queryFn: studentsApi.facets, enabled: open, staleTime: 60_000 })
  const { data: notionTable } = useQuery({ queryKey: ['student-export-notion-facets'], queryFn: () => notionApi.pipelineTable(true), enabled: open && can('notion', 'manage'), staleTime: 60_000 })
  const { data: mentorOptions = [] } = useQuery({ queryKey: ['student-export-mentor-options'], queryFn: () => usersApi.list({ role: 'mentor' }), enabled: open, staleTime: 60_000 })
  const { data: mzkOptions = [] } = useQuery({ queryKey: ['student-export-mzk-options'], queryFn: () => usersApi.list({ role: 'mzk_manager' }), enabled: open, staleTime: 60_000 })
  const notionStatusOptions: string[] = [...new Set<string>((notionTable?.items ?? []).flatMap((row) => {
    const raw = row.values['Статус выплат']
    return (Array.isArray(raw) ? raw : [raw]).filter((value): value is string | number => value != null).map(String)
  }))].sort((a, b) => a.localeCompare(b, 'ru'))
  const allFilterOptions = useMemo<StudentExportOptions>(() => ({
    dataset: settings.dataset === 'platform_access' ? 'platform_access' : 'all', format: 'xlsx', columns: ['full_name'], split_by: 'none',
    only_active_notion: settings.only_active_notion || settings.dataset === 'notion_active',
    only_status_mismatch: settings.only_status_mismatch || settings.dataset === 'status_mismatch',
    portal_access: settings.dataset === 'platform_access' && settings.access === 'any' ? 'yes' : settings.access,
    active_chat: settings.chat, has_mzk: settings.mzk, has_mentor: settings.mentor, notion_link: settings.notion,
    intake_years: settings.intake_years, notion_statuses: settings.notion_statuses, crm_statuses: settings.crm_statuses,
    degrees: settings.degrees, countries: settings.countries, lead_mentors: settings.lead_mentors,
    responsible_role: settings.responsible_role || undefined, responsible_name: settings.responsible_name || undefined,
    search: settings.search,
  }), [settings])
  const [debouncedAllFilterOptions, setDebouncedAllFilterOptions] = useState(allFilterOptions)
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedAllFilterOptions(allFilterOptions), 250); return () => window.clearTimeout(timer) }, [allFilterOptions])
  const allFilterCount = useQuery({
    queryKey: ['student-export-all-count', debouncedAllFilterOptions],
    queryFn: () => studentsApi.previewExport(debouncedAllFilterOptions),
    enabled: open && source !== 'all', staleTime: 5_000,
  })
  const count = preview.data?.count ?? 0
  const selectedIds = selectedIdsKey ? selectedIdsKey.split(',') : []
  const currentChips = labelsKey ? labelsKey.split('|') : []
  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => setSettings((old) => ({ ...old, [key]: value }))
  const orderedColumns = settings.columns.filter((field) => FIELD_ORDER.includes(field))
  const preset = Object.entries(PRESETS).find(([, keys]) => keys.length === orderedColumns.length && keys.every((key) => orderedColumns.includes(key)))?.[0] ?? 'Свой'
  const applyTemplate = (template: ExportTemplate) => { setSettings({ ...defaults, ...template.options }); setSource('all'); setCustomTouched(true); setTemplatesOpen(false) }
  const persistTemplates = (next: ExportTemplate[]) => { setTemplates(next); try { localStorage.setItem(userTemplatesKey, JSON.stringify(next)) } catch { /* private mode */ } }
  const moveColumn = (index: number, delta: number) => {
    const next = [...orderedColumns]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    set('columns', next)
  }
  const exportFile = async () => {
    if (!count || preview.isFetching) return
    setPending(true); setError(''); setFallbackText('')
    try {
      const result = await studentsApi.exportAll({ ...requestOptions, filename: safeFileName(fileName), total_row: settings.totalRow })
      const finalName = safeFileName(fileName)
      if (settings.format === 'tsv') {
        const text = await result.blob.text()
        try {
          await navigator.clipboard.writeText(text)
          toast({ title: `Скопировано ${result.count ?? count} строк` })
          onOpenChange(false)
        } catch {
          setFallbackText(text)
          toast({ title: 'Выделите текст и нажмите Cmd/Ctrl+C' })
        }
      } else {
        downloadBlob(result.blob, `${finalName}.${settings.format}`)
        toast({ title: `Выгружено ${result.count ?? count} студентов`, description: `${finalName}.${settings.format}` })
        onOpenChange(false)
      }
      if (saveTemplate && templateName.trim()) persistTemplates([...templates, { name: templateName.trim(), options: settings }])
    } catch (err) { setError(getErrorMessage(err)) }
    finally { setPending(false) }
  }
  const activeFilterCount = settings.intake_years.length + Number(settings.notion_statuses.length > 0) + Number(settings.crm_statuses.length > 0) + Number(settings.degrees.length > 0) + Number(settings.countries.length > 0) + Number(settings.lead_mentors.length > 0) + Number(settings.search.trim().length > 0) + Number(settings.dataset === 'platform_access') + Number(settings.only_active_notion || settings.dataset === 'notion_active') + Number(settings.only_status_mismatch || settings.dataset === 'status_mismatch') + Number(settings.access !== 'any') + Number(settings.chat !== 'any') + Number(settings.mzk !== 'any') + Number(settings.mentor !== 'any')
  const sourceCount = count
  const currentRows = settings.split_by !== 'none' && settings.format === 'xlsx' ? preview.data?.groups?.find((group) => group.name === activeSheet)?.rows ?? preview.data?.groups?.[0]?.rows ?? [] : preview.data?.rows ?? []
  const currentSheetName = settings.split_by !== 'none' && settings.format === 'xlsx' ? preview.data?.groups?.find((group) => group.name === activeSheet)?.name ?? preview.data?.groups?.[0]?.name : undefined
  const currentSheetCount = settings.split_by !== 'none' && settings.format === 'xlsx' ? preview.data?.groups?.find((group) => group.name === activeSheet)?.count ?? preview.data?.groups?.[0]?.count ?? 0 : count
  const setFormat = (format: ExportFormat) => setSettings((old) => ({ ...old, format, split_by: format === 'xlsx' ? old.split_by : 'none' }))
  const removeColumn = (key: string) => { if (key !== 'full_name') { setCustomTouched(true); set('columns', orderedColumns.filter((item) => item !== key)) } }
  const addColumn = (key: string) => { setCustomTouched(true); set('columns', [...orderedColumns, key]) }
  const movePreviewColumn = (key: string, delta: number) => { const index = orderedColumns.indexOf(key); moveColumn(index, delta); setCustomTouched(true) }
  const selectCurrentAsFilters = () => {
    const next = { ...settings, intake_years: [...settings.intake_years], lead_mentors: [...settings.lead_mentors], countries: [...settings.countries] }
    for (const chip of currentChips) {
      const value = chip.split(':').slice(1).join(':').trim().replace(/^«|»$/g, '')
      if (/^Поиск:/i.test(chip) && value) next.search = value.replace(/^«|»$/g, '')
      else if (/^Набор:/i.test(chip) && value) next.intake_years = value.split(',').map((item) => item.trim())
      else if (/^(Lead-Mentor|Ментор заявки):/i.test(chip) && value) next.lead_mentors = [value]
      else if (/^Страна:/i.test(chip) && value && !/только основная/i.test(value)) next.countries = [value]
      else if (/^(Статус Notion|Статус выплат):/i.test(chip) && value) next.notion_statuses = [value]
      else if (/^Статус CRM:/i.test(chip) && value) next.crm_statuses = value.split(/,\s*/).map((label) => Object.entries(PIPELINE_STATUS_LABELS).find(([, title]) => title === label)?.[0] ?? label)
      else if (/^Ступень:/i.test(chip) && value) next.degrees = value.split(/,\s*/).map((label) => Object.entries(DEGREE_LEVEL_LABELS).find(([, title]) => title === label)?.[0] ?? label)
    }
    setSettings(next); setSource('all')
  }
  const renderPreview = () => {
    if (preview.isError) return <p className="p-8 text-sm text-red-700">{getErrorMessage(preview.error)}</p>
    if (count === 0 && !preview.isFetching) return <div className="grid min-h-64 place-content-center text-center text-sm text-p-muted">По этим фильтрам никого нет<button type="button" className="mt-2 underline" onClick={() => setSettings((old) => ({ ...old, dataset: 'all', only_active_notion: false, only_status_mismatch: false, access: 'any', chat: 'any', mzk: 'any', mentor: 'any', notion: 'any', intake_years: [], notion_statuses: [], crm_statuses: [], degrees: [], countries: [], lead_mentors: [], responsible_role: '', responsible_name: '', search: '' }))}>Сбросить фильтры</button></div>
    const keys = orderedColumns
    const names = currentRows
    return <div className="space-y-3">
      {settings.split_by !== 'none' && settings.format === 'xlsx' && <div className="flex flex-wrap gap-1.5">{(preview.data?.groups ?? []).map((group) => <button type="button" key={group.name} onClick={() => setActiveSheet(group.name)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${currentSheetName === group.name ? 'border-p-text bg-p-text text-p-bg' : 'border-p-line bg-p-panel text-p-muted hover:bg-p-panel2'}`}>{group.name} · {group.count}</button>)}</div>}
      <div className="max-h-[min(58vh,640px)] overflow-auto rounded-xl border border-p-line bg-p-panel">
        <table className="w-full min-w-max border-collapse text-left text-xs text-p-text"><thead className="sticky top-0 z-10"><tr><th className="sticky left-0 w-[34px] border-b border-r border-p-line bg-p-panel2 text-center text-[11px] font-medium text-p-muted2" />{keys.map((key, index) => <th key={`letter-${key}`} className="min-w-[120px] max-w-[190px] border-b border-r border-p-line bg-p-panel2 px-2 text-center text-[11px] font-medium text-p-muted2">{String.fromCharCode(65 + index)}</th>)}</tr><tr><th className="sticky left-0 w-[34px] border-b border-r border-p-line bg-p-panel2 text-center text-[11px] font-medium text-p-muted2">1</th>{keys.map((key, index) => <th key={key} className="group min-w-[120px] max-w-[190px] border-b border-r border-p-line bg-p-bg px-2 py-2 font-bold"><div className="flex items-center gap-1"><button type="button" aria-label={`Сдвинуть ${LABELS[key]} влево`} disabled={index === 0} onClick={() => movePreviewColumn(key, -1)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-p-muted2 hover:bg-p-panel2 disabled:opacity-30">‹</button><span className="min-w-0 flex-1 truncate" title={LABELS[key]}>{LABELS[key]}</span><button type="button" aria-label={`Сдвинуть ${LABELS[key]} вправо`} disabled={index === keys.length - 1} onClick={() => movePreviewColumn(key, 1)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-p-muted2 hover:bg-p-panel2 disabled:opacity-30">›</button>{key !== 'full_name' && <button type="button" aria-label={`Убрать ${LABELS[key]}`} onClick={() => removeColumn(key)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-p-muted2 hover:bg-p-panel2 hover:text-p-text">×</button>}</div></th>)}</tr></thead><tbody>{names.map((row, index) => <tr key={index} className="h-9 border-b border-p-line last:border-0"><th className="sticky left-0 w-[34px] border-r border-p-line bg-p-panel2 text-center text-[11px] font-medium text-p-muted2">{index + 2}</th>{keys.map((key) => <td key={key} title={row[LABELS[key]]} className="max-w-[190px] truncate border-r border-p-line px-2 py-2">{row[LABELS[key]] || '—'}</td>)}</tr>)}</tbody></table>
      </div>
      <p className="text-xs text-p-muted2">{currentSheetCount > names.length ? `Ещё ${currentSheetCount - names.length} строк в файле` : `${currentSheetCount} строк в файле`}</p>
      <p className="text-xs text-p-muted2">Наведите на заголовок: ‹ › двигают столбец, × убирает. Новый столбец добавляется кнопкой «+ Столбец».</p>
    </div>
  }
  const sourceOptions: { id: Source; title: string; hint: string; value: number | string; show: boolean }[] = [
    { id: 'all', title: 'Вся база', hint: hasFilters ? 'с фильтрами ниже' : 'все неархивные', value: source === 'all' ? count : allFilterCount.isFetching ? '…' : allFilterCount.data?.count ?? '…', show: true },
    { id: 'current', title: 'Текущий вид', hint: 'как в таблице сейчас', value: (currentView?.studentIds.length ?? 0) + (currentView?.snapshotIds?.length ?? 0), show: true },
    { id: 'selected', title: 'Выбранные', hint: 'отмечены галочками', value: selectedIds.length, show: selectedIds.length > 0 },
  ]
  const plural = (n: number, one: string, few: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`
  const chooseSingle = (key: 'notion_statuses' | 'lead_mentors' | 'countries', value: string) => set(key, value ? [value] : [])
  const menuGroups = FIELD_GROUPS.map((group) => ({ ...group, available: group.keys.filter((key) => !orderedColumns.includes(key)) })).filter((group) => group.available.length)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[88vh] w-[calc(100vw-32px)] max-w-[1160px] flex-col gap-0 overflow-hidden rounded-[18px] border-p-line bg-p-panel p-0 text-p-text [&>button:last-child]:hidden">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-p-line px-5 py-4 sm:px-6"><div><DialogTitle className="text-xl font-extrabold">Выгрузка студентов</DialogTitle><p className="mt-1 text-[13px] text-p-muted">Слева что и как выгрузить, справа файл таким, каким он получится</p></div><div className="relative flex shrink-0 items-center gap-2"><button type="button" className="min-h-9 px-2 text-sm font-semibold text-p-muted hover:text-p-text" onClick={() => setTemplatesOpen(!templatesOpen)}>Шаблоны ▾</button><button type="button" aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-[10px] border border-p-line hover:bg-p-panel2" onClick={() => onOpenChange(false)}><X className="h-4 w-4" /></button>{templatesOpen && <div className="absolute right-10 top-10 z-30 w-64 rounded-xl border border-p-line bg-p-panel p-1.5 shadow-xl">{templates.map((template, index) => <div key={`${template.name}-${index}`} className="flex items-center gap-1"><button type="button" className="min-h-9 flex-1 truncate rounded-lg px-2 text-left text-sm hover:bg-p-panel2" onClick={() => applyTemplate(template)}>{template.name}</button><button type="button" aria-label={`Переименовать шаблон ${template.name}`} className="rounded p-1 text-xs text-p-muted hover:text-p-text" onClick={() => { const name = window.prompt('Название шаблона', template.name); if (name?.trim()) persistTemplates(templates.map((item, i) => i === index ? { ...item, name: name.trim() } : item)) }}>✎</button><button type="button" aria-label={`Удалить шаблон ${template.name}`} className="rounded p-1 text-xs text-p-muted hover:text-red-600" onClick={() => persistTemplates(templates.filter((_, i) => i !== index))}>×</button></div>)}{templates.length === 0 && <p className="p-2 text-xs text-p-muted">Сохранённых шаблонов нет</p>}<button type="button" className="w-full border-t border-p-line p-2 text-left text-xs text-p-muted" onClick={() => { setSettings(readSettings(userStorageKey)); setTemplatesOpen(false) }}>Последняя выгрузка</button></div>}</div></header>

      <div className="grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)] overflow-hidden max-[819px]:grid-cols-1 max-[819px]:overflow-y-auto">
        <aside className="min-h-0 overflow-y-auto border-r border-p-line bg-p-bg px-4 py-5 max-[819px]:max-h-[42vh] max-[819px]:border-r-0 max-[819px]:border-b">
          <section><SectionHeading title="Кого" /><div className="space-y-1.5">{sourceOptions.filter((option) => option.show).map((option) => <button key={option.id} autoFocus={option.id === (selectedIds.length ? 'selected' : 'all')} type="button" aria-pressed={source === option.id} onClick={() => setSource(option.id)} className={`flex min-h-[58px] w-full items-center justify-between gap-3 rounded-[11px] border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent ${source === option.id ? 'border-p-text bg-p-panel' : 'border-transparent hover:bg-p-panel'}`}><span><b className="block text-sm">{option.title}</b><small className="text-xs text-p-muted2">{option.hint}</small></span><span className="text-base font-bold tabular-nums">{option.id === 'all' && preview.isFetching ? '…' : option.value}</span></button>)}</div>
            {source === 'all' && <div className="mt-3 space-y-2.5 rounded-xl border border-p-line bg-p-panel p-3"><div className="flex items-center justify-between"><b className="text-sm">Фильтры{activeFilterCount > 0 && <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-p-text px-1 text-[11px] text-p-bg">{activeFilterCount}</span>}</b>{activeFilterCount ? <button type="button" onClick={() => setSettings((old) => ({ ...old, dataset: 'all', only_active_notion: false, only_status_mismatch: false, access: 'any', chat: 'any', mzk: 'any', mentor: 'any', notion: 'any', intake_years: [], notion_statuses: [], crm_statuses: [], degrees: [], countries: [], lead_mentors: [], responsible_role: '', responsible_name: '', search: '' }))} className="text-xs text-p-accent-text underline">Сбросить</button> : <span className="text-[10px] text-p-muted2">не заданы, выгрузится вся база</span>}</div>
              <div><p className="mb-1 text-xs text-p-muted">Год набора</p><div className="flex flex-wrap gap-1">{(facets?.years ?? []).map((item) => <button key={item.value} type="button" aria-pressed={settings.intake_years.includes(item.value)} onClick={() => set('intake_years', settings.intake_years.includes(item.value) ? settings.intake_years.filter((year) => year !== item.value) : [...settings.intake_years, item.value])} className={`rounded-lg border px-2 py-1 text-xs ${settings.intake_years.includes(item.value) ? 'border-p-text bg-p-text text-p-bg' : 'border-p-line text-p-muted hover:bg-p-panel2'}`}>{item.value}</button>)}</div></div>
              <label className="block text-xs text-p-muted">Статус Notion<select value={settings.notion_statuses[0] ?? ''} onChange={(event) => chooseSingle('notion_statuses', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text"><option value="">Все</option>{notionStatusOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="block text-xs text-p-muted">Lead-Mentor<select value={settings.lead_mentors[0] ?? ''} onChange={(event) => chooseSingle('lead_mentors', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text"><option value="">Все</option>{mentorOptions.map((person) => <option key={person.id}>{person.name}</option>)}</select></label>
              <label className="block text-xs text-p-muted">Страна<select value={settings.countries[0] ?? ''} onChange={(event) => chooseSingle('countries', event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text"><option value="">Все</option>{(facets?.countries ?? []).map((item) => <option key={item.value}>{item.value}</option>)}</select></label>
              <label className="flex items-center gap-2 text-xs text-p-text"><input type="checkbox" checked={settings.only_status_mismatch || settings.dataset === 'status_mismatch'} onChange={(event) => setSettings((old) => ({ ...old, dataset: old.dataset === 'status_mismatch' ? 'all' : old.dataset, only_status_mismatch: event.target.checked }))} />Только где статусы Notion и CRM расходятся</label>
              <label className="flex items-center gap-2 text-xs text-p-text"><input type="checkbox" checked={settings.only_active_notion || settings.dataset === 'notion_active'} onChange={(event) => setSettings((old) => ({ ...old, dataset: old.dataset === 'notion_active' ? 'all' : old.dataset, only_active_notion: event.target.checked }))} />Только «Активная работа» в Notion</label>
              <div className="border-t border-p-line pt-2.5 space-y-2"><TriChoice label="Доступ к платформе" value={settings.access} onChange={(v) => set('access', v)} /><TriChoice label="Активный Telegram чат" value={settings.chat} onChange={(v) => set('chat', v)} /><TriChoice label="МЗК назначен" value={settings.mzk} onChange={(v) => set('mzk', v)} /><TriChoice label="Ментор назначен" value={settings.mentor} onChange={(v) => set('mentor', v)} /></div>
              <details><summary className="cursor-pointer text-xs font-semibold text-p-muted">Ещё фильтры</summary><div className="mt-2 space-y-2"><label className="block text-xs text-p-muted">Поиск по имени, телефону, городу<input value={settings.search} onChange={(event) => set('search', event.target.value)} placeholder="Например, Алия" className="mt-1 h-9 w-full rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text" /></label><MultiChoiceField label="Статус CRM" options={(facets?.statuses ?? []).map((item) => item.value)} value={settings.crm_statuses} onChange={(value) => set('crm_statuses', value)} /><MultiChoiceField label="Degree" options={(facets?.degrees ?? []).map((item) => item.value)} value={settings.degrees} onChange={(value) => set('degrees', value)} /><label className="block text-xs text-p-muted">Ответственный<select value={settings.responsible_role ? `${settings.responsible_role}:${settings.responsible_name}` : ''} onChange={(event) => { const [role, name] = event.target.value.split(':'); set('responsible_role', role || ''); set('responsible_name', name || '') }} className="mt-1 h-9 w-full rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text"><option value="">Все</option>{mzkOptions.map((person) => <option key={person.id} value={`mzk:${person.name}`}>МЗК · {person.name}</option>)}{mentorOptions.map((person) => <option key={person.id} value={`mentors:${person.name}`}>Ментор · {person.name}</option>)}</select></label><TriChoice label="Связь с Notion" value={settings.notion} onChange={(v) => set('notion', v)} /></div></details>
              <p className="text-[11px] text-p-muted2">Фильтры применяются вместе.</p>
            </div>}
            {source === 'current' && <div className="mt-2 flex flex-wrap gap-1">{currentChips.map((chip) => <span key={chip} className="rounded-md bg-p-panel2 px-2 py-1 text-[11px] text-p-muted">{chip}</span>)}<button type="button" className="text-xs font-semibold text-p-accent-text underline" onClick={selectCurrentAsFilters}>Изменить</button></div>}
            {source === 'selected' && <div className="mt-2 rounded-lg bg-p-panel p-2 text-xs text-p-muted">{showSelected ? <div className="max-h-24 overflow-auto">{(currentView?.selectedNames ?? selectedIds).join(', ')}</div> : `${(currentView?.selectedNames ?? selectedIds).slice(0, 2).join(', ')}${selectedIds.length > 2 ? ` и ещё ${selectedIds.length - 2}` : ''}`}<button type="button" className="ml-2 underline" onClick={() => setShowSelected(!showSelected)}>{showSelected ? 'скрыть' : 'показать всех'}</button></div>}
          </section>
          <section className="mt-5"><SectionHeading title="Формат" /><div role="group" aria-label="Формат выгрузки" className="flex rounded-[11px] bg-p-panel2 p-[3px]">{([['xlsx','Excel'],['csv','CSV'],['tsv','Скопировать']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.format === value} onClick={() => setFormat(value)} className={`min-h-8 flex-1 rounded-lg px-1.5 text-xs font-semibold ${settings.format === value ? 'bg-p-panel text-p-text shadow-sm' : 'text-p-muted'}`}>{label}</button>)}</div>
            {settings.format === 'xlsx' && <p className="mt-2 text-[11px] leading-4 text-p-muted2">Закреплённая шапка, автофильтр, телефоны текстом, лист «Параметры» с условиями выгрузки.</p>}
            {settings.format === 'csv' && <div className="mt-2 space-y-2"><label className="block text-[11px] text-p-muted2">Разделитель<select value={settings.delimiter} onChange={(event) => set('delimiter', event.target.value as ExportSettings['delimiter'])} className="mt-1 h-8 w-full rounded-lg border border-p-line bg-p-panel px-2 text-xs text-p-text"><option value=";">; Excel на русском</option><option value=",">, запятая</option><option value="\t">Tab</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.bom} onChange={(event) => set('bom', event.target.checked)} />UTF-8 с BOM</label></div>}
            {settings.format === 'tsv' && <p className="mt-2 text-[11px] text-p-muted2">Скопируется таблица с шапкой, без файла.</p>}<p className="mt-2 text-[11px] text-p-muted2">Google Sheets и PDF появятся после подключения.</p>
          </section>
          {settings.format === 'xlsx' && <section className="mt-5"><SectionHeading title="Листы" /><div role="group" aria-label="Разбиение на листы" className="flex flex-wrap gap-1 rounded-[11px] bg-p-panel2 p-1">{([['none','Один лист'],['intake_year','По году'],['notion_status','По статусу'],['mzk','По МЗК']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.split_by === value} onClick={() => { set('split_by', value); setActiveSheet('') }} className={`min-h-7 rounded-lg px-2 text-[11px] font-semibold ${settings.split_by === value ? 'bg-p-panel text-p-text shadow-sm' : 'text-p-muted'}`}>{label}</button>)}</div></section>}
        </aside>

        <main className="min-h-0 overflow-y-auto px-4 py-5 sm:px-5">
          <div className="flex items-center justify-between gap-3"><div><SectionHeading title="Файл" /><p className="text-xs text-p-muted">{preview.isFetching ? 'Считаем строки…' : `${plural(sourceCount, 'строка', 'строки', 'строк')} · ${plural(settings.columns.length, 'столбец', 'столбца', 'столбцов')}${settings.split_by !== 'none' && settings.format === 'xlsx' ? ' · по листам' : ''}`}</p></div><div ref={columnMenuRef} className="relative"><button type="button" aria-expanded={columnMenuOpen} onClick={() => setColumnMenuOpen(!columnMenuOpen)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-p-line bg-p-panel px-2.5 text-xs font-semibold hover:bg-p-panel2"><Plus className="h-3.5 w-3.5" />Столбец</button>{columnMenuOpen && <div className="absolute right-0 top-10 z-20 max-h-[min(60vh,480px)] w-[min(460px,calc(100vw-48px))] overflow-auto rounded-[14px] border border-p-line bg-p-panel p-2 shadow-xl">{menuGroups.length ? menuGroups.map((group) => <section key={group.title} className="mb-2 last:mb-0"><h4 className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-p-muted2">{group.title}</h4>{group.available.map((key) => <button key={key} type="button" onClick={() => addColumn(key)} className="block min-h-8 w-full rounded-lg px-2 text-left text-sm hover:bg-p-panel2">+ {LABELS[key]}</button>)}</section>) : <p className="p-3 text-sm text-p-muted">Все столбцы уже в файле</p>}</div>}</div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{[...Object.keys(PRESETS), ...(preset === 'Свой' || customTouched ? ['Свой'] : [])].map((name) => <button key={name} type="button" onClick={() => { if (PRESETS[name]) set('columns', PRESETS[name]); setCustomTouched(name === 'Свой') }} className={`min-h-8 rounded-full border px-3 text-xs font-semibold ${preset === name || name === 'Свой' && customTouched ? 'border-p-text bg-p-text text-p-bg' : 'border-p-line text-p-muted hover:bg-p-panel2'}`}>{name}</button>)}</div>
          <div className="mt-4">{renderPreview()}</div>
        </main>
      </div>

      <footer className="shrink-0 border-t border-p-line bg-p-panel px-4 py-3 sm:px-6">{error && <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={exportFile}>Повторить</button></div>}{delayReady && pending && <p className="mb-2 text-xs text-p-muted">Собираем {count} строк, это может занять до минуты</p>}{fallbackText && <textarea readOnly autoFocus value={fallbackText} onFocus={(event) => event.currentTarget.select()} className="mb-2 h-20 w-full rounded-lg border border-p-line bg-p-bg p-2 text-xs" aria-label="Текст для копирования" />}{saveTemplate && <label className="mb-2 block text-xs text-p-muted">Название шаблона<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="ml-2 h-8 rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text" /></label>}
        <div className="flex flex-wrap items-center gap-3"><div className="flex min-w-0 flex-wrap items-center gap-3">{settings.format === 'tsv' ? <span className="text-xs text-p-muted">Таблица вставится в Google Sheets, Excel, Notion или чат</span> : <label className="text-xs font-semibold text-p-muted">Имя файла<input value={fileName} onChange={(event) => { setFileName(event.target.value); setFileNameTouched(true) }} className="ml-2 h-9 w-[min(34vw,340px)] rounded-lg border border-p-line bg-p-bg px-2 text-sm text-p-text" /><span className="ml-1 text-p-muted2">.{settings.format}</span></label>}<label className="flex min-h-9 items-center gap-2 text-xs text-p-muted"><input type="checkbox" checked={saveTemplate} onChange={(event) => setSaveTemplate(event.target.checked)} />Сохранить как шаблон</label></div><div className="ml-auto flex gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button><Button type="button" disabled={pending || !sourceCount || preview.isFetching || !settings.columns.length} onClick={exportFile}><Download className="mr-1 h-4 w-4" />{pending ? 'Готовим файл…' : !sourceCount ? 'Нет студентов' : settings.format === 'tsv' ? `Скопировать ${plural(sourceCount, 'строку', 'строки', 'строк')}` : `Выгрузить ${plural(sourceCount, 'студент', 'студента', 'студентов')}`}</Button></div></div>
      </footer>
    </DialogContent>
  </Dialog>
}

function SectionHeading({ title }: { title: string }) {
  return <h3 className="text-[11.5px] font-bold uppercase tracking-[.12em] text-p-muted2">{title}</h3>
}
