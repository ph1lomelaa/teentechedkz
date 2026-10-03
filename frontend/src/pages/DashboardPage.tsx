import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { studentsApi } from '@/api/students'
import { contractsApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import {
  StudentListItem,
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_COLUMNS,
} from '@/types'
import { PageHeader } from '@/components/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { Button } from '@/components/ui/primitives/button'
import { Check, UserPlus, X } from 'lucide-react'
import { QueryError } from '@/components/shared/QueryState'
import { NotionPipelineTable } from '@/components/students/NotionPipelineTable'
import { StudentPeekPanel, countryFlag } from '@/components/students/StudentPeekPanel'
import { StudentAssignmentBar, useCanAssignOthers, useCanSelectStudents } from '@/components/students/StudentAssignmentBar'

interface StudentCardProps {
  student: StudentListItem
  isDragging?: boolean
  selectionMode?: boolean
  selected?: boolean
  alreadyAssigned?: boolean
  onToggleSelected?: (studentId: string) => void
  onOpenStudent?: (student: StudentListItem) => void
}

function StudentCard({ student, isDragging, selectionMode, selected, alreadyAssigned, onToggleSelected, onOpenStudent }: StudentCardProps) {
  // Имена менторов из Notion-снэпшота; фолбэк — активные назначения в CRM
  const mentors = (student.mentors && student.mentors.length > 0
    ? student.mentors
    : (student.responsibles ?? [])
        .filter((r) => r.is_active && r.name)
        .map((r) => r.name as string))
  const flag = countryFlag(student.country)

  return (
    <div
      className={`relative bg-white rounded-panel border p-3 transition-colors ${selectionMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'border-brand bg-brand/10' : 'border-p-line hover:border-p-line'} ${isDragging ? 'opacity-40 scale-95' : ''}`}
      onClick={selectionMode && !alreadyAssigned ? () => onToggleSelected?.(student.id) : undefined}
    >
      <div className="flex items-start gap-2">
        {selectionMode ? (
          <span className="min-w-0 flex-1 font-medium text-sm text-p-text line-clamp-2 leading-snug">
            {student.full_name}
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenStudent?.(student) }}
            className="min-w-0 flex-1 font-medium text-sm text-p-text hover:text-black transition-colors line-clamp-2 leading-snug"
          >
            {student.full_name}
          </button>
        )}
        {selectionMode && (
          alreadyAssigned ? (
            <span className="shrink-0 rounded-pill border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
              Уже мой
            </span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggleSelected?.(student.id)
              }}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-ctl border transition-colors ${selected ? 'border-brand bg-brand text-black' : 'border-p-line bg-transparent text-transparent hover:border-brand'}`}
              aria-label={selected ? `Убрать ${student.full_name} из выбора` : `Выбрать ${student.full_name}`}
              aria-pressed={selected}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-pill font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
          {DEGREE_LEVEL_LABELS[student.degree_level]}
        </span>
        {mentors.slice(0, 2).map((name) => (
          <span key={name} className="text-[10px] px-1.5 py-0.5 rounded-pill font-medium bg-p-panel text-p-muted max-w-[7rem] truncate">
            {name}
          </span>
        ))}
        {mentors.length > 2 && (
          <span className="text-[10px] text-p-muted2 font-medium">+{mentors.length - 2}</span>
        )}
      </div>

      {(student.country || student.days_in_work != null) && (
        <div className="flex items-center justify-between gap-2 mt-2">
          {student.country ? (
            <span className="text-[10px] text-p-muted font-medium truncate">
              {flag && <span className="mr-1">{flag}</span>}
              {student.country}
            </span>
          ) : (
            <span />
          )}
          {student.days_in_work != null && (
            <span className={`text-[10px] font-medium shrink-0 ${student.days_in_work > 365 ? 'text-amber-600' : 'text-p-muted'}`}>
              {student.days_in_work}д
            </span>
          )}
        </div>
      )}
    </div>
  )
}

interface SortableStudentCardProps {
  student: StudentListItem
  selectionMode?: boolean
  selected?: boolean
  alreadyAssigned?: boolean
  onToggleSelected?: (studentId: string) => void
  onOpenStudent?: (student: StudentListItem) => void
}

function SortableStudentCard({ student, selectionMode, selected, alreadyAssigned, onToggleSelected, onOpenStudent }: SortableStudentCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: student.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StudentCard
        student={student}
        isDragging={isDragging}
        selectionMode={selectionMode}
        selected={selected}
        alreadyAssigned={alreadyAssigned}
        onToggleSelected={onToggleSelected}
        onOpenStudent={onOpenStudent}
      />
    </div>
  )
}

interface KanbanColumnProps {
  status: PipelineStatus
  students: StudentListItem[]
  canDrag: boolean
  selectionMode?: boolean
  selectedIds?: Set<string>
  assignedIds?: Set<string>
  onToggleSelected?: (studentId: string) => void
  droppableId?: string
  onOpenStudent?: (student: StudentListItem) => void
}

function KanbanColumn({ status, students, canDrag, selectionMode, selectedIds, assignedIds, onToggleSelected, droppableId, onOpenStudent }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: droppableId ?? status })

  return (
    <div ref={setNodeRef} className="kanban-column flex flex-col rounded-card bg-p-bg/50 border border-p-line">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-p-line">
        <span className="text-[11px] font-semibold text-p-muted uppercase tracking-caps">
          {PIPELINE_STATUS_LABELS[status]}
        </span>
        <span className="text-[10px] text-p-muted border border-p-line rounded-pill px-1.5 py-0.5 font-semibold">
          {students.length}
        </span>
      </div>

      <div className="flex-1 px-2 pb-2 pt-2 space-y-1.5 min-h-[60px]">
        {canDrag ? (
          <SortableContext
            items={students.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {students.map((student) => (
              <SortableStudentCard
                key={student.id}
                student={student}
                selectionMode={selectionMode}
                selected={selectedIds?.has(student.id)}
                alreadyAssigned={Boolean(student.is_mine || assignedIds?.has(student.id))}
                onToggleSelected={onToggleSelected}
                onOpenStudent={onOpenStudent}
              />
            ))}
          </SortableContext>
        ) : (
          students.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              selectionMode={selectionMode}
              selected={selectedIds?.has(student.id)}
              alreadyAssigned={Boolean(student.is_mine || assignedIds?.has(student.id))}
              onToggleSelected={onToggleSelected}
              onOpenStudent={onOpenStudent}
            />
          ))
        )}
      </div>
    </div>
  )
}

const CrmDashboardView: React.FC = () => {
  const queryClient = useQueryClient()
  const isAdmin = useCanAssignOthers()
  const canDrag = isAdmin
  const canSelectStudents = useCanSelectStudents()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetUserId, setTargetUserId] = useState('')

  const [mentorFilter, setMentorFilter] = useState<string>('')
  const [mzkFilter, setMzkFilter] = useState<string>('')
  const [countryFilter, setCountryFilter] = useState('')
  const [intakeYearFilter, setIntakeYearFilter] = useState<string>('')

  const [activeStudent, setActiveStudent] = useState<StudentListItem | null>(
    null
  )
  const [peekStudent, setPeekStudent] = useState<StudentListItem | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // На тачскринах drag стартует после долгого нажатия, чтобы не мешать прокрутке
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  )

  // data: students = [] прятало ошибку полностью: канбан рисовался пустым, и
  // отличить «никого нет» от «не загрузилось» было нельзя.
  const { data: students = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['students', 'all', mentorFilter, mzkFilter, countryFilter, intakeYearFilter],
    queryFn: () =>
      studentsApi.getAll({
        size: 2000,
        mentor_name: mentorFilter || undefined,
        mzk_name: mzkFilter || undefined,
        country: countryFilter || undefined,
        intake_year: intakeYearFilter ? Number(intakeYearFilter) : undefined,
      }),
  })

  // Менторы/менеджеры собираются из Notion-снэпшотов и дедуплицируются
  // (транслит + регистр), см. backend/app/services/people_facets.py
  const { data: peopleFacets } = useQuery({
    queryKey: ['students', 'people-facets'],
    queryFn: studentsApi.peopleFacets,
  })
  const mentors = peopleFacets?.mentors ?? []
  const mzkManagers = peopleFacets?.managers ?? []

  const { data: facets } = useQuery({
    queryKey: ['students', 'facets'],
    queryFn: studentsApi.facets,
  })

  const assignedIds = useMemo(() => {
    if (!isAdmin || !targetUserId) return new Set<string>()
    return new Set(
      students
        .filter((student) => student.responsibles?.some(
          (responsible) => responsible.id === targetUserId && responsible.is_active
        ))
        .map((student) => student.id)
    )
  }, [isAdmin, students, targetUserId])

  const updatePipelineMutation = useMutation({
    mutationFn: async ({
      studentId,
      newStatus,
    }: {
      studentId: string
      newStatus: PipelineStatus
    }) => {
      const student = students.find((s) => s.id === studentId)
      if (!student) return

      const studentFull = await studentsApi.get(studentId)
      const contract = studentFull.contracts?.[0]
      if (!contract) {
        throw new Error('У студента нет договора — статус пайплайна привязан к договору')
      }
      await contractsApi.update(contract.id, {
        pipeline_status: newStatus,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (err) => {
      toast({ title: 'Ошибка', description: getErrorMessage(err, 'Не удалось обновить статус'), variant: 'destructive' })
    },
  })

  const toggleSelected = (studentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const closeSelection = () => {
    setSelectedIds(new Set())
    setSelectionMode(false)
    setTargetUserId('')
  }

  const filteredStudents = students

  /** Кого из видимого сейчас можно назначить — на это опирается «Выбрать все». */
  const selectableIds = useMemo(
    () => filteredStudents
      .filter((student) => !student.is_mine && !assignedIds.has(student.id))
      .map((student) => student.id),
    [filteredStudents, assignedIds],
  )
  const selectableCount = selectableIds.length
  const allFilteredSelected =
    selectableCount > 0 && selectableIds.every((id) => selectedIds.has(id))

  const grouped = useMemo(() => {
    const groups = {} as Record<PipelineStatus, StudentListItem[]>
    for (const status of PIPELINE_COLUMNS) groups[status] = []
    for (const student of filteredStudents) {
      // Статус, которого нет в справочнике, кладём в «Нет статуса», а не
      // обращаемся к несуществующей группе: раньше такой студент ронял всю
      // доску на `undefined.push`, то есть один незнакомый этап с бэкенда
      // выносил экран целиком.
      const status = student.pipeline_status ?? 'no_status'
      ;(groups[status] ?? groups.no_status).push(student)
    }
    return groups
  }, [filteredStudents])

  /**
   * Заполненные колонки — первыми, пустые — в конец.
   *
   * Этапов десять, а занято обычно три-четыре: пустые «Пересдача IELTS» и «Не
   * оплачено» стояли в середине и раздвигали доску так, что до колонок с
   * людьми приходилось горизонтально скроллить.
   *
   * Внутри каждой половины порядок канонический (PIPELINE_COLUMNS), а не
   * «по числу студентов»: иначе колонки менялись бы местами после каждого
   * перетаскивания, и глаз перестал бы находить нужную по памяти.
   */
  const orderedColumns = useMemo(() => {
    const filled = PIPELINE_COLUMNS.filter((status) => (grouped[status]?.length ?? 0) > 0)
    const empty = PIPELINE_COLUMNS.filter((status) => (grouped[status]?.length ?? 0) === 0)
    return [...filled, ...empty]
  }, [grouped])

  const handleDragStart = (event: DragStartEvent) => {
    const student = students.find((s) => s.id === event.active.id)
    if (student) setActiveStudent(student)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveStudent(null)
    const { active, over } = event
    if (!over) return

    const studentId = active.id as string
    const overId = over.id as string
    const overStudent = students.find((s) => s.id === overId)
    const overColumnId = overId.includes('::') ? overId.split('::').pop() : overId
    const overColumnStatus = (PIPELINE_COLUMNS.includes(overColumnId as PipelineStatus)
      ? overColumnId
      : overStudent?.pipeline_status) as PipelineStatus | undefined

    if (overColumnStatus && PIPELINE_COLUMNS.includes(overColumnStatus)) {
      const student = students.find((s) => s.id === studentId)
      if (student && student.pipeline_status !== overColumnStatus) {
        updatePipelineMutation.mutate({
          studentId,
          newStatus: overColumnStatus,
        })
      }
    }
  }

  if (isError) return <QueryError error={error} onRetry={refetch} />

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-p-muted">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        eyebrow="CRM"
        title="Обзор студентов"
        description={canSelectStudents
          ? (isAdmin ? 'Выберите студентов и назначьте им ментора или менеджера.' : 'Выберите студентов на доске и добавьте их в «Мои».')
          : 'Студенты и их текущие этапы поступления.'}
        action={canSelectStudents ? (
          <div className="flex items-center gap-2">
            {selectionMode ? (
              <Button variant="outline" size="sm" onClick={closeSelection}>
                <X className="mr-1.5 h-3.5 w-3.5" /> Отменить
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Выбрать студентов
              </Button>
            )}
          </div>
        ) : undefined}
      />

      {selectionMode && (
        <StudentAssignmentBar
          selectedCount={selectedIds.size}
          selectableCount={selectableCount}
          allSelected={allFilteredSelected}
          onToggleAll={() => setSelectedIds(allFilteredSelected ? new Set() : new Set(selectableIds))}
          targetUserId={targetUserId}
          onTargetChange={setTargetUserId}
          resolveStudentIds={async () => Array.from(selectedIds)}
          onAssigned={() => { setSelectedIds(new Set()); setSelectionMode(false) }}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Select value={mentorFilter || 'all'} onValueChange={(v) => setMentorFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40 h-8 text-xs">
            <SelectValue placeholder="Ментор" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все менторы</SelectItem>
            {mentors.map((m) => (
              <SelectItem key={m.key} value={m.key}>{m.label} · {m.count}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={mzkFilter || 'all'} onValueChange={(v) => setMzkFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40 h-8 text-xs">
            <SelectValue placeholder="MZK менеджер" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все менеджеры</SelectItem>
            {mzkManagers.map((m) => (
              <SelectItem key={m.key} value={m.key}>{m.label} · {m.count}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={countryFilter || 'all'} onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40 h-8 text-xs">
            <SelectValue placeholder="Страна" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все страны</SelectItem>
            {(facets?.countries ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={intakeYearFilter || 'all'} onValueChange={(v) => setIntakeYearFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-28 h-8 text-xs">
            <SelectValue placeholder="Год" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все годы</SelectItem>
            {(facets?.years ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(mentorFilter || mzkFilter || countryFilter || intakeYearFilter) && (
          <button
            className="text-xs text-p-muted hover:text-black font-medium px-2 py-1 underline underline-offset-4 transition-colors"
            onClick={() => { setMentorFilter(''); setMzkFilter(''); setCountryFilter(''); setIntakeYearFilter('') }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Kanban board */}
      <div className="kanban-container flex-1 overflow-x-auto">
        {canDrag && !selectionMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid min-w-max gap-2"
              style={{ gridTemplateColumns: `repeat(${orderedColumns.length}, minmax(180px, 1fr))` }}>
              {orderedColumns.map((status) => <KanbanColumn key={status} status={status} students={grouped[status] ?? []} canDrag={canDrag && !selectionMode} selectionMode={selectionMode} selectedIds={selectedIds} assignedIds={assignedIds} onToggleSelected={toggleSelected} onOpenStudent={setPeekStudent} />)}
            </div>
            <DragOverlay>
              {activeStudent ? (
                <StudentCard student={activeStudent} />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="grid min-w-max gap-2"
              style={{ gridTemplateColumns: `repeat(${orderedColumns.length}, minmax(180px, 1fr))` }}>
            {orderedColumns.map((status) => <KanbanColumn key={status} status={status} students={grouped[status] ?? []} canDrag={false} selectionMode={selectionMode} selectedIds={selectedIds} assignedIds={assignedIds} onToggleSelected={toggleSelected} onOpenStudent={setPeekStudent} />)}
          </div>
        )}
      </div>
      {peekStudent && <StudentPeekPanel studentId={peekStudent.id} fallbackName={peekStudent.full_name} onClose={() => setPeekStudent(null)} />}
    </div>
  )
}

export const DashboardPage: React.FC = () => {
  const { can } = useAuth()
  return can('notion', 'manage') ? <NotionPipelineTable overview /> : <CrmDashboardView />
}
