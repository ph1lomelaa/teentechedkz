import React, { useMemo, useState } from 'react'
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
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { AssignmentBoard, BoardColumn, BoardStudent, PIPELINE_STATUS_LABELS, ROLE_LABELS } from '@/types'
import { cn } from '@/lib/utils'

/** Колонка «Без ответственного» — не сотрудник, поэтому свой идентификатор. */
export const UNASSIGNED_COLUMN = 'unassigned'

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
): { studentId: string; from: string; to: string } | null {
  if (!overId) return null

  const ownerOf = (studentId: string): string => {
    const column = board.columns.find((c) => c.students.some((s) => s.id === studentId))
    return column ? column.staff_id : UNASSIGNED_COLUMN
  }

  const isColumn =
    overId === UNASSIGNED_COLUMN || board.columns.some((c) => c.staff_id === overId)
  const to = isColumn ? overId : ownerOf(overId)
  const from = ownerOf(activeId)

  // Вернули туда же, откуда взяли — не назначение, а промах мышью.
  if (from === to) return null
  // В «без ответственного» не перетаскивают: снятие ответственного — не то же
  // самое, что передача, и делается из карточки студента с указанием причины.
  if (to === UNASSIGNED_COLUMN) return null
  return { studentId: activeId, from, to }
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
      <div className="text-[13px] font-medium leading-snug text-p-text line-clamp-2">
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

function CardLink({ student, isDragging }: { student: BoardStudent; isDragging?: boolean }) {
  return (
    <Link to={`/students/${student.id}`} className="block" draggable={false}>
      <StudentCard student={student} isDragging={isDragging} />
    </Link>
  )
}

function DraggableCard({ student }: { student: BoardStudent }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: student.id,
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
      <CardLink student={student} isDragging={isDragging} />
    </div>
  )
}

interface ColumnProps {
  id: string
  title: string
  subtitle?: string
  students: BoardStudent[]
  totalCount: number
  /** Доля от самой загруженной колонки — полоса нагрузки. */
  loadRatio: number
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
  title,
  subtitle,
  students,
  totalCount,
  loadRatio,
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
            {/* При активном поиске показываем «видно из всего», иначе кажется,
                что студенты пропали из колонки. */}
            {filtered ? `${students.length} из ${totalCount}` : totalCount}
          </span>
        </div>
        {subtitle && <div className="mt-0.5 truncate text-[10px] text-p-muted2">{subtitle}</div>}

        {/* Полоса показывает долю от самой загруженной колонки — и только.
            Отдельной пометки «перегружен» здесь нет намеренно: порог считался
            от средней по команде, а решение о перегрузе принимает человек,
            глядя на числа, — цветной ярлык за него это решал. */}
        <div className="mt-2 h-1 overflow-hidden rounded-pill bg-p-line">
          <div
            className={cn('h-full rounded-pill', warning ? 'bg-p-accent/50' : 'bg-p-accent')}
            style={{ width: `${Math.round(loadRatio * 100)}%` }}
          />
        </div>
      </div>

      <div className="min-h-[70px] flex-1 space-y-1 overflow-y-auto px-2 py-2 max-h-[calc(100vh-21rem)]">
        {/* Вне режима перетаскивания хуки dnd-kit не зовём вовсе: без
            DndContext вокруг они работают на значениях по умолчанию, и это
            слишком тонкая опора для колонки, которую видит вся команда. */}
        {canDrag ? (
          <SortableContext items={students.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {students.map((student) => (
              <DraggableCard key={student.id} student={student} />
            ))}
          </SortableContext>
        ) : (
          students.map((student) => <CardLink key={student.id} student={student} />)
        )}
        {students.length === 0 && (
          <div className="px-1 py-4 text-center text-[11px] leading-snug text-p-muted2">
            {totalCount === 0
              ? canDrag
                ? 'Никого не ведёт. Перетащите сюда студента'
                : 'Никого не ведёт'
              : 'Никто не подходит под поиск'}
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
  canDrag: boolean
  onMove: (move: { studentId: string; from: string; to: string }) => void
}

export const DistributionBoard: React.FC<DistributionBoardProps> = ({
  board,
  search,
  canDrag,
  onMove,
}) => {
  const [dragging, setDragging] = useState<BoardStudent | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const query = search.trim().toLowerCase()
  const visible = (students: BoardStudent[]) =>
    query ? students.filter((s) => s.full_name.toLowerCase().includes(query)) : students

  // Полоса нагрузки — доля от самой большой колонки.
  const maxLoad = useMemo(
    () => Math.max(1, ...board.columns.map((c) => c.students.length)),
    [board.columns],
  )

  const byId = useMemo(() => {
    const map = new Map<string, BoardStudent>()
    for (const column of board.columns) for (const s of column.students) map.set(s.id, s)
    for (const s of board.unassigned) map.set(s.id, s)
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
        loadRatio={board.unassigned.length / maxLoad}
        emphasis="warning"
        canDrag={false}
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
          loadRatio={column.students.length / maxLoad}
          canDrag={canDrag}
          href={columnHref(column)}
        />
      ))}
    </div>
  )

  if (!canDrag) return <div className="overflow-x-auto pb-2">{content}</div>

  return (
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
  )
}
