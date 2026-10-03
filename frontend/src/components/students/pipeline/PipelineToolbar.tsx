import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowUpDown, Check, ChevronDown, GripVertical, Layers, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover'
import { Switch } from '@/components/ui/primitives/switch'
import {
  EMPTY, NO_GROUP, OPERATORS, OPERATOR_LABELS, QUICK_FILTERS, SEARCH_DEBOUNCE_MS,
  fieldLabel, filterChipLabel, type Condition, type Filters, type PipelineView,
} from './viewState'

export type OptionCount = { value: string; count: number }

const isUnset = (condition: Condition) =>
  condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && condition.values.length === 0

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
/** Тихая текстовая кнопка справа: на узком экране остаётся только иконка. */
const QUIET = `inline-flex h-8 items-center gap-1.5 rounded-ctl px-2 text-sm text-p-muted transition-colors hover:bg-p-panel2 hover:text-p-text ${FOCUS}`
const CHIP_ACTIVE = `inline-flex h-8 max-w-full items-center rounded-pill bg-p-chip text-sm font-medium text-p-chip-text ${FOCUS}`
const CHIP_DASHED = `inline-flex h-8 items-center gap-1 rounded-pill border border-dashed border-p-line px-3 text-sm text-p-muted transition-colors hover:border-p-muted hover:text-p-text ${FOCUS}`
const SEARCH_INPUT = 'h-8 w-full rounded-ctl border border-p-line bg-p-panel px-2 text-sm text-p-text placeholder:text-p-muted2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface PipelineToolbarProps {
  view: PipelineView
  search: string
  onSearch: (value: string) => void
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  /** Все поля, по которым можно фильтровать/сортировать (включая служебные). */
  fields: string[]
  optionCounts: (field: string) => { options: OptionCount[]; empty: number }
  inputType: (field: string) => 'text' | 'number' | 'date'
  group: string
  groupFields: string[]
  onGroup: (field: string) => void
  sort: string
  direction: 'asc' | 'desc'
  onSort: (field: string, direction: 'asc' | 'desc') => void
  /** Поля, которые можно скрывать (без заголовка). */
  toggleableFields: string[]
  visibleFields: string[]
  onVisibleFields: (fields: string[]) => void
  onReset: () => void
}

export function PipelineToolbar(props: PipelineToolbarProps) {
  const { filters, onFiltersChange } = props
  // Чип, у которого открыт поповер. Нужен, чтобы «+ Фильтр» сразу раскрывал
  // выбор значения у только что добавленного поля.
  const [openChip, setOpenChip] = useState<string | null>(null)
  const active = Object.keys(filters)
  const quickInactive = QUICK_FILTERS.filter((field) => props.fields.includes(field) && !filters[field])
  const hasFilters = active.length > 0 || props.search.length > 0

  const setCondition = (field: string, condition: Condition) => onFiltersChange({ ...filters, [field]: condition })
  const removeFilter = (field: string) => {
    const next = { ...filters }
    delete next[field]
    onFiltersChange(next)
    if (openChip === field) setOpenChip(null)
  }
  const addFilter = (field: string) => {
    if (!filters[field]) setCondition(field, { operator: 'is', values: [] })
    setOpenChip(field)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox value={props.search} onChange={props.onSearch} />

      {active.map((field) => (
        <ActiveFilterChip
          key={field}
          field={field}
          condition={filters[field]}
          open={openChip === field}
          onOpenChange={(open) => {
            // Закрыли, ничего не выбрав, — пустой фильтр не оставляем висеть.
            if (!open && isUnset(filters[field])) removeFilter(field)
            else setOpenChip(open ? field : null)
          }}
          onChange={(condition) => setCondition(field, condition)}
          onRemove={() => removeFilter(field)}
          counts={props.optionCounts(field)}
          inputType={props.inputType(field)}
        />
      ))}

      {quickInactive.map((field) => (
        <Popover key={field} open={openChip === field} onOpenChange={(open) => {
          if (open) addFilter(field)
          else setOpenChip(null)
        }}>
          <PopoverTrigger className={CHIP_DASHED}>
            {fieldLabel(field)}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </PopoverTrigger>
        </Popover>
      ))}

      <AddFilterButton fields={props.fields.filter((field) => !filters[field])} onPick={addFilter} />

      {hasFilters && (
        <button type="button" onClick={props.onReset} className={`h-8 rounded-ctl px-2 text-sm font-medium text-p-text underline underline-offset-4 hover:text-p-muted ${FOCUS}`}>
          Сбросить
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <GroupButton view={props.view} group={props.group} fields={props.groupFields} onGroup={props.onGroup} />
        <SortButton fields={props.fields} sort={props.sort} direction={props.direction} onSort={props.onSort} />
        <FieldsButton fields={props.toggleableFields} visible={props.visibleFields} onChange={props.onVisibleFields} />
      </div>
    </div>
  )
}

/** Поиск с задержкой: URL обновляется, когда пользователь перестал печатать. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  // Сброс снаружи («Сбросить», «Назад» в браузере) должен попасть в поле.
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (draft === value) return
    const timer = window.setTimeout(() => onChange(draft), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, value, onChange])
  return (
    <label className="relative block w-full sm:w-56">
      <span className="sr-only">Поиск по имени и телефону</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted" aria-hidden="true" />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Имя, телефон"
        className={cn(SEARCH_INPUT, 'pl-8')}
      />
    </label>
  )
}

function ActiveFilterChip({ field, condition, open, onOpenChange, onChange, onRemove, counts, inputType }: {
  field: string
  condition: Condition
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (condition: Condition) => void
  onRemove: () => void
  counts: { options: OptionCount[]; empty: number }
  inputType: 'text' | 'number' | 'date'
}) {
  const label = filterChipLabel(field, condition)
  return (
    <span className={cn(CHIP_ACTIVE, 'pl-3 pr-1')}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger className={`min-w-0 truncate rounded-pill ${FOCUS}`} title={label}>{label}</PopoverTrigger>
        <PopoverContent className="w-72 p-0">
          <ConditionEditor field={field} condition={condition} onChange={onChange} counts={counts} inputType={inputType} />
        </PopoverContent>
      </Popover>
      <button type="button" onClick={onRemove} aria-label={`Убрать фильтр ${fieldLabel(field)}`}
        className={`ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-p-chip-text/15 ${FOCUS}`}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}

function ConditionEditor({ field, condition, onChange, counts, inputType }: {
  field: string
  condition: Condition
  onChange: (condition: Condition) => void
  counts: { options: OptionCount[]; empty: number }
  inputType: 'text' | 'number' | 'date'
}) {
  const [query, setQuery] = useState('')
  const byValues = condition.operator === 'is' || condition.operator === 'is_not'
  const byInput = ['greater', 'less', 'contains', 'does_not_contain'].includes(condition.operator)
  const list = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const all = [{ value: EMPTY, count: counts.empty }, ...counts.options]
    return needle ? all.filter((item) => (item.value === EMPTY ? 'не заполнено' : item.value).toLocaleLowerCase().includes(needle)) : all
  }, [counts, query])
  const toggle = (value: string) => onChange({
    ...condition,
    values: condition.values.includes(value) ? condition.values.filter((item) => item !== value) : [...condition.values, value],
  })
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-p-line px-3 py-2">
        <span className="min-w-0 truncate text-xs font-semibold text-p-text">{fieldLabel(field)}</span>
        <select
          aria-label={`Условие для ${fieldLabel(field)}`}
          value={condition.operator}
          onChange={(event) => onChange({ operator: event.target.value as Condition['operator'], values: [] })}
          className={`ml-auto h-7 rounded-ctl border border-p-line bg-p-panel px-1 text-xs text-p-text ${FOCUS}`}
        >
          {OPERATORS.map((operator) => <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>)}
        </select>
      </div>
      {byInput && (
        <div className="p-2">
          <input
            aria-label={`Значение для ${fieldLabel(field)}`}
            autoFocus
            type={['contains', 'does_not_contain'].includes(condition.operator) ? 'text' : inputType}
            value={condition.values[0] || ''}
            onChange={(event) => onChange({ ...condition, values: event.target.value ? [event.target.value] : [] })}
            className={SEARCH_INPUT}
          />
        </div>
      )}
      {byValues && (
        <>
          <div className="p-2">
            <input aria-label="Найти значение" autoFocus placeholder="Найти значение" value={query}
              onChange={(event) => setQuery(event.target.value)} className={SEARCH_INPUT} />
          </div>
          <ul className="max-h-64 overflow-y-auto px-1 pb-1" aria-label={`Значения ${fieldLabel(field)}`}>
            {list.map((item) => {
              const checked = condition.values.includes(item.value)
              return (
                <li key={item.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 hover:bg-p-panel2">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={checked} onChange={() => toggle(item.value)} />
                    <span className={cn('min-w-0 flex-1 truncate', item.value === EMPTY && 'text-p-muted')}>
                      {item.value === EMPTY ? 'Не заполнено' : item.value}
                    </span>
                    <span className="text-xs tabular-nums text-p-muted">{item.count}</span>
                  </label>
                </li>
              )
            })}
            {list.length === 0 && <li className="px-2 py-2 text-xs text-p-muted">Нет совпадений</li>}
          </ul>
        </>
      )}
    </div>
  )
}

/** Список полей с поиском — общий для «+ Фильтр», группировки и сортировки. */
function FieldPicker({ fields, onPick, selected, placeholder, extra }: {
  fields: string[]
  onPick: (field: string) => void
  selected?: string
  placeholder: string
  extra?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const list = needle ? fields.filter((field) => fieldLabel(field).toLocaleLowerCase().includes(needle)) : fields
  return (
    <div>
      <input aria-label={placeholder} autoFocus placeholder={placeholder} value={query}
        onChange={(event) => setQuery(event.target.value)} className={SEARCH_INPUT} />
      {extra}
      <ul className="mt-1 max-h-72 overflow-y-auto">
        {list.map((field) => (
          <li key={field}>
            <button type="button" onClick={() => onPick(field)}
              className={`flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left hover:bg-p-panel2 ${FOCUS}`}>
              <span className="min-w-0 flex-1 truncate">{fieldLabel(field)}</span>
              {selected === field && <Check className="h-4 w-4 text-p-text" aria-label="выбрано" />}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-2 text-xs text-p-muted">Поле не найдено</li>}
      </ul>
    </div>
  )
}

function AddFilterButton({ fields, onPick }: { fields: string[]; onPick: (field: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={`inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-sm text-p-muted hover:bg-p-panel2 hover:text-p-text ${FOCUS}`}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Фильтр
      </PopoverTrigger>
      <PopoverContent>
        <FieldPicker fields={fields} placeholder="Поле Notion" onPick={(field) => { setOpen(false); onPick(field) }} />
      </PopoverContent>
    </Popover>
  )
}

function GroupButton({ view, group, fields, onGroup }: {
  view: PipelineView
  group: string
  fields: string[]
  onGroup: (field: string) => void
}) {
  const [open, setOpen] = useState(false)
  const label = group === 'Статус выплат' ? 'По статусу' : group === NO_GROUP ? 'Без группы' : `По: ${fieldLabel(group)}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={QUIET} aria-label={`Группировка: ${label}`}>
        <Layers className="h-4 w-4" aria-hidden="true" />
        <span className="hidden md:inline">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end">
        <p className="px-1 pb-2 text-xs font-semibold text-p-muted">{view === 'board' ? 'Колонки доски' : 'Группы таблицы'}</p>
        <FieldPicker
          fields={fields}
          selected={group}
          placeholder="Группировать по…"
          onPick={(field) => { setOpen(false); onGroup(field) }}
          extra={view === 'table' && (
            <button type="button" onClick={() => { setOpen(false); onGroup(NO_GROUP) }}
              className={`mt-1 flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-p-muted hover:bg-p-panel2 ${FOCUS}`}>
              <span className="flex-1">Без группировки</span>
              {group === NO_GROUP && <Check className="h-4 w-4 text-p-text" aria-label="выбрано" />}
            </button>
          )}
        />
      </PopoverContent>
    </Popover>
  )
}

function SortButton({ fields, sort, direction, onSort }: {
  fields: string[]
  sort: string
  direction: 'asc' | 'desc'
  onSort: (field: string, direction: 'asc' | 'desc') => void
}) {
  const [open, setOpen] = useState(false)
  const label = fieldLabel(sort)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={QUIET} aria-label={`Сортировка: ${label}, ${direction === 'asc' ? 'по возрастанию' : 'по убыванию'}`}>
        <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
        <span className="hidden md:inline">{label} {direction === 'asc' ? '↑' : '↓'}</span>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div role="radiogroup" aria-label="Направление" className="mb-2 grid grid-cols-2 gap-1 rounded-ctl bg-p-panel2 p-0.5">
          {(['asc', 'desc'] as const).map((dir) => (
            <button key={dir} type="button" role="radio" aria-checked={direction === dir} onClick={() => onSort(sort, dir)}
              className={cn(`rounded-ctl px-2 py-1 text-xs ${FOCUS}`, direction === dir ? 'bg-p-panel font-semibold text-p-text shadow-sm' : 'text-p-muted hover:text-p-text')}>
              {dir === 'asc' ? 'По возрастанию' : 'По убыванию'}
            </button>
          ))}
        </div>
        <FieldPicker fields={fields} selected={sort} placeholder="Сортировать по…" onPick={(field) => { setOpen(false); onSort(field, direction) }} />
      </PopoverContent>
    </Popover>
  )
}

/** Видимость и порядок полей — как Property visibility в Notion. */
function FieldsButton({ fields, visible, onChange }: {
  fields: string[]
  visible: string[]
  onChange: (fields: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const hidden = fields.filter((field) => !visible.includes(field))
  const needle = query.trim().toLocaleLowerCase()
  const match = (field: string) => !needle || fieldLabel(field).toLocaleLowerCase().includes(needle)
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onChange(arrayMove(visible, visible.indexOf(String(active.id)), visible.indexOf(String(over.id))))
  }
  return (
    <Popover>
      <PopoverTrigger className={QUIET} aria-label={`Поля: показано ${visible.length}`}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className="hidden md:inline">Поля {visible.length}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-p-line p-2">
          <input aria-label="Найти поле" placeholder="Найти поле" value={query} onChange={(event) => setQuery(event.target.value)} className={SEARCH_INPUT} />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          <SectionTitle action={visible.length > 0 ? { label: 'Скрыть все', onClick: () => onChange([]) } : undefined}>Видимые</SectionTitle>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible} strategy={verticalListSortingStrategy}>
              <ul>
                {visible.filter(match).map((field) => (
                  <SortableFieldRow key={field} field={field} draggable={!needle}
                    onToggle={() => onChange(visible.filter((item) => item !== field))} checked />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <SectionTitle action={hidden.length > 0 ? { label: 'Показать все', onClick: () => onChange([...visible, ...hidden]) } : undefined}>Скрытые</SectionTitle>
          <ul>
            {hidden.filter(match).map((field) => (
              <FieldRow key={field} field={field} checked={false} onToggle={() => onChange([...visible, field])} />
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SectionTitle({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-2">
      <span className="text-xs font-semibold text-p-muted">{children}</span>
      {action && <button type="button" onClick={action.onClick} className={`rounded-ctl px-1 text-xs font-medium text-p-text hover:underline ${FOCUS}`}>{action.label}</button>}
    </div>
  )
}

function SortableFieldRow({ field, draggable, checked, onToggle }: { field: string; draggable: boolean; checked: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field, disabled: !draggable })
  return (
    <FieldRow
      field={field}
      checked={checked}
      onToggle={onToggle}
      rowRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      handle={draggable ? (
        <button type="button" {...attributes} {...listeners} aria-label={`Переместить поле ${fieldLabel(field)}`}
          className={`grid h-6 w-5 cursor-grab place-items-center rounded text-p-muted2 hover:text-p-text active:cursor-grabbing ${FOCUS}`}>
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : <span className="w-5" />}
    />
  )
}

function FieldRow({ field, checked, onToggle, handle, rowRef, style, dragging }: {
  field: string
  checked: boolean
  onToggle: () => void
  handle?: ReactNode
  rowRef?: (node: HTMLElement | null) => void
  style?: CSSProperties
  dragging?: boolean
}) {
  const id = `field-visibility-${field}`
  return (
    <li ref={rowRef} style={style} className={cn('flex items-center gap-1 rounded-ctl px-1 py-1 hover:bg-p-panel2', dragging && 'relative z-10 bg-p-panel2 shadow')}>
      {handle ?? <span className="w-5" />}
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-sm">{fieldLabel(field)}</label>
      <Switch id={id} checked={checked} onCheckedChange={onToggle} aria-label={`${checked ? 'Скрыть' : 'Показать'} поле ${fieldLabel(field)}`} />
    </li>
  )
}
