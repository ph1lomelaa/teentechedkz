import React, { createContext, useContext, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ArrowRight, MoreHorizontal, Repeat, UserMinus, UserPlus } from 'lucide-react'
import { AssignmentBoard, BoardColumn, BoardStudent, PIPELINE_STATUS_LABELS, ROLE_LABELS } from '@/types'
import { cn } from '@/lib/utils'

/** Колонка «Без ответственного» — не сотрудник, поэтому свой идентификатор. */
export const UNASSIGNED_COLUMN = 'unassigned'

/**
 * Статус карточки для фильтра доски. Студент без договора приходит с
 * `pipeline_status = null` — для фильтра это то же «Нет статуса», иначе его
 * нельзя было бы ни показать, ни скрыть.
 */
export function boardStatusKey(student: BoardStudent): string {
  return student.pipeline_status || 'no_status'
}

/**
 * Чем фильтруют доску. Пустое множество — «не ограничивать»: так фильтр,
 * которым не пользовались, не прячет всё подряд.
 *
 * Год, ступень и страна добавились потому, что доска приходит целиком, без
 * пагинации: у МЗК в колонке «Без ответственного» лежало 253 человека за пять
 * лет набора, и отобрать среди них нужный год было нечем.
 */
export interface BoardFilters {
  statuses: ReadonlySet<string>
  years: ReadonlySet<string>
  degrees: ReadonlySet<string>
  countries: ReadonlySet<string>
}

/** Проходит ли карточка фильтры. Чистая функция — её же зовёт счётчик страницы. */
export function matchesBoardFilters(student: BoardStudent, filters: BoardFilters): boolean {
  if (!filters.statuses.has(boardStatusKey(student))) return false
  if (filters.years.size && !filters.years.has(String(student.intake_year ?? ''))) return false
  if (filters.degrees.size && !filters.degrees.has(student.degree_level ?? '')) return false
  if (filters.countries.size && !filters.countries.has(student.country ?? '')) return false
  return true
}

/**
 * Идентификатор карточки на доске — назначение, а не ученик.
 *
 * В мультироли (ментор по стране) ответственных несколько, и карточка одного
 * ученика честно лежит в двух колонках. По `student.id` это дало бы два
 * draggable с одинаковым id: dnd-kit перепутал бы их между собой, React
 * пожаловался бы на дублирующийся key, а `resolveDrop` находил бы колонку
 * первого попавшегося — то есть перенос одной карточки снимал бы вторую.
 *
 * У «забытых» назначения нет, поэтому им синтетический ключ.
 */
export function boardCardKey(student: BoardStudent): string {
  return student.assignment_id ?? `unassigned:${student.id}`
}

/**
 * Куда уехала карточка.
 *
 * Вынесено отдельной чистой функцией: перетаскивание в jsdom не
 * воспроизводится честно, а решение «в какую колонку попал студент» — ровно то
 * место, где ошибка молча назначит студента не тому. Тот же приём, что с
 * `matchesOperationalFilter` в StudentsListPage.
 *
 * Бросить карточку можно и на другую карточку (dnd-kit отдаёт её id) — тогда
 * колонку определяем по владельцу этой карточки.
 */
export function resolveDrop(
  board: AssignmentBoard,
  activeId: string,
  overId: string | null,
): { studentId: string; assignmentId: string | null; from: string; to: string } | null {
  if (!overId) return null

  const find = (cardKey: string): { student: BoardStudent; column: string } | null => {
    for (const column of board.columns) {
      const student = column.students.find((s) => boardCardKey(s) === cardKey)
      if (student) return { student, column: column.staff_id }
    }
    const orphan = board.unassigned.find((s) => boardCardKey(s) === cardKey)
    return orphan ? { student: orphan, column: UNASSIGNED_COLUMN } : null
  }

  const active = find(activeId)
  if (!active) return null

  const isColumn =
    overId === UNASSIGNED_COLUMN || board.columns.some((c) => c.staff_id === overId)
  const to = isColumn ? overId : find(overId)?.column
  if (!to) return null
  const from = active.column

  // Вернули туда же, откуда взяли — не назначение, а промах мышью.
  if (from === to) return null
  // `to === UNASSIGNED_COLUMN` — снятие ответственного. Страница спрашивает
  // причину до запроса, так что промах в первую колонку отменяется там же.
  //
  // `assignmentId` отдаём наружу: в мультироли перенос обязан менять именно эту
  // строку, а не пересобирать роль целиком.
  return {
    studentId: active.student.id,
    assignmentId: active.student.assignment_id ?? null,
    from,
    to,
  }
}

function StudentCard({ student, isDragging }: { student: BoardStudent; isDragging?: boolean }) {
  const status = student.pipeline_status
  return (
    <div
      className={cn(
        'rounded-panel border border-p-line bg-p-panel2 px-2.5 py-2 transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      {/* Справа место под кнопку «⋯» (CardMenu). */}
      <div className="pr-5 text-[13px] font-medium leading-snug text-p-text line-clamp-2">
        {student.full_name}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {status ? (
          <span className="truncate text-[10px] font-medium text-p-muted">
            {PIPELINE_STATUS_LABELS[status as keyof typeof PIPELINE_STATUS_LABELS] ?? status}
          </span>
        ) : (
          <span className="text-[10px] text-p-muted2">Без статуса</span>
        )}
        {student.assignment_status === 'awaiting_signature' && (
          <span
            title="Специалист ещё не подписал регламент — назначение ждёт подписи"
            className="shrink-0 rounded-pill border border-p-accent/40 bg-p-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-p-accent"
          >
            ждёт подписи
          </span>
        )}
      </div>
    </div>
  )
}

/** Действие из меню «⋯» карточки — то же, что перетаскивание, но без мыши. */
export type BoardCardAction =
  | { type: 'transfer'; student: BoardStudent; from: string }
  | { type: 'unassign'; student: BoardStudent; from: string }

const CardActionsContext = createContext<((action: BoardCardAction) => void) | null>(null)

/**
 * Меню «⋯» на карточке. Перетаскивание неудобно с тачпада и с телефона, а
 * передать или снять студента должно быть можно всегда — поэтому то же самое
 * продублировано кнопками. Нажатие не должно ни открывать карточку (она
 * ссылка), ни начинать перетаскивание (сенсоры dnd-kit на обёртке).
 */
function CardMenu({ student, columnId }: { student: BoardStudent; columnId: string }) {
  const onAction = useContext(CardActionsContext)
  const [open, setOpen] = useState(false)
  if (!onAction) return null
  const unassigned = columnId === UNASSIGNED_COLUMN
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  const run = (e: React.SyntheticEvent, type: BoardCardAction['type']) => {
    stop(e)
    setOpen(false)
    onAction({ type, student, from: columnId })
  }
  return (
    <div
      className="absolute right-1 top-1"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Действия: ${student.full_name}`}
        onClick={(e) => {
          stop(e)
          setOpen((v) => !v)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-ctl p-0.5 text-p-muted2 opacity-60 hover:bg-p-line hover:text-p-text hover:opacity-100 focus:opacity-100"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 w-40 rounded-panel border border-p-line bg-white py-1 text-xs shadow-lg">
          <button
            type="button"
            onMouseDown={(e) => run(e, 'transfer')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-p-text hover:bg-p-bg"
          >
            {unassigned ? <UserPlus className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
            {unassigned ? 'Назначить…' : 'Передать…'}
          </button>
          {!unassigned && student.assignment_id && (
            <button
              type="button"
              onMouseDown={(e) => run(e, 'unassign')}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            >
              <UserMinus className="h-3.5 w-3.5" />
              Снять
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CardLink({
  student,
  isDragging,
  columnId,
}: {
  student: BoardStudent
  isDragging?: boolean
  columnId?: string
}) {
  return (
    <div className="relative">
      <Link to={`/students/${student.id}`} className="block" draggable={false}>
        <StudentCard student={student} isDragging={isDragging} />
      </Link>
      {columnId && !isDragging && <CardMenu student={student} columnId={columnId} />}
    </div>
  )
}

function DraggableCard({ student, columnId }: { student: BoardStudent; columnId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: boardCardKey(student),
  })

  // Карточка — одновременно ссылка на студента и ручка перетаскивания. Порог
  // активации у сенсоров (8px) разводит клик и таскание: без него открыть
  // карточку с доски было бы нельзя.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <CardLink student={student} isDragging={isDragging} columnId={columnId} />
    </div>
  )
}

interface ColumnProps {
  id: string
  title: string
  subtitle?: string
  students: BoardStudent[]
  totalCount: number
  /** Что спрятало карточки, если видно не всех, — для текста пустой колонки. */
  hiddenBy: 'search' | 'filters'
  emphasis?: 'default' | 'warning'
  canDrag: boolean
  href: string
}

/** Колонка, принимающая карточки. Отдельно от Column: `useDroppable` нельзя
 *  звать условно, а вне режима перетаскивания DndContext вокруг нет. */
function DroppableColumn(props: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id })
  return <Column {...props} dropRef={setNodeRef} isOver={isOver} />
}

function Column({
  id,
  title,
  subtitle,
  students,
  totalCount,
  hiddenBy,
  emphasis = 'default',
  canDrag,
  href,
  dropRef,
  isOver,
}: ColumnProps & { dropRef?: (node: HTMLElement | null) => void; isOver?: boolean }) {
  const warning = emphasis === 'warning'
  const filtered = students.length !== totalCount

  return (
    <div
      ref={dropRef}
      className={cn(
        'flex flex-col rounded-card border transition-colors',
        warning ? 'border-p-accent/45 bg-p-panel' : 'border-p-line bg-p-panel',
        isOver && canDrag && 'border-p-accent bg-p-accent/[0.07]',
      )}
    >
      <div className={cn('border-b px-2.5 pb-2 pt-2.5', warning ? 'border-p-accent/30' : 'border-p-line')}>
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-caps',
              warning ? 'text-p-accent' : 'text-p-text',
            )}
          >
            {warning && <AlertTriangle className="h-3 w-3 shrink-0" />}
            <span className="truncate" title={title}>
              {title}
            </span>
          </span>
          <span
            className={cn(
              'shrink-0 rounded-pill border px-1.5 py-0.5 text-[10px] font-semibold',
              warning ? 'border-p-accent/45 text-p-accent' : 'border-p-line text-p-muted',
            )}
          >
            {/* При поиске или фильтре показываем «видно из всего», иначе
                кажется, что студенты пропали из колонки. */}
            {filtered ? `${students.length} из ${totalCount}` : totalCount}
          </span>
        </div>
        {subtitle && <div className="mt-0.5 truncate text-[10px] text-p-muted2">{subtitle}</div>}
      </div>

      <div className="min-h-[70px] flex-1 space-y-1 overflow-y-auto px-2 py-2 max-h-[calc(100vh-21rem)]">
        {/* Вне режима перетаскивания хуки dnd-kit не зовём вовсе: без
            DndContext вокруг они работают на значениях по умолчанию, и это
            слишком тонкая опора для колонки, которую видит вся команда. */}
        {canDrag ? (
          <SortableContext items={students.map(boardCardKey)} strategy={verticalListSortingStrategy}>
            {students.map((student) => (
              <DraggableCard key={boardCardKey(student)} student={student} columnId={id} />
            ))}
          </SortableContext>
        ) : (
          students.map((student) => <CardLink key={boardCardKey(student)} student={student} />)
        )}
        {students.length === 0 && (
          <div className="px-1 py-4 text-center text-[11px] leading-snug text-p-muted2">
            {totalCount === 0
              ? id === UNASSIGNED_COLUMN
                ? 'Все распределены'
                : canDrag
                ? 'Никого не ведёт. Перетащите сюда студента'
                : 'Никого не ведёт'
              : hiddenBy === 'search'
                ? 'Никто не подходит под поиск'
                : 'Нет студентов по выбранным фильтрам'}
          </div>
        )}
      </div>

      {totalCount > 0 && (
        <Link
          to={href}
          className={cn(
            'flex items-center justify-between gap-1 border-t px-3 py-2 text-[11px] font-medium transition-colors',
            warning
              ? 'border-p-accent/30 text-p-accent hover:bg-p-accent/10'
              : 'border-p-line text-p-muted hover:bg-p-panel2 hover:text-p-text',
          )}
        >
          Показать в базе
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}

interface DistributionBoardProps {
  board: AssignmentBoard
  /** Клиентский поиск по студентам — прячет карточки во всех колонках сразу. */
  search: string
  /** Применяется ко всей доске: иначе колонки сотрудников забиты
   *  «передумавшими», и сравнивать нагрузку нельзя. */
  filters: BoardFilters
  canDrag: boolean
  onMove: (move: { studentId: string; assignmentId: string | null; from: string; to: string }) => void
  /** Меню «⋯» на карточке: передать или снять без перетаскивания. */
  onCardAction?: (action: BoardCardAction) => void
}

export const DistributionBoard: React.FC<DistributionBoardProps> = ({
  board,
  search,
  filters,
  canDrag,
  onMove,
  onCardAction,
}) => {
  const [dragging, setDragging] = useState<BoardStudent | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const query = search.trim().toLowerCase()
  const visible = (students: BoardStudent[]) =>
    students.filter(
      (s) => matchesBoardFilters(s, filters) && (!query || s.full_name.toLowerCase().includes(query)),
    )
  const hiddenBy = query ? 'search' : 'filters'

  // Индекс по ключу карточки, а не по ученику: в мультироли у одного ученика
  // две карточки, и по `student.id` в наложении показывалась бы не та.
  const byId = useMemo(() => {
    const map = new Map<string, BoardStudent>()
    for (const column of board.columns) for (const s of column.students) map.set(boardCardKey(s), s)
    for (const s of board.unassigned) map.set(boardCardKey(s), s)
    return map
  }, [board])

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const move = resolveDrop(board, String(event.active.id), event.over ? String(event.over.id) : null)
    if (move) onMove(move)
  }

  // Принимать перетаскивание умеет только доска в режиме правки.
  const ColumnComponent = canDrag ? DroppableColumn : Column

  const columnHref = (column: BoardColumn) =>
    `/students?mentor_id=${column.staff_id}&assignment_role=${board.role}`

  const content = (
    <div
      className="grid min-w-max gap-2"
      // Ширина фиксированная, а не 1fr: при двух-трёх колонках доля растягивала
      // каждую на треть экрана, и «доска» читалась как несколько длинных
      // списков — по ней нельзя было вести глазом и сравнивать нагрузку.
      style={{ gridTemplateColumns: `repeat(${board.columns.length + 1}, 208px)` }}
    >
      {/* «Без ответственного» первой: ради неё доску и открывают — кого забыли
          распределить, видно раньше, чем у кого сколько. */}
      <ColumnComponent
        id={UNASSIGNED_COLUMN}
        title="Без ответственного"
        students={visible(board.unassigned)}
        totalCount={board.unassigned.length}
        hiddenBy={hiddenBy}
        emphasis="warning"
        canDrag={canDrag}
        href={`/students?missing_role=${board.role}`}
      />
      {board.columns.map((column) => (
        <ColumnComponent
          key={column.staff_id}
          id={column.staff_id}
          title={column.name}
          subtitle={ROLE_LABELS[column.user_role] ?? column.user_role}
          students={visible(column.students)}
          totalCount={column.students.length}
          hiddenBy={hiddenBy}
          canDrag={canDrag}
          href={columnHref(column)}
        />
      ))}
    </div>
  )

  if (!canDrag) return <div className="overflow-x-auto pb-2">{content}</div>

  return (
    <CardActionsContext.Provider value={onCardAction ?? null}>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) => setDragging(byId.get(String(event.active.id)) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-x-auto pb-2">{content}</div>
      <DragOverlay>{dragging ? <StudentCard student={dragging} /> : null}</DragOverlay>
    </DndContext>
    </CardActionsContext.Provider>
  )
}
