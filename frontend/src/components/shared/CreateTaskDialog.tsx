import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { tasksApi, usersApi } from '@/api'
import { roadmapApi, type Priority } from '@/api/roadmap'
import { AppButton, AppInput, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { ADMIN_TOKENS, type AdminColorPrefix } from '@/components/admin/tokens'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { DueField } from './createTask/DueField'
import { StudentField, type PickedStudent } from './createTask/StudentField'

type Kind = 'student' | 'staff'
type AssignMode = 'pick' | 'all_mentors' | 'all_mzk'

// Для поручений сотрудникам срок считается в часах SLA; пустая строка — без срока.
const SLA_PRESETS = [
  { label: '24 часа', hours: '24' },
  { label: '2 дня', hours: '48' },
  { label: 'Неделя', hours: '168' },
  { label: 'Без срока', hours: '' },
] as const

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 'required', label: 'Обязательно' },
  { value: 'recommended', label: 'Желательно' },
  { value: 'optional', label: 'По желанию' },
]

const FORBIDDEN_MESSAGE = 'Недостаточно прав, чтобы поставить такую задачу. Обратитесь к МЗК или администратору.'

interface CreateTaskDialogProps {
  colorPrefix: AdminColorPrefix
  onClose: () => void
  onCreated: () => void
  /** Предвыбранный студент (например, из карточки). */
  defaultStudent?: PickedStudent | null
  /** С чего начать: задача студенту (шаг roadmap) или поручение сотруднику. */
  initialKind?: Kind
  activityParticipationId?: string
}

const FieldLabel: React.FC<{ children: React.ReactNode; hint?: string; tone: string }> = ({ children, hint, tone }) => (
  <div className="mb-1.5 flex items-baseline justify-between gap-3">
    <Label className={cn('text-sm font-bold', tone)}>{children}</Label>
    {hint && <span className="text-xs opacity-60">{hint}</span>}
  </div>
)

/**
 * Постановка задачи — два разных действия, и форма их не смешивает:
 *
 *  - «Студенту» — шаг roadmap со сроком. Именно его студент видит у себя в
 *    кабинете и отмечает выполненным. Поручение сотруднику (StudentTask) в
 *    кабинете студента не показывается, поэтому «задача студенту» через него
 *    не доходила до адресата.
 *  - «Сотруднику» — внутреннее поручение по студенту или общее. Что доступно,
 *    определяют права: tasks_bulk — рассылка, tasks_general — задача без студента.
 */
export const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  colorPrefix, onClose, onCreated, defaultStudent = null, initialKind, activityParticipationId,
}) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const { can } = useAuth()
  const canStudentTask = can('roadmaps', 'edit')
  const canBulk = can('tasks_bulk', 'manage')
  const canGeneral = can('tasks_general', 'manage')
  const canDeadline = can('tasks_deadlines', 'manage')

  const [kind, setKind] = useState<Kind>(() => (canStudentTask ? initialKind ?? 'student' : 'staff'))
  const [student, setStudent] = useState<PickedStudent | null>(defaultStudent)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')

  // «Студенту»
  const [stageId, setStageId] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [description, setDescription] = useState('')
  const [expectedResult, setExpectedResult] = useState('')
  const [priority, setPriority] = useState<Priority>('required')
  const [needsDocument, setNeedsDocument] = useState(false)
  const [needsZoom, setNeedsZoom] = useState(false)

  // «Сотруднику»
  const [mode, setMode] = useState<AssignMode>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const [slaHours, setSlaHours] = useState('24')
  const [staffSearch, setStaffSearch] = useState('')

  // ---- roadmap выбранного студента ----
  const { data: roadmaps, isFetching: roadmapsLoading, isError: roadmapsFailed } = useQuery({
    queryKey: ['student-roadmaps', student?.id],
    queryFn: () => roadmapApi.studentRoadmaps(student!.id),
    enabled: kind === 'student' && Boolean(student),
  })
  const activeRoadmaps = useMemo(() => (roadmaps ?? []).filter((r) => r.status === 'active'), [roadmaps])
  const stageOptions = useMemo(
    () =>
      activeRoadmaps.flatMap((roadmap) =>
        [...roadmap.stages]
          .sort((a, b) => a.position - b.position)
          .map((stage) => ({
            id: stage.id,
            label: activeRoadmaps.length > 1 ? `${roadmap.name} · ${stage.name}` : stage.name,
            done: stage.status === 'done',
          })),
      ),
    [activeRoadmaps],
  )

  // Этап по умолчанию — первый незавершённый. Сбрасывается при смене студента.
  useEffect(() => {
    const preferred = stageOptions.find((stage) => !stage.done) ?? stageOptions[0]
    setStageId(preferred?.id ?? '')
  }, [stageOptions])

  // ---- исполнители: нужны только рассылке, остальным список не грузим ----
  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: async () => {
      const [mentors, managers] = await Promise.all([
        usersApi.list({ role: 'mentor', is_active: true }),
        usersApi.list({ role: 'mzk_manager', is_active: true }),
      ])
      return [...mentors, ...managers]
    },
    enabled: kind === 'staff' && canBulk,
  })
  const visibleStaff = staff.filter((person) => person.name.toLowerCase().includes(staffSearch.trim().toLowerCase()))
  const togglePicked = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  // Передаём снимок формы в mutate: кнопка может уже показать выбранный этап,
  // пока observer мутации ещё держит callback предыдущего рендера.
  const studentTaskPayload: Parameters<typeof roadmapApi.createTask>[0] = {
    stage_id: stageId,
    activity_participation_id: activityParticipationId,
    title: title.trim(),
    description: description.trim() || undefined,
    expected_result: expectedResult.trim() || undefined,
    needs_document: needsDocument,
    needs_zoom: needsZoom,
    priority,
    audience: 'applicant',
    due_date: dueDate || null,
  }

  const mutation = useMutation({
    mutationFn: async (studentPayload?: typeof studentTaskPayload) => {
      if (kind === 'student') {
        if (!studentPayload?.stage_id) throw new Error('Выберите этап roadmap')
        await roadmapApi.createTask(studentPayload)
        return { created_count: 1, skipped: [] as Array<{ reason: string }> }
      }
      if (canBulk) {
        return tasksApi.createBulk({
          task_text: title.trim(),
          student_id: student?.id ?? null,
          assignee_ids: mode === 'pick' ? picked : [],
          all_mentors: mode === 'all_mentors',
          all_mzk: mode === 'all_mzk',
          sla_hours: slaHours.trim() ? Number(slaHours) : null,
        })
      }
      await tasksApi.create(student?.id ?? null, {
        task_text: title.trim(),
        ...(canDeadline && dueDate ? { due_date: dueDate } : {}),
      })
      return { created_count: 1, skipped: [] as Array<{ reason: string }> }
    },
    onSuccess: (result) => {
      toast({
        title: kind === 'student' ? `Задача поставлена: ${student?.name}` : `Создано задач: ${result.created_count}`,
        description: result.skipped.length ? `Пропущено ${result.skipped.length}: ${result.skipped[0].reason}` : undefined,
      })
      onCreated()
    },
    onError: (error) =>
      toast({
        title: getErrorStatus(error) === 403 ? FORBIDDEN_MESSAGE : getErrorMessage(error, 'Не удалось создать задачу'),
        variant: 'destructive',
      }),
  })

  const hasTitle = Boolean(title.trim())
  const studentReady = kind === 'student' ? Boolean(student) && Boolean(stageId) : canGeneral || Boolean(student)
  const staffReady = kind === 'student' || !canBulk || mode !== 'pick' || picked.length > 0
  const canSubmit = hasTitle && studentReady && staffReady

  const recipientCount =
    kind === 'student' || !canBulk
      ? 1
      : mode === 'pick'
        ? picked.length
        : staff.filter((person) => (mode === 'all_mzk' ? person.role === 'mzk_manager' : person.role !== 'mzk_manager')).length
  const submitLabel =
    kind === 'student' ? 'Поставить студенту' : recipientCount > 1 ? `Создать ${recipientCount} задачи` : 'Создать задачу'

  const noRoadmap = kind === 'student' && Boolean(student) && !roadmapsLoading && !roadmapsFailed && stageOptions.length === 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {canStudentTask && !activityParticipationId && (
            <SegmentedTabs
              colorPrefix={colorPrefix}
              value={kind}
              onChange={(value) => setKind(value as Kind)}
              className="w-full [&>button]:flex-1"
              tabs={[
                { value: 'student', label: 'Студенту' },
                { value: 'staff', label: 'Сотруднику' },
              ]}
            />
          )}

          <div>
            <FieldLabel tone={t.ink} hint={kind === 'staff' && canGeneral ? 'необязательно' : undefined}>
              {kind === 'student' ? 'Кому' : 'Студент'}
            </FieldLabel>
            {activityParticipationId ? <p className="text-sm">Задача для ученика из выбранного участия</p> : <StudentField colorPrefix={colorPrefix} value={student} onChange={setStudent} autoFocus={!defaultStudent} />}
            {noRoadmap && (
              <p className={cn('mt-2 rounded-ctl border px-3 py-2.5 text-xs leading-5', t.borderLine, t.panel2, t.muted)}>
                У студента нет активного roadmap, поэтому задача не появится в его кабинете.{' '}
                <Link to={`/workspace/students/${student!.id}#roadmap`} className={cn('font-bold underline', t.accentText)} onClick={onClose}>
                  Назначить roadmap
                </Link>
                {!activityParticipationId && <> {' · '}
                <button type="button" onClick={() => setKind('staff')} className={cn('font-bold underline', t.accentText)}>
                  Поставить как поручение сотруднику
                </button></>}
              </p>
            )}
          </div>

          <div>
            <FieldLabel tone={t.ink}>Что нужно сделать</FieldLabel>
            <AppInput
              colorPrefix={colorPrefix}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === 'student' ? 'Например: загрузить скан паспорта' : 'Например: связаться со студентом'}
              aria-label="Что нужно сделать"
              autoFocus={Boolean(defaultStudent)}
              className="h-11"
            />
          </div>

          {kind === 'student' ? (
            <>
              <div>
                <FieldLabel tone={t.ink}>Срок</FieldLabel>
                <DueField colorPrefix={colorPrefix} value={dueDate} onChange={setDueDate} />
              </div>

              {stageOptions.length > 1 && (
                <div>
                  <FieldLabel tone={t.ink}>Этап roadmap</FieldLabel>
                  <select
                    value={stageId}
                    onChange={(event) => setStageId(event.target.value)}
                    aria-label="Этап roadmap"
                    className={cn('h-11 w-full rounded-ctl border px-3 text-sm font-bold outline-none focus:border-current', t.borderLine, t.panel2, t.ink)}
                  >
                    {stageOptions.map((stage) => (
                      <option key={stage.id} value={stage.id}>{stage.label}{stage.done ? ' (завершён)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <button
                  type="button"
                  aria-expanded={showMore}
                  onClick={() => setShowMore((open) => !open)}
                  className={cn('inline-flex items-center gap-1.5 text-sm font-bold', t.muted)}
                >
                  Описание и параметры
                  <ChevronDown className={cn('h-4 w-4 transition', showMore && 'rotate-180')} aria-hidden />
                </button>
                {showMore && (
                  <div className="mt-3 space-y-4">
                    <div>
                      <FieldLabel tone={t.ink}>Описание</FieldLabel>
                      <Textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Что именно сделать и где взять материалы"
                        rows={3}
                        className={cn('border', t.borderLine, t.panel2, t.ink)}
                      />
                    </div>
                    <div>
                      <FieldLabel tone={t.ink}>Ожидаемый результат</FieldLabel>
                      <AppInput
                        colorPrefix={colorPrefix}
                        value={expectedResult}
                        onChange={(event) => setExpectedResult(event.target.value)}
                        placeholder="Например: загруженный PDF"
                        aria-label="Ожидаемый результат"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                      <select
                        value={priority}
                        onChange={(event) => setPriority(event.target.value as Priority)}
                        aria-label="Важность"
                        className={cn('h-10 rounded-ctl border px-3 text-sm font-bold outline-none focus:border-current', t.borderLine, t.panel2, t.ink)}
                      >
                        {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <label className={cn('flex items-center gap-2 text-sm', t.ink)}>
                        <input type="checkbox" checked={needsDocument} onChange={(event) => setNeedsDocument(event.target.checked)} className="h-4 w-4" />
                        Нужен документ
                      </label>
                      <label className={cn('flex items-center gap-2 text-sm', t.ink)}>
                        <input type="checkbox" checked={needsZoom} onChange={(event) => setNeedsZoom(event.target.checked)} className="h-4 w-4" />
                        Нужен созвон
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {canBulk && (
                <div className="space-y-2">
                  <FieldLabel tone={t.ink}>Исполнители</FieldLabel>
                  <SegmentedTabs
                    colorPrefix={colorPrefix}
                    value={mode}
                    onChange={(value) => setMode(value as AssignMode)}
                    className="w-full [&>button]:flex-1"
                    tabs={[
                      { value: 'pick', label: 'Выбрать' },
                      { value: 'all_mentors', label: 'Все менторы' },
                      { value: 'all_mzk', label: 'Все МЗК' },
                    ]}
                  />
                  {mode === 'pick' ? (
                    <div className={cn('overflow-hidden rounded-ctl border', t.borderLine)}>
                      {staff.length > 6 && (
                        <div className={cn('border-b p-2', t.borderLine, t.panel2)}>
                          <AppInput
                            colorPrefix={colorPrefix}
                            value={staffSearch}
                            onChange={(event) => setStaffSearch(event.target.value)}
                            placeholder="Поиск по имени"
                            aria-label="Поиск исполнителя"
                            className="h-9"
                          />
                        </div>
                      )}
                      <div className={cn('max-h-44 overflow-y-auto p-1.5', t.panel2)}>
                        {visibleStaff.length === 0 ? (
                          <p className={cn('px-2 py-3 text-center text-xs', t.muted)}>
                            {staff.length === 0 ? 'Нет доступных исполнителей' : 'Никто не найден'}
                          </p>
                        ) : (
                          visibleStaff.map((person) => {
                            const isPicked = picked.includes(person.id)
                            return (
                              <label
                                key={person.id}
                                className={cn(
                                  'flex cursor-pointer items-center gap-3 rounded-ctl px-2.5 py-2 text-sm transition',
                                  isPicked ? cn('bg-current/10', t.accentText) : cn(t.ink, 'hover:bg-current/5'),
                                )}
                              >
                                <input type="checkbox" checked={isPicked} onChange={() => togglePicked(person.id)} className="h-4 w-4 shrink-0" />
                                <span className={cn('min-w-0 flex-1 truncate font-bold', t.ink)}>{person.name}</span>
                                {person.role === 'mzk_manager' && (
                                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black', t.borderLine, t.muted)}>МЗК</span>
                                )}
                              </label>
                            )
                          })
                        )}
                      </div>
                      <div className={cn('border-t px-3 py-2 text-xs', t.borderLine, t.panel2, t.muted)}>
                        {picked.length ? `Выбрано: ${picked.length}` : 'Никто не выбран'}
                      </div>
                    </div>
                  ) : (
                    <p className={cn('rounded-ctl border px-3 py-2.5 text-xs leading-5', t.borderLine, t.panel2, t.muted)}>
                      Задача уйдёт каждому активному {mode === 'all_mentors' ? 'ментору' : 'МЗК-менеджеру'}: у каждого своя
                      строка и свой срок SLA.
                    </p>
                  )}
                </div>
              )}

              {canBulk ? (
                <div>
                  <FieldLabel tone={t.ink} hint="SLA">Срок</FieldLabel>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {SLA_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setSlaHours(preset.hours)}
                        className={cn(
                          'h-9 rounded-ctl border text-xs font-bold transition',
                          slaHours === preset.hours ? cn('border-current bg-current/10', t.accentText) : cn(t.borderLine, t.muted, 'hover:opacity-80'),
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : canDeadline ? (
                <div>
                  <FieldLabel tone={t.ink}>Срок</FieldLabel>
                  <DueField colorPrefix={colorPrefix} value={dueDate} onChange={setDueDate} />
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <AppButton colorPrefix={colorPrefix} variant="subtle" onClick={onClose}>Отмена</AppButton>
          <AppButton colorPrefix={colorPrefix} disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate(kind === 'student' ? studentTaskPayload : undefined)}>
            {mutation.isPending ? 'Создаём…' : submitLabel}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
