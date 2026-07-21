import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
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
import { contractsApi, mentorAssignmentsApi, usersApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import {
  StudentListItem,
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_COLUMNS,
} from '@/types'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { Button } from '@/components/ui/button'
import { Check, UserPlus, X } from 'lucide-react'

// Флаг по названию страны (данные в базе преимущественно на русском,
// встречаются английские и составные значения — берём первый сегмент).
const COUNTRY_FLAGS: Record<string, string> = {
  'италия': '🇮🇹', 'italy': '🇮🇹',
  'корея': '🇰🇷', 'южная корея': '🇰🇷', 'korea': '🇰🇷', 'south korea': '🇰🇷',
  'китай': '🇨🇳', 'china': '🇨🇳',
  'гонконг': '🇭🇰', 'hong kong': '🇭🇰',
  'сша': '🇺🇸', 'usa': '🇺🇸', 'америка': '🇺🇸',
  'германия': '🇩🇪', 'germany': '🇩🇪',
  'венгрия': '🇭🇺', 'hungary': '🇭🇺',
  'малайзия': '🇲🇾', 'malaysia': '🇲🇾',
  'великобритания': '🇬🇧', 'англия': '🇬🇧', 'uk': '🇬🇧',
  'катар': '🇶🇦', 'qatar': '🇶🇦',
  'оаэ': '🇦🇪', 'uae': '🇦🇪', 'эмираты': '🇦🇪',
  'япония': '🇯🇵', 'japan': '🇯🇵',
  'канада': '🇨🇦', 'canada': '🇨🇦',
  'австрия': '🇦🇹', 'austria': '🇦🇹',
  'сингапур': '🇸🇬', 'singapore': '🇸🇬',
  'польша': '🇵🇱', 'poland': '🇵🇱',
  'чехия': '🇨🇿', 'czech': '🇨🇿',
  'нидерланды': '🇳🇱', 'голландия': '🇳🇱', 'netherlands': '🇳🇱',
  'франция': '🇫🇷', 'france': '🇫🇷',
  'испания': '🇪🇸', 'spain': '🇪🇸',
  'турция': '🇹🇷', 'turkey': '🇹🇷',
  'финляндия': '🇫🇮', 'finland': '🇫🇮',
}

function countryFlag(country?: string | null): string {
  if (!country) return ''
  const first = country.split(/[,/]/)[0].trim().toLowerCase()
  return COUNTRY_FLAGS[first] ?? ''
}

interface StudentCardProps {
  student: StudentListItem
  isDragging?: boolean
  selectionMode?: boolean
  selected?: boolean
  alreadyAssigned?: boolean
  onToggleSelected?: (studentId: string) => void
}

function StudentCard({ student, isDragging, selectionMode, selected, alreadyAssigned, onToggleSelected }: StudentCardProps) {
  // Имена менторов из Notion-снэпшота; фолбэк — активные назначения в CRM
  const mentors = (student.mentors && student.mentors.length > 0
    ? student.mentors
    : (student.responsibles ?? [])
        .filter((r) => r.is_active && r.name)
        .map((r) => r.name as string))
  const flag = countryFlag(student.country)

  return (
    <div
      className={`relative bg-white rounded-[2px] border p-3 transition-colors ${selectionMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'border-brand bg-brand/10' : 'border-gray-200 hover:border-gray-300'} ${isDragging ? 'opacity-40 scale-95' : ''}`}
      onClick={selectionMode && !alreadyAssigned ? () => onToggleSelected?.(student.id) : undefined}
    >
      <div className="flex items-start gap-2">
        <Link
          to={`/students/${student.id}`}
          className="min-w-0 flex-1 font-medium text-sm text-gray-900 hover:text-black transition-colors line-clamp-2 leading-snug"
          onClick={(e) => e.stopPropagation()}
        >
          {student.full_name}
        </Link>
        {selectionMode && (
          alreadyAssigned ? (
            <span className="shrink-0 rounded-[2px] border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
              Уже мой
            </span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggleSelected?.(student.id)
              }}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border transition-colors ${selected ? 'border-brand bg-brand text-black' : 'border-gray-300 bg-transparent text-transparent hover:border-brand'}`}
              aria-label={selected ? `Убрать ${student.full_name} из выбора` : `Выбрать ${student.full_name}`}
              aria-pressed={selected}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
          {DEGREE_LEVEL_LABELS[student.degree_level]}
        </span>
        {mentors.slice(0, 2).map((name) => (
          <span key={name} className="text-[10px] px-1.5 py-0.5 rounded-[2px] font-medium bg-gray-100 text-gray-600 max-w-[7rem] truncate">
            {name}
          </span>
        ))}
        {mentors.length > 2 && (
          <span className="text-[10px] text-gray-400 font-medium">+{mentors.length - 2}</span>
        )}
      </div>

      {(student.country || student.days_in_work != null) && (
        <div className="flex items-center justify-between gap-2 mt-2">
          {student.country ? (
            <span className="text-[10px] text-gray-600 font-medium truncate">
              {flag && <span className="mr-1">{flag}</span>}
              {student.country}
            </span>
          ) : (
            <span />
          )}
          {student.days_in_work != null && (
            <span className={`text-[10px] font-medium shrink-0 ${student.days_in_work > 365 ? 'text-amber-600' : 'text-gray-500'}`}>
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
}

function SortableStudentCard({ student, selectionMode, selected, alreadyAssigned, onToggleSelected }: SortableStudentCardProps) {
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
}

function KanbanColumn({ status, students, canDrag, selectionMode, selectedIds, assignedIds, onToggleSelected }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status })

  return (
    <div ref={setNodeRef} className="kanban-column flex flex-col rounded-[2px] bg-gray-50/50 border border-gray-200">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-gray-100">
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-caps">
          {PIPELINE_STATUS_LABELS[status]}
        </span>
        <span className="text-[10px] text-gray-500 border border-gray-200 rounded-[2px] px-1.5 py-0.5 font-semibold">
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
            />
          ))
        )}
      </div>
    </div>
  )
}

export const DashboardPage: React.FC = () => {
  const { hasRole, user } = useAuth()
  const queryClient = useQueryClient()
  const canDrag = hasRole('admin', 'mzk_manager')
  const isAdmin = hasRole('admin')
  const canSelectStudents = hasRole('admin', 'mentor', 'mzk_manager')
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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // На тачскринах drag стартует после долгого нажатия, чтобы не мешать прокрутке
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  )

  const { data: students = [], isLoading } = useQuery({
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

  const { data: assignmentUsers = [] } = useQuery({
    queryKey: ['dashboard', 'assignment-users'],
    queryFn: () => usersApi.list(),
    enabled: isAdmin,
  })
  const availableAssignees = assignmentUsers.filter(
    (candidate) => candidate.is_active && ['mentor', 'mzk_manager'].includes(candidate.role)
  )
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

  const assignSelectedMutation = useMutation({
    mutationFn: async ({ studentIds, assigneeId }: { studentIds: string[]; assigneeId?: string }) => {
      if (isAdmin) {
        if (!assigneeId) throw new Error('Выберите ментора или менеджера')
        await Promise.all(studentIds.map((studentId) => mentorAssignmentsApi.create(studentId, {
          mentor_id: assigneeId,
          role: 'lead',
          is_active: true,
        })))
        return
      }
      await Promise.all(studentIds.map((studentId) => mentorAssignmentsApi.assignSelf(studentId)))
    },
    onSuccess: (_, variables) => {
      setSelectedIds(new Set())
      setSelectionMode(false)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      toast({
        title: isAdmin ? 'Ответственный назначен' : 'Студенты добавлены в «Мои»',
        description: `Назначено: ${variables.studentIds.length}`,
      })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось назначить студентов',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
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

  const grouped = useMemo(() => {
    const map: Record<PipelineStatus, StudentListItem[]> = {} as Record<
      PipelineStatus,
      StudentListItem[]
    >
    for (const col of PIPELINE_COLUMNS) {
      map[col] = []
    }
    for (const s of filteredStudents) {
      const status = s.pipeline_status ?? 'no_status'
      if (map[status]) {
        map[status].push(s)
      } else {
        map['no_status'].push(s)
      }
    }
    return map
  }, [filteredStudents])

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
    const overColumnStatus = (PIPELINE_COLUMNS.includes(overId as PipelineStatus)
      ? overId
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <CrmPageHeader
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
        <div className="mb-4 flex flex-col gap-3 rounded-[2px] border border-brand/35 bg-brand/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Выбрано: {selectedIds.size}</div>
            <p className="mt-0.5 text-xs text-gray-500">Студенты с отметкой «Уже мой» повторно не назначаются.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {isAdmin && (
              <Select
                value={targetUserId || 'none'}
                onValueChange={(value) => {
                  setTargetUserId(value === 'none' ? '' : value)
                  setSelectedIds(new Set())
                }}
              >
                <SelectTrigger className="h-9 w-full text-xs sm:w-56">
                  <SelectValue placeholder="Ментор или менеджер" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Выберите ответственного</SelectItem>
                  {availableAssignees.map((assignee) => (
                    <SelectItem key={assignee.id} value={assignee.id}>
                      {assignee.name} · {assignee.role === 'mentor' ? 'ментор' : 'менеджер'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || assignSelectedMutation.isPending || (isAdmin && !targetUserId)}
              onClick={() => assignSelectedMutation.mutate({
                studentIds: Array.from(selectedIds),
                assigneeId: isAdmin ? targetUserId : user?.id,
              })}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              {assignSelectedMutation.isPending ? 'Добавляем…' : isAdmin ? 'Назначить выбранных' : 'Добавить в мои'}
            </Button>
          </div>
        </div>
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
            className="text-xs text-gray-600 hover:text-black font-medium px-2 py-1 underline underline-offset-4 transition-colors"
            onClick={() => { setMentorFilter(''); setMzkFilter(''); setCountryFilter(''); setIntakeYearFilter('') }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Kanban board */}
      <div className="kanban-container flex-1">
        {canDrag && !selectionMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {PIPELINE_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                students={grouped[status] ?? []}
                canDrag={canDrag && !selectionMode}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                assignedIds={assignedIds}
                onToggleSelected={toggleSelected}
              />
            ))}
            <DragOverlay>
              {activeStudent ? (
                <StudentCard student={activeStudent} />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          PIPELINE_COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              students={grouped[status] ?? []}
              canDrag={false}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              assignedIds={assignedIds}
              onToggleSelected={toggleSelected}
            />
          ))
        )}
      </div>
    </div>
  )
}
