import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, History, Repeat, UserMinus, UserPlus } from 'lucide-react'
import { mentorAssignmentsApi } from '@/api/index'
import {
  ASSIGNABLE_MENTOR_ROLES,
  MENTOR_ROLE_LABELS,
  ROLE_USER_SOURCE,
  ResponsibleUser,
  User,
  splitAssignCandidates,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
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
import { invalidateStudent } from '@/lib/queryKeys'
import { formatDate } from '@/lib/utils'

/** Роли, без которых команда не считается собранной (как team_readiness на бэкенде). */
const REQUIRED_ROLES = new Set(['career', 'ielts', 'lead', 'country'])

/** Порядок строк: МЗК ведёт студента целиком — первым. */
const ROLE_ORDER = ['mzk', 'lead', 'career', 'ielts', 'country'] as const

/**
 * «Команда ученика»: по строке на роль, у каждой — назначить, заменить, снять.
 *
 * Раньше блок был «строка МЗК из договора + чипы + форма назначения»: назначить
 * было можно, а поменять или убрать — нет, и назначение делалось один раз и
 * навсегда. Строка МЗК при этом читала зеркало в договоре и показывала «—»
 * рядом с чипом «МЗК · активен». Теперь всё берётся из назначений.
 *
 * Два активных в одной роли — наследие старого «Добавить себя», которое не
 * заменяло текущего. Их не прячем: помечаем, чтобы админ снял лишнего.
 */
export const StudentTeamSection: React.FC<{
  studentId: string
  responsibles: ResponsibleUser[]
  canManage: boolean
  mentors: User[]
  mzkManagers: User[]
}> = ({ studentId, responsibles, canManage, mentors, mzkManagers }) => {
  const qc = useQueryClient()
  const [assignFor, setAssignFor] = useState<{ role: string; current: ResponsibleUser[] } | null>(null)
  const [unassignTarget, setUnassignTarget] = useState<ResponsibleUser | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const activeByRole = useMemo(() => {
    const map = new Map<string, ResponsibleUser[]>()
    for (const r of responsibles) {
      // Плейсхолдер «требуется назначение» — не человек, строкой его не рисуем.
      if (!r.role || !r.is_active || r.assignment_status === 'required' || !r.name) continue
      map.set(r.role, [...(map.get(r.role) ?? []), r])
    }
    return map
  }, [responsibles])

  const roles = ROLE_ORDER.filter((r) => (ASSIGNABLE_MENTOR_ROLES as readonly string[]).includes(r))

  const invalidate = () => {
    invalidateStudent(qc, studentId)
    qc.invalidateQueries({ queryKey: ['students'] })
    qc.invalidateQueries({ queryKey: ['my-students'] })
    qc.invalidateQueries({ queryKey: ['assignment-board'] })
    qc.invalidateQueries({ queryKey: ['assignment-history', studentId] })
  }

  const unassignMutation = useMutation({
    mutationFn: ({ assignmentId, reason }: { assignmentId: string; reason: string }) =>
      mentorAssignmentsApi.unassign(assignmentId, reason),
    onSuccess: () => {
      setUnassignTarget(null)
      invalidate()
      toast({ title: 'Ответственный снят' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось снять', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const history = useQuery({
    queryKey: ['assignment-history', studentId],
    queryFn: () => mentorAssignmentsApi.history(studentId),
    enabled: canManage && historyOpen,
  })

  return (
    <div className="space-y-1">
      <div className="divide-y divide-p-line rounded-panel border border-p-line">
        {roles.map((role) => {
          const current = activeByRole.get(role) ?? []
          const doubled = current.length > 1
          return (
            <div key={role} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
              <div className="w-36 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-p-muted">
                {MENTOR_ROLE_LABELS[role] ?? role}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {current.length === 0 && (
                  <span
                    className={
                      REQUIRED_ROLES.has(role)
                        ? 'text-sm font-medium text-amber-700'
                        : 'text-sm text-p-muted2'
                    }
                  >
                    {REQUIRED_ROLES.has(role) ? 'Требуется назначение' : 'Не назначен'}
                  </span>
                )}
                {current.map((person) => (
                  <div key={person.assignment_id ?? person.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-p-text">{person.name}</span>
                    <span
                      className={
                        person.assignment_status === 'awaiting_signature'
                          ? 'rounded-pill border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-2xs font-semibold uppercase text-amber-700'
                          : 'rounded-pill border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-2xs font-semibold uppercase text-emerald-700'
                      }
                    >
                      {person.assignment_status === 'awaiting_signature' ? 'ждёт подписи' : 'активен'}
                    </span>
                    {canManage && person.assignment_id && (
                      <button
                        type="button"
                        onClick={() => setUnassignTarget(person)}
                        className="inline-flex items-center gap-1 text-xs text-p-muted hover:text-red-600"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Снять
                      </button>
                    )}
                  </div>
                ))}
                {doubled && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Два ответственных в одной роли — снимите лишнего или замените обоих одним.
                  </div>
                )}
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant={current.length === 0 ? 'default' : 'outline'}
                  className="h-8 gap-1.5"
                  onClick={() => setAssignFor({ role, current })}
                >
                  {current.length === 0 ? (
                    <>
                      <UserPlus className="h-3.5 w-3.5" /> Назначить
                    </>
                  ) : (
                    <>
                      <Repeat className="h-3.5 w-3.5" /> Заменить
                    </>
                  )}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {canManage && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 pt-1 text-xs text-p-muted hover:text-p-text"
          >
            <History className="h-3.5 w-3.5" />
            История изменений
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && (
            <div className="mt-2 space-y-1.5 text-xs">
              {history.isLoading && <p className="text-p-muted">Загружаем…</p>}
              {history.data?.length === 0 && <p className="text-p-muted">Замен и снятий ещё не было</p>}
              {history.data?.map((entry) => (
                <div key={entry.id} className="rounded-ctl border border-p-line bg-p-bg px-2.5 py-1.5">
                  <div className="text-p-text">
                    <span className="text-p-muted">{MENTOR_ROLE_LABELS[entry.role] ?? entry.role}:</span>{' '}
                    {entry.replacement_mentor_name
                      ? `${entry.previous_mentor_name ?? '—'} → ${entry.replacement_mentor_name}`
                      : `снят(а) ${entry.previous_mentor_name ?? '—'}`}
                  </div>
                  <div className="text-p-muted">
                    «{entry.reason}» · {entry.changed_by_name ?? '—'} · {formatDate(entry.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AssignRoleDialog
        target={assignFor}
        studentId={studentId}
        mentors={mentors}
        mzkManagers={mzkManagers}
        onClose={() => setAssignFor(null)}
        onDone={invalidate}
      />

      <ReplacementReasonDialog
        mode="unassign"
        studentCount={unassignTarget ? 1 : null}
        currentName={unassignTarget?.name}
        isPending={unassignMutation.isPending}
        onCancel={() => setUnassignTarget(null)}
        onConfirm={(reason) =>
          unassignTarget?.assignment_id &&
          unassignMutation.mutate({ assignmentId: unassignTarget.assignment_id, reason })
        }
      />
    </div>
  )
}

/** Назначить на роль или заменить того, кто в ней. При замене причина обязательна. */
function AssignRoleDialog({
  target,
  studentId,
  mentors,
  mzkManagers,
  onClose,
  onDone,
}: {
  target: { role: string; current: ResponsibleUser[] } | null
  studentId: string
  mentors: User[]
  mzkManagers: User[]
  onClose: () => void
  onDone: () => void
}) {
  const [personId, setPersonId] = useState('')
  const [reason, setReason] = useState('')
  const [showExtra, setShowExtra] = useState(false)
  const [zone, setZone] = useState('')
  const [country, setCountry] = useState('')
  const [dueDate, setDueDate] = useState('')

  const role = target?.role ?? ''
  const replacing = (target?.current.length ?? 0) > 0

  // Диалог переиспользуется для разных ролей — поля от прошлой роли не тащим.
  const [openedFor, setOpenedFor] = useState<typeof target>(null)
  if (target !== openedFor) {
    setOpenedFor(target)
    setPersonId('')
    setReason('')
    setShowExtra(false)
    setZone('')
    setCountry('')
    setDueDate('')
  }

  const pool = ROLE_USER_SOURCE[role] === 'mzk_manager' ? mzkManagers : mentors
  const groups = useMemo(() => {
    const { matching, others } = splitAssignCandidates(pool, role)
    return [
      { title: MENTOR_ROLE_LABELS[role] ?? 'Эта роль', users: matching },
      { title: 'Другие сотрудники', users: others },
    ].filter((g) => g.users.length > 0)
  }, [pool, role])
  const currentIds = new Set(target?.current.map((c) => c.id) ?? [])

  const mutation = useMutation({
    mutationFn: () =>
      mentorAssignmentsApi.create(studentId, {
        mentor_id: personId,
        role,
        functional_zone: zone || null,
        country_scope: country || null,
        first_task_due_date: dueDate || null,
        is_active: true,
        replacement_reason: replacing ? reason.trim() : undefined,
      }),
    onSuccess: (res) => {
      onDone()
      onClose()
      toast({
        title: replacing ? 'Ответственный заменён' : 'Ответственный назначен',
        description:
          res.assignment_status === 'awaiting_signature'
            ? 'Сотрудник ещё не подписал регламент — назначение ждёт подписи.'
            : 'Студент появится у сотрудника в «Моих студентах» и в личном кабинете.',
      })
    },
    onError: (err) =>
      toast({ title: 'Не удалось назначить', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const canSubmit = Boolean(personId) && (!replacing || reason.trim().length > 0) && !mutation.isPending

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {replacing ? 'Заменить' : 'Назначить'}: {MENTOR_ROLE_LABELS[role] ?? role}
          </DialogTitle>
          <DialogDescription>
            {replacing
              ? `Сейчас: ${target?.current.map((c) => c.name).join(', ')}. Замена попадёт в историю.`
              : 'Студент появится у сотрудника в «Моих студентах» и в личном кабинете.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={personId} onValueChange={setPersonId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите сотрудника" />
            </SelectTrigger>
            <SelectContent>
              {pool.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-p-muted">Нет сотрудников с этой ролью</div>
              ) : (
                groups.map((group) => (
                  <React.Fragment key={group.title}>
                    {groups.length > 1 && (
                      <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-p-muted2">
                        {group.title}
                      </div>
                    )}
                    {group.users.map((u) => (
                      <SelectItem key={u.id} value={u.id} disabled={currentIds.has(u.id)}>
                        {u.name}
                        {currentIds.has(u.id) ? ' · сейчас в роли' : ''}
                      </SelectItem>
                    ))}
                  </React.Fragment>
                ))
              )}
            </SelectContent>
          </Select>

          {replacing && (
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина замены, например: ментор ушёл в отпуск"
            />
          )}

          <button
            type="button"
            onClick={() => setShowExtra((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-p-muted hover:text-p-text"
          >
            Дополнительно
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showExtra ? 'rotate-180' : ''}`} />
          </button>
          {showExtra && (
            <div className="grid gap-2">
              <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Функциональная зона" />
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Страна / область" />
              <label className="grid gap-1 text-xs text-p-muted">
                Срок первой задачи
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Сохраняем…' : replacing ? 'Заменить' : 'Назначить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
