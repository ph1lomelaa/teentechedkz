import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { mentorAssignmentsApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import { ASSIGNABLE_MENTOR_ROLES, AssignmentBoard, MENTOR_ROLE_LABELS } from '@/types'
import { PageHeader, SegmentedTabs } from '@/components/ui'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { DistributionBoard } from '@/components/students/DistributionBoard'
import { ReplacementReasonDialog } from '@/components/students/ReplacementReasonDialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

const DEFAULT_ROLE = 'mzk'

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
          {data && (
            <span className="whitespace-nowrap text-xs text-p-muted">
              {data.totals.students} студентов ·{' '}
              <span className={data.totals.unassigned > 0 ? 'font-medium text-p-accent' : undefined}>
                {data.totals.unassigned} без «{roleLabel}»
              </span>
            </span>
          )}
        </div>
      </div>

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
            canDrag={canDrag}
            onMove={(move) =>
              assignMutation.mutate({ studentId: move.studentId, mentorId: move.to })
            }
          />
        )}
      </QueryState>

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
