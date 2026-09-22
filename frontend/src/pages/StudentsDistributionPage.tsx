import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { mentorAssignmentsApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import {
  ASSIGNABLE_MENTOR_ROLES,
  AssignmentBoard,
  BoardStudent,
  MENTOR_ROLE_LABELS,
  PIPELINE_COLUMNS,
  PIPELINE_STATUS_LABELS,
} from '@/types'
import { PageHeader, SegmentedTabs } from '@/components/ui'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { FilterField, FilterPopover } from '@/components/shared/FilterPopover'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import {
  BoardCardAction,
  DistributionBoard,
  UNASSIGNED_COLUMN,
  boardStatusKey,
} from '@/components/students/DistributionBoard'
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

  const roleParam = searchParams.get('role') || DEFAULT_ROLE
  const role = ASSIGNABLE_MENTOR_ROLES.includes(roleParam as (typeof ASSIGNABLE_MENTOR_ROLES)[number])
    ? roleParam
    : DEFAULT_ROLE

  const setRole = (next: string) => {
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
    to: string
    fromUnassigned: boolean
  } | null>(null)

  const assignMutation = useMutation({
    mutationFn: (vars: { studentId: string; mentorId: string; reason?: string }) =>
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
        setPendingMove({ studentId: vars.studentId, to: vars.mentorId, fromUnassigned: false })
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

  // Снятие ответственного: бросок в «Без ответственного» или «Снять» в меню
  // карточки. Сначала причина — отмена диалога ничего не меняет.
  const [pendingUnassign, setPendingUnassign] = useState<{
    assignmentId: string
    studentName: string
    staffName: string | null
  } | null>(null)

  const unassignMutation = useMutation({
    mutationFn: (vars: { assignmentId: string; reason: string }) =>
      mentorAssignmentsApi.unassign(vars.assignmentId, vars.reason),
    onSuccess: () => {
      setPendingUnassign(null)
      qc.invalidateQueries({ queryKey: ['assignment-board'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Ответственный снят' })
    },
    onError: (err) => {
      setPendingUnassign(null)
      toast({ title: 'Не удалось снять', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  // «Передать…» / «Назначить…» из меню карточки — выбор сотрудника вместо броска.
  const [transferFor, setTransferFor] = useState<{ studentId: string; studentName: string; from: string } | null>(null)
  const [transferTo, setTransferTo] = useState('')

  const askUnassign = (studentId: string, from: string) => {
    const column = data?.columns.find((c) => c.staff_id === from)
    const student = column?.students.find((s) => s.id === studentId)
    if (!student?.assignment_id) return
    setPendingUnassign({
      assignmentId: student.assignment_id,
      studentName: student.full_name,
      staffName: column?.name ?? null,
    })
  }

  const handleCardAction = (action: BoardCardAction) => {
    if (action.type === 'unassign') {
      askUnassign(action.student.id, action.from)
      return
    }
    setTransferTo('')
    setTransferFor({ studentId: action.student.id, studentName: action.student.full_name, from: action.from })
  }

  const roleTabs = useMemo(
    () =>
      ASSIGNABLE_MENTOR_ROLES.map((value) => ({
        value,
        label: MENTOR_ROLE_LABELS[value] ?? value,
      })),
    [],
  )

  const targetName = useMemo(() => {
    if (!pendingMove || !data) return null
    return data.columns.find((c) => c.staff_id === pendingMove.to)?.name ?? null
  }, [pendingMove, data])

  const roleLabel = MENTOR_ROLE_LABELS[role] ?? role

  // Сводка — по тем, кто прошёл фильтр статуса: иначе «120 без МЗК» при
  // пяти видимых карточках читалось бы как ошибка доски.
  const summary = useMemo(() => {
    if (!data) return null
    const shown = (list: BoardStudent[]) => list.filter((s) => statuses.has(boardStatusKey(s))).length
    const unassigned = shown(data.unassigned)
    const assigned = data.columns.reduce((sum, c) => sum + shown(c.students), 0)
    return { students: assigned + unassigned, unassigned }
  }, [data, statuses])

  return (
    <div>
      <PageHeader
        colorPrefix="p"
        eyebrow="Студенты"
        title="Распределение"
        description={
          canDrag
            ? 'Кто из сотрудников ведёт каких студентов. Перетащите карточку, чтобы передать студента другому.'
            : 'Кто из сотрудников ведёт каких студентов.'
        }
        action={
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <Link to="/students">
              <ArrowLeft className="h-3.5 w-3.5" />
              К общей базе
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs colorPrefix="p" tabs={roleTabs} value={role} onChange={setRole} />
        <div className="flex items-center gap-3">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-p-muted2" />
            <Input
              placeholder="Поиск студента..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <FilterPopover
            activeCount={isDefaultStatuses ? 0 : statuses.size}
            onReset={() => setStatuses(new Set(DEFAULT_BOARD_STATUSES))}
          >
            <FilterField label="Статус студента">
              <div className="space-y-1.5">
                {PIPELINE_COLUMNS.map((status) => (
                  <label key={status} className="flex cursor-pointer items-center gap-2 text-sm text-p-text">
                    <Checkbox checked={statuses.has(status)} onCheckedChange={() => toggleStatus(status)} />
                    {PIPELINE_STATUS_LABELS[status]}
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
        </div>
      </div>

      {/* Отдельной строкой над колонками: в тулбаре счётчик терялся между
          поиском и фильтром, а относится он к доске, а не к ним. */}
      {summary && (
        <div className="mb-2 text-xs text-p-muted">
          {summary.students} студентов ·{' '}
          <span className={summary.unassigned > 0 ? 'font-medium text-p-accent' : undefined}>
            {summary.unassigned} без «{roleLabel}»
          </span>
        </div>
      )}

      <QueryState
        colorPrefix="p"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        skeletonRows={6}
      >
        {data && (
          <DistributionBoard
            board={data as AssignmentBoard}
            search={search}
            statuses={statuses}
            canDrag={canDrag}
            onMove={(move) =>
              move.to === UNASSIGNED_COLUMN
                ? askUnassign(move.studentId, move.from)
                : assignMutation.mutate({ studentId: move.studentId, mentorId: move.to })
            }
            onCardAction={handleCardAction}
          />
        )}
      </QueryState>

      <ReplacementReasonDialog
        mode="unassign"
        studentCount={pendingUnassign ? 1 : null}
        currentName={pendingUnassign?.staffName}
        isPending={unassignMutation.isPending}
        onCancel={() => setPendingUnassign(null)}
        onConfirm={(reason) =>
          pendingUnassign && unassignMutation.mutate({ assignmentId: pendingUnassign.assignmentId, reason })
        }
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
                // Тот же путь, что у броска: если нужна причина замены,
                // assignMutation сам переспросит её диалогом ниже.
                assignMutation.mutate({ studentId: transferFor.studentId, mentorId: transferTo })
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
        isPending={assignMutation.isPending}
        onCancel={() => setPendingMove(null)}
        onConfirm={(reason) =>
          pendingMove &&
          assignMutation.mutate({ studentId: pendingMove.studentId, mentorId: pendingMove.to, reason })
        }
      />
    </div>
  )
}
