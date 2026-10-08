import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { mentorAssignmentsApi, usersApi } from '@/api/index'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import {
  ASSIGNABLE_MENTOR_ROLES,
  DEGREE_LEVEL_LABELS,
  MULTI_MENTOR_ROLES,
  MENTOR_ROLE_LABELS,
  PIPELINE_COLUMNS,
  PIPELINE_STATUS_LABELS,
} from '@/types'
import { PageHeader } from '@/components/ui'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { FilterChips, FilterField, FilterPopover } from '@/components/shared/FilterPopover'
import { PipelineStatusTag } from '@/components/shared/PipelineStatusFilter'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import { UNASSIGNED_COLUMN } from '@/components/students/DistributionBoard'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { ReplacementReasonDialog } from '@/components/students/ReplacementReasonDialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { groupDistributionRows, uniqueBoardRows } from '@/components/students/distribution/listModel'
import { DistributionListView } from '@/components/students/distribution/DistributionListView'

const DEFAULT_ROLE = 'mzk'

/**
 * Статусы доски по умолчанию — только «Активная работа».
 *
 * Без фильтра колонка «Без ответственного» состояла в основном из тех, с кем
 * уже не работают (передумали, возврат, подвешено), и настоящих
 * нераспределённых в ней было не найти. Остальные статусы — через фильтр.
 */
export const DEFAULT_BOARD_STATUSES: readonly string[] = ['active_work']

/**
 * Статусы из URL. Параметра нет — значение по умолчанию; пустой параметр —
 * пустой выбор (человек снял все галочки, и это не то же самое, что «сброс»).
 */
/** Множество из CSV-параметра адреса. Пусто — «не ограничивать». */
export function parseCsvSet(param: string | null): Set<string> {
  return new Set((param || '').split(',').filter(Boolean))
}

export function parseBoardStatuses(param: string | null): Set<string> {
  if (param === null) return new Set(DEFAULT_BOARD_STATUSES)
  return new Set(param.split(',').filter((v) => (PIPELINE_COLUMNS as string[]).includes(v)))
}

/**
 * Доска распределения: кто из сотрудников ведёт каких студентов.
 *
 * Зачем страница
 * --------------
 * Назначать ответственных умели и раньше — из общей базы и из карточки. Не было
 * обратного вопроса: кому уже назначено. Фильтр отвечает про одного человека за
 * раз, поэтому после распределения набора картинка «разъезжалась» и выглядело
 * так, будто назначения не сохранились.
 *
 * Почему отдельная страница, а не блок в базе: доске нужна вся ширина экрана,
 * и на неё удобно дать ссылку (роль и так в URL).
 *
 * Почему одна роль за раз: у студента ответственных несколько, а на доске
 * «колонка = сотрудник» карточка не может лежать в двух колонках. Роль — часть
 * запроса, а не фильтр поверх общего ответа.
 */
export const StudentsDistributionPage: React.FC = () => {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const view = 'list'
  const [listScope, setListScope] = useState<'unassigned' | 'all'>('unassigned')
  const [staffFilter, setStaffFilter] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<'year' | 'country' | 'status'>('year')
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null)
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [bulkTarget, setBulkTarget] = useState('')
  const [pendingBulk, setPendingBulk] = useState<{ studentIds: string[]; mentorId: string } | null>(null)

  const roleParam = searchParams.get('role') || DEFAULT_ROLE
  const role = ASSIGNABLE_MENTOR_ROLES.includes(roleParam as (typeof ASSIGNABLE_MENTOR_ROLES)[number])
    ? roleParam
    : DEFAULT_ROLE

  // В мультироли ответственных несколько, и это меняет смысл перетаскивания:
  // не «назначить вместо», а «перенести это назначение».
  const isMultiRole = MULTI_MENTOR_ROLES.includes(role)

  const setRole = (next: string) => {
    setSelectionMode(false)
    setBulkTarget('')
    setSelected(new Set())
    setPendingBulk(null)
    setStaffFilter(null)
    setListScope('unassigned')
    setExpandedGroups(null)
    setGroupLimits({})
    const params = new URLSearchParams(searchParams)
    params.set('role', next)
    setSearchParams(params, { replace: true })
  }

  // Фильтр живёт в URL, как и роль: ссылкой на доску можно поделиться, и
  // после перезагрузки выбор не слетает обратно к умолчанию.
  const statusParam = searchParams.get('status')
  const statuses = useMemo(() => parseBoardStatuses(statusParam), [statusParam])
  const isDefaultStatuses =
    statuses.size === DEFAULT_BOARD_STATUSES.length &&
    DEFAULT_BOARD_STATUSES.every((s) => statuses.has(s))

  const setStatuses = (next: Set<string>) => {
    const params = new URLSearchParams(searchParams)
    const isDefault =
      next.size === DEFAULT_BOARD_STATUSES.length && DEFAULT_BOARD_STATUSES.every((s) => next.has(s))
    if (isDefault) params.delete('status')
    else params.set('status', PIPELINE_COLUMNS.filter((s) => next.has(s)).join(','))
    setSearchParams(params, { replace: true })
    setSelected(new Set())
    setPendingBulk(null)
    setExpandedGroups(null)
  }

  // Год, ступень и страна — та же механика, что у статусов: множество в URL,
  // чтобы ссылкой на отфильтрованную доску можно было поделиться. Отличие одно:
  // умолчания нет, пустой выбор означает «все».
  const setParam = (key: string, next: Set<string>) => {
    const params = new URLSearchParams(searchParams)
    if (next.size === 0) params.delete(key)
    else params.set(key, [...next].sort().join(','))
    setSearchParams(params, { replace: true })
    setSelected(new Set())
    setPendingBulk(null)
    setExpandedGroups(null)
  }

  const years = useMemo(() => parseCsvSet(searchParams.get('year')), [searchParams])
  const degrees = useMemo(() => parseCsvSet(searchParams.get('degree')), [searchParams])
  const countries = useMemo(() => parseCsvSet(searchParams.get('country')), [searchParams])
  const leadMentorId = searchParams.get('lead_mentor_id') || ''

  const filters = useMemo(
    () => ({ statuses, years, degrees, countries }),
    [statuses, years, degrees, countries],
  )

  // Опции — только то, что есть в данных, со счётчиками. Тот же справочник, что
  // питает фильтры общей базы.
  const { data: facets } = useQuery({
    queryKey: ['students', 'facets'],
    queryFn: studentsApi.facets,
    staleTime: 60_000,
  })
  const { data: leadMentorUsers = [] } = useQuery({
    queryKey: ['users', 'distribution-lead-mentors'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })
  const { data: leadMentorStudents = [] } = useQuery({
    queryKey: ['students', 'distribution-lead-mentor', leadMentorId],
    queryFn: () => studentsApi.getAll({ lead_mentor_id: leadMentorId }),
    enabled: Boolean(leadMentorId),
  })
  const leadMentorStudentIds = useMemo(() => new Set(leadMentorStudents.map((student) => student.id)), [leadMentorStudents])

  const resetFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('status')
    for (const key of ['year', 'degree', 'country', 'lead_mentor_id']) params.delete(key)
    setSearchParams(params, { replace: true })
    setSelected(new Set())
    setPendingBulk(null)
    setExpandedGroups(null)
  }

  const toggleStatus = (status: string) => {
    const next = new Set(statuses)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    setStatuses(next)
  }

  // Смотреть доску может управление, а передавать студентов — тот, кто и так
  // может назначать. Это два разных права, и совпадать они не обязаны.
  const canDrag = can('mentor_assignments', 'manage')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assignment-board', role],
    queryFn: () => mentorAssignmentsApi.board({ role }),
  })

  // Передача студента другому сотруднику — это замена, и бэкенд требует
  // причину. Карточку не двигаем, пока причина не подтверждена: иначе отмена
  // диалога оставила бы доску в состоянии, которого нет в базе.
  const [pendingMove, setPendingMove] = useState<{
    studentId: string
    /** Назначение, которое переносим. null — студент был без ответственного. */
    assignmentId: string | null
    to: string
    fromUnassigned: boolean
  } | null>(null)
  const [pendingUnassign, setPendingUnassign] = useState<{ assignmentId: string; staffName: string } | null>(null)

  const assignMutation = useMutation({
    mutationFn: (vars: { studentId: string; assignmentId?: string | null; mentorId: string; reason?: string }) =>
      mentorAssignmentsApi.bulkAssign({
        student_ids: [vars.studentId],
        mentor_id: vars.mentorId,
        role,
        replacement_reason: vars.reason,
      }),
    onSuccess: (res, vars) => {
      const needsReason = res.skipped.some((s) => s.reason === 'needs_reason')
      if (needsReason) {
        // Студент уже кому-то назначен — спрашиваем причину и повторяем.
        setPendingMove({
          studentId: vars.studentId,
          assignmentId: vars.assignmentId ?? null,
          to: vars.mentorId,
          fromUnassigned: false,
        })
        return
      }

      setPendingMove(null)
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })

      if (res.already > 0) {
        toast({ title: 'Студент уже назначен этому сотруднику' })
        return
      }
      toast({
        title: res.replaced > 0 ? 'Ответственный заменён' : 'Студент передан',
        description:
          res.assignment_status === 'awaiting_signature'
            ? 'Специалист ещё не подписал регламент — назначение ждёт подписи.'
            : undefined,
      })
    },
    onError: (err) => {
      setPendingMove(null)
      toast({ title: 'Не удалось передать', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const bulkMutation = useMutation({
    mutationFn: (vars: { studentIds: string[]; mentorId: string; reason?: string }) => mentorAssignmentsApi.bulkAssign({
      student_ids: vars.studentIds, mentor_id: vars.mentorId, role, replacement_reason: vars.reason,
    }),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      const needsReason = result.skipped.filter((item) => item.reason === 'needs_reason').map((item) => item.student_id)
      setSelected(new Set(needsReason))
      setPendingBulk(needsReason.length && !vars.reason ? { studentIds: needsReason, mentorId: vars.mentorId } : null)
      toast({
        title: `Назначено: ${result.assigned}, заменено: ${result.replaced}`,
        description: `${result.already} уже были назначены · ${result.skipped.length} пропущено.${result.assignment_status === 'awaiting_signature' ? ' Назначения ждут подписи специалиста.' : ''}`,
      })
      if (result.skipped.length && !needsReason.length) toast({ title: `Не назначено: ${result.skipped.length}`, description: 'Проверьте причины в общей базе.', variant: 'destructive' })
    },
    onError: (err) => toast({ title: 'Не удалось назначить', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const unassignMutation = useMutation({
    mutationFn: (vars: { assignmentId: string; reason: string }) => mentorAssignmentsApi.unassign(vars.assignmentId, vars.reason),
    onSuccess: () => {
      setPendingUnassign(null)
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Ответственный снят' })
    },
    onError: (err) => toast({ title: 'Не удалось снять', description: getErrorMessage(err), variant: 'destructive' }),
  })

  // Перенос в мультироли — правка конкретного назначения, а не пересборка
  // роли. `bulkAssign` там добавил бы второго и оставил первого на месте, то
  // есть перетаскивание «удваивало» бы ответственных вместо переноса.
  const transferMutation = useMutation({
    mutationFn: (vars: { assignmentId: string; mentorId: string; reason: string }) =>
      mentorAssignmentsApi.replaceMentor(vars.assignmentId, vars.mentorId, vars.reason),
    onSuccess: () => {
      setPendingMove(null)
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Ответственный заменён' })
    },
    onError: (err) => {
      setPendingMove(null)
      toast({ title: 'Не удалось передать', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  // «Передать…» / «Назначить…» из меню карточки — выбор сотрудника вместо броска.
  const [transferFor, setTransferFor] = useState<{ studentId: string; studentName: string; from: string } | null>(null)
  const [transferTo, setTransferTo] = useState('')

  const targetName = useMemo(() => {
    if (!pendingMove || !data) return null
    return data.columns.find((c) => c.staff_id === pendingMove.to)?.name ?? null
  }, [pendingMove, data])

  const roleLabel = MENTOR_ROLE_LABELS[role] ?? role

  const baseRows = useMemo(() => data ? uniqueBoardRows(data, filters, search) : [], [data, filters, search])
  const filteredRows = useMemo(() => baseRows.filter((row) => !leadMentorId || leadMentorStudentIds.has(row.student.id)), [baseRows, leadMentorId, leadMentorStudentIds])
  const listRows = useMemo(() => filteredRows.filter((row) => {
    if (staffFilter) return row.assignments.some((assignment) => assignment.staffId === staffFilter)
    return listScope === 'all' || row.assignments.length === 0
  }), [filteredRows, listScope, staffFilter])
  const groups = useMemo(() => groupDistributionRows(listRows, groupBy), [listRows, groupBy])
  const openGroups = useMemo(() => {
    if (expandedGroups !== null) return expandedGroups
    if (search.trim() || staffFilter) return new Set(groups.map((group) => group.key))
    return new Set(groups.length ? [groups[0].key] : [])
  }, [expandedGroups, groups, search, staffFilter])
  const selectedVisible = listRows.filter((row) => row.assignments.length === 0 && selected.has(row.student.id)).map((row) => row.student.id)
  const summary = { students: filteredRows.length, unassigned: filteredRows.filter((row) => row.assignments.length === 0).length }
  const staffCounts = useMemo(() => new Map((data?.columns ?? []).map((column) => [
    column.staff_id,
    filteredRows.filter((row) => row.assignments.some((assignment) => assignment.staffId === column.staff_id)).length,
  ])), [filteredRows, data])
  const chooseScope = (scope: 'unassigned' | 'all', staff: string | null = null) => {
    setListScope(scope)
    setStaffFilter(staff)
    setSelected(new Set())
    setPendingBulk(null)
    setExpandedGroups(null)
    setGroupLimits({})
  }
  const toggleGroup = (key: string) => {
    const next = new Set(openGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedGroups(next)
  }
  const filterChips = [
    ...(!isDefaultStatuses ? [{
      key: 'status',
      label: `Статус: ${[...statuses].map((status) => PIPELINE_STATUS_LABELS[status as keyof typeof PIPELINE_STATUS_LABELS] ?? status).join(', ') || 'не выбран'}`,
      onRemove: () => setStatuses(new Set(DEFAULT_BOARD_STATUSES)),
    }] : []),
    ...(years.size ? [{ key: 'year', label: `Набор: ${[...years].join(', ')}`, onRemove: () => setParam('year', new Set()) }] : []),
    ...(degrees.size ? [{ key: 'degree', label: `Ступень: ${[...degrees].map((degree) => DEGREE_LEVEL_LABELS[degree as keyof typeof DEGREE_LEVEL_LABELS] ?? degree).join(', ')}`, onRemove: () => setParam('degree', new Set()) }] : []),
    ...(countries.size ? [{ key: 'country', label: `Страна: ${[...countries].join(', ')}`, onRemove: () => setParam('country', new Set()) }] : []),
    ...(leadMentorId ? [{ key: 'lead-mentor', label: `Lead-Mentor: ${leadMentorUsers.find((user) => user.id === leadMentorId)?.name ?? 'выбран'}`, onRemove: () => { const params = new URLSearchParams(searchParams); params.delete('lead_mentor_id'); setSearchParams(params, { replace: true }); setSelected(new Set()) } }] : []),
  ]

  return (
    <div className="min-w-0">
      <Link to="/students" className="mb-4 inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-p-muted hover:text-p-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent">
        <ArrowLeft className="h-4 w-4" /> К общей базе
      </Link>
      <PageHeader
        colorPrefix="p"
        eyebrow="Студенты в работе"
        title="Распределение"
        description={
          <>
            {view === 'list' ? listRows.length : summary.students} студентов {view === 'list' ? 'в списке' : 'на доске'} · {summary.unassigned} без «{roleLabel}» по общим фильтрам
            {data?.notion_reconciliation && <>
              {' · '}
              <Link to="/students?notion=1" className="font-semibold text-p-accent-text underline underline-offset-2">
                {data.notion_reconciliation.active_unlinked_rows} строк Notion без связи
              </Link>
            </>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-p-line">
        <nav aria-label="Роль распределения" className="flex max-w-full gap-1 overflow-x-auto">
          {ASSIGNABLE_MENTOR_ROLES.map((value) => <button
            type="button"
            aria-current={role === value ? 'page' : undefined}
            key={value}
            onClick={() => setRole(value)}
            className={`min-h-10 shrink-0 border-b-2 px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent ${role === value ? 'border-p-accent text-p-text' : 'border-transparent text-p-muted hover:text-p-text'}`}
          >{MENTOR_ROLE_LABELS[value] ?? value}</button>)}
        </nav>
        {/* Распределение теперь открывает сгруппированный список сразу. */}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
          <Input
            placeholder="Найти студента"
            aria-label="Найти студента"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); setPendingBulk(null); setExpandedGroups(null) }}
            className="h-9 pl-9 text-sm"
          />
        </div>
        {view === 'list' && <>
          <Select value={staffFilter ?? 'all'} onValueChange={(value) => chooseScope('all', value === 'all' ? null : value)}>
            <SelectTrigger className="h-9 w-[190px] bg-p-panel"><SelectValue placeholder="Ответственный" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{roleLabel}: все</SelectItem>
              {data?.columns.map((column) => <SelectItem key={column.staff_id} value={column.staff_id}>{column.name} · ведёт {staffCounts.get(column.staff_id) ?? 0}</SelectItem>)}
            </SelectContent>
          </Select>
          {!staffFilter && <button type="button" onClick={() => chooseScope(listScope === 'unassigned' ? 'all' : 'unassigned')} className={`min-h-9 rounded-ctl border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent ${listScope === 'unassigned' ? 'border-p-accent-dim bg-p-chip text-p-chip-text' : 'border-dashed border-p-line bg-p-panel text-p-muted'}`}>
            {listScope === 'unassigned' ? `Только без «${roleLabel}» ×` : `Только без «${roleLabel}»`}
          </button>}
        </>}
        <Select value={years.size === 1 ? [...years][0] : 'all'} onValueChange={(v) => setParam('year', v === 'all' ? new Set() : new Set([v]))}>
          <SelectTrigger aria-label="Набор" className="h-9 w-auto min-w-24 bg-p-panel text-xs"><SelectValue placeholder="Набор" /></SelectTrigger><SelectContent><SelectItem value="all">Набор</SelectItem>{(facets?.years ?? []).map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={leadMentorId || 'all'} onValueChange={(v) => { const params = new URLSearchParams(searchParams); v === 'all' ? params.delete('lead_mentor_id') : params.set('lead_mentor_id', v); setSearchParams(params, { replace: true }); setSelected(new Set()); setExpandedGroups(null) }}>
          <SelectTrigger aria-label="Lead-Mentor" className="h-9 w-auto min-w-32 bg-p-panel text-xs"><SelectValue placeholder="Lead-Mentor" /></SelectTrigger><SelectContent><SelectItem value="all">Lead-Mentor</SelectItem>{leadMentorUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={degrees.size === 1 ? [...degrees][0] : 'all'} onValueChange={(v) => setParam('degree', v === 'all' ? new Set() : new Set([v]))}>
          <SelectTrigger aria-label="Ступень" className="h-9 w-auto min-w-24 bg-p-panel text-xs"><SelectValue placeholder="Ступень" /></SelectTrigger><SelectContent><SelectItem value="all">Ступень</SelectItem>{(facets?.degrees ?? []).map((opt) => <SelectItem key={opt.value} value={opt.value}>{DEGREE_LEVEL_LABELS[opt.value as keyof typeof DEGREE_LEVEL_LABELS] ?? opt.value}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={countries.size === 1 ? [...countries][0] : 'all'} onValueChange={(v) => setParam('country', v === 'all' ? new Set() : new Set([v]))}>
          <SelectTrigger aria-label="Страна" className="h-9 w-auto min-w-24 bg-p-panel text-xs"><SelectValue placeholder="Страна" /></SelectTrigger><SelectContent><SelectItem value="all">Страна</SelectItem>{(facets?.countries ?? []).map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.value}</SelectItem>)}</SelectContent>
        </Select>
          <FilterPopover activeCount={isDefaultStatuses ? 0 : 1} onReset={() => setStatuses(new Set(DEFAULT_BOARD_STATUSES))} buttonLabel="+ Фильтр">
            <FilterField label="Статус">
              <div className="space-y-1.5">
                {PIPELINE_COLUMNS.map((status) => (
                  <label key={status} className="flex cursor-pointer items-center gap-2 text-sm text-p-text">
                    <Checkbox checked={statuses.has(status)} onCheckedChange={() => toggleStatus(status)} />
                    <PipelineStatusTag status={status} />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="text-[12px] text-p-muted underline underline-offset-4 hover:text-black"
                onClick={() => setStatuses(new Set(PIPELINE_COLUMNS))}
              >
                Выбрать все
              </button>
            </FilterField>

          </FilterPopover>
        {canDrag && <Button type="button" variant="outline" size="sm" aria-pressed={selectionMode} onClick={() => {
          setSelectionMode(!selectionMode)
          setSelected(new Set())
          setBulkTarget('')
          setPendingBulk(null)
        }}>{selectionMode ? 'Выйти из выбора' : 'Выбрать студентов'}</Button>}
        {view === 'list' && <div className="ml-auto flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1 text-p-muted">Группировка</span>
          {([['year', 'Набор'], ['country', 'Страна'], ['status', 'Статус']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { setGroupBy(value); setExpandedGroups(null); setGroupLimits({}); setSelected(new Set()); setPendingBulk(null) }} className={`min-h-9 rounded-ctl px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent ${groupBy === value ? 'bg-p-panel text-p-text shadow-sm' : 'text-p-muted'}`}>{label}</button>)}
        </div>}
      </div>
      {filterChips.length > 0 && <div className="mb-4"><FilterChips chips={filterChips} onResetAll={resetFilters} /></div>}

      <QueryState
        colorPrefix="p"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        skeletonRows={6}
      >
        {data && view === 'list' && <DistributionListView
          board={data}
          roleLabel={roleLabel}
          canAssign={canDrag}
          selectionMode={selectionMode}
          rows={listRows}
          groups={groups}
          openGroups={openGroups}
          groupLimits={groupLimits}
          selected={selected}
          selectedVisible={selectedVisible}
          bulkTarget={bulkTarget}
          bulkPending={bulkMutation.isPending}
          staffFilter={staffFilter}
          listScope={listScope}
          staffCounts={staffCounts}
          unassignedCount={summary.unassigned}
          searchActive={Boolean(search.trim())}
          onToggleGroup={toggleGroup}
          onExpandAll={() => setExpandedGroups(new Set(groups.map((group) => group.key)))}
          onCollapseAll={() => setExpandedGroups(new Set())}
          onShowMore={(key, next) => setGroupLimits((current) => ({ ...current, [key]: next }))}
          onToggleSelection={(ids, checked) => setSelected((current) => { const next = new Set(current); ids.forEach((id) => checked ? next.add(id) : next.delete(id)); return next })}
          onClearSelection={() => setSelected(new Set())}
          onTargetChange={setBulkTarget}
          onBulkAssign={() => bulkMutation.mutate({ studentIds: selectedVisible, mentorId: bulkTarget })}
          onChooseScope={chooseScope}
          onSingleAssign={(studentId, studentName, from) => { setTransferTo(''); setTransferFor({ studentId, studentName, from }) }}
          onUnassign={(assignmentId, staffName) => setPendingUnassign({ assignmentId, staffName })}
        />}
      </QueryState>

      <ReplacementReasonDialog
        studentCount={pendingBulk?.studentIds.length ?? null}
        targetName={data?.columns.find((column) => column.staff_id === pendingBulk?.mentorId)?.name ?? null}
        isPending={bulkMutation.isPending}
        onCancel={() => { setPendingBulk(null); setSelected(new Set()) }}
        onConfirm={(reason) => pendingBulk && bulkMutation.mutate({ ...pendingBulk, reason })}
      />

      <ReplacementReasonDialog
        mode="unassign"
        studentCount={pendingUnassign ? 1 : null}
        currentName={pendingUnassign?.staffName}
        isPending={unassignMutation.isPending}
        onCancel={() => setPendingUnassign(null)}
        onConfirm={(reason) => pendingUnassign && unassignMutation.mutate({ assignmentId: pendingUnassign.assignmentId, reason })}
      />

      <Dialog open={Boolean(transferFor)} onOpenChange={(open) => !open && setTransferFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {transferFor?.from === UNASSIGNED_COLUMN ? 'Назначить' : 'Передать'}: «{roleLabel}»
            </DialogTitle>
            <DialogDescription>{transferFor?.studentName}</DialogDescription>
          </DialogHeader>
          <Select value={transferTo} onValueChange={setTransferTo}>
            <SelectTrigger>
              <SelectValue placeholder="Кому" />
            </SelectTrigger>
            <SelectContent>
              {data?.columns
                .filter((c) => c.staff_id !== transferFor?.from)
                .map((c) => (
                  <SelectItem key={c.staff_id} value={c.staff_id}>
                    {c.name} · {c.students.length}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferFor(null)}>
              Отмена
            </Button>
            <Button
              disabled={!transferTo || assignMutation.isPending}
              onClick={() => {
                if (!transferFor) return
                const assignmentId = data?.columns.find((column) => column.staff_id === transferFor.from)
                  ?.students.find((student) => student.id === transferFor.studentId)?.assignment_id
                if (isMultiRole && assignmentId) {
                  setPendingMove({ studentId: transferFor.studentId, assignmentId, to: transferTo, fromUnassigned: false })
                } else {
                  assignMutation.mutate({ studentId: transferFor.studentId, mentorId: transferTo, assignmentId })
                }
                setTransferFor(null)
              }}
            >
              {transferFor?.from === UNASSIGNED_COLUMN ? 'Назначить' : 'Передать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReplacementReasonDialog
        studentCount={pendingMove ? 1 : null}
        targetName={targetName}
        isPending={assignMutation.isPending || transferMutation.isPending}
        onCancel={() => setPendingMove(null)}
        onConfirm={(reason) => {
          if (!pendingMove) return
          // В мультироли меняем ровно ту строку, которую тащили; в одиночной
          // назначение на занятую роль и есть замена, там путь прежний.
          if (isMultiRole && pendingMove.assignmentId) {
            transferMutation.mutate({
              assignmentId: pendingMove.assignmentId,
              mentorId: pendingMove.to,
              reason,
            })
            return
          }
          assignMutation.mutate({
            studentId: pendingMove.studentId,
            assignmentId: pendingMove.assignmentId,
            mentorId: pendingMove.to,
            reason,
          })
        }}
      />
    </div>
  )
}
