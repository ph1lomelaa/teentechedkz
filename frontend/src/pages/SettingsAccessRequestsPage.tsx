import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Link2, Search, UserPlus, X } from 'lucide-react'
import { accessRequestsApi } from '@/api/accessRequests'
import { useAuth } from '@/contexts/AuthContext'
import type { AccessRequestItem, ApprovedStaff, StudentCandidate } from '@/api/accessRequests'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import { formatDate } from '@/lib/utils'
import { PageHeader, StatCard, EmptyState } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'

type RequestRoleFilter = 'student' | 'mentor' | 'all'

const REQUEST_ROLE_FILTERS: Array<{ value: RequestRoleFilter; label: string }> = [
  { value: 'student', label: 'Ученики' },
  { value: 'mentor', label: 'Менторы' },
  { value: 'all', label: 'Все' },
]

/**
 * Очередь самозаписи: кто пришёл через /join и ждёт привязки к карточке.
 *
 * Экран построен вокруг одного решения — «к какой карточке относится этот
 * человек». Поэтому подсказка матчинга стоит в строке рядом с именем, а не
 * прячется за кликом: при полусотне заявок открывать каждую бессмысленно.
 *
 * Массовая кнопка одобряет только тех, за кого ручается матчинг (точный
 * телефон, свободная карточка). Остальных сервер возвращает списком с
 * причиной, и этот список показывается обязательно: молчание про пропущенных
 * читалось бы как «очередь разобрана».
 */
export function SettingsAccessRequestsPage() {
  const queryClient = useQueryClient()
  // Смотреть очередь может и МЗК-менеджер, а решать — только админ
  // (access_requests:manage в реестре прав). Без этой проверки кнопки
  // рисовались всем и отвечали 403 по нажатию — худший вид интерфейса:
  // обещает действие, которого нет.
  const { can } = useAuth()
  const canDecide = can('access_requests', 'manage')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerFor, setPickerFor] = useState<AccessRequestItem | null>(null)
  const [roleFilter, setRoleFilter] = useState<RequestRoleFilter>('student')

  const query = useQuery({
    queryKey: ['access-requests', 'new'],
    queryFn: () => accessRequestsApi.list('new'),
  })

  // Через useMemo, а не `?? []`: новый пустой массив на каждый рендер
  // пересчитывал бы всё, что от него зависит.
  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const visibleItems = useMemo(
    () => items.filter((item) => roleFilter === 'all' || item.requested_role === roleFilter),
    [items, roleFilter],
  )

  /**
   * Сколько заявок в каждой вкладке.
   *
   * Ради чего: фильтр по умолчанию стоит на «Учениках», а счётчики и пустое
   * состояние считались по отфильтрованному списку. Пока все ждущие были
   * менторами, страница показывала «Ждут решения 0» и «Очередь пуста» — и
   * читалась как «заявки перестали приходить». Число на вкладке не даёт
   * непустой категории спрятаться.
   */
  const countByRole = useMemo(
    () => ({
      student: items.filter((item) => item.requested_role === 'student').length,
      mentor: items.filter((item) => item.requested_role === 'mentor').length,
      all: items.length,
    }),
    [items],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    setSelected(new Set())
  }

  // Показывается ровно один раз, сразу после одобрения. Второй возможности
  // увидеть этот пароль нет — только сброс в «Пользователях».
  const [issuedPassword, setIssuedPassword] = useState<string | null>(null)

  const approve = useMutation({
    mutationFn: ({
      id,
      role,
      studentId,
      replaceExisting,
    }: {
      id: string
      role: string
      studentId?: string
      replaceExisting?: boolean
    }) => accessRequestsApi.approve(id, { role, student_id: studentId, replace_existing: replaceExisting }),
    onSuccess: (result) => {
      // Сотрудник, пришедший через Google, пароля не имел вовсе. Одобрение
      // выдаёт ему временный — и это единственный момент, когда пароль виден:
      // нигде в открытом виде он не хранится. Показываем отдельным окном, а не
      // тостом: тост исчезнет через пару секунд вместе с паролем.
      if (result?.temp_password) setIssuedPassword(result.temp_password)
      else toast({ title: 'Доступ открыт' })
      invalidate()
    },
    onError: (e) => toast({ variant: 'destructive', title: getErrorMessage(e) }),
  })

  const reject = useMutation({
    mutationFn: (id: string) => accessRequestsApi.reject(id),
    onSuccess: () => {
      toast({ title: 'Заявка отклонена' })
      invalidate()
    },
    onError: (e) => toast({ variant: 'destructive', title: getErrorMessage(e) }),
  })

  // Перепривязка карточки, у которой кабинет уже есть. Отдельное
  // подтверждение: старый аккаунт при этом отключается.
  const [confirmReplace, setConfirmReplace] = useState<{
    item: AccessRequestItem
    studentId: string
    studentName: string
    ownerEmail: string | null
  } | null>(null)

  // Заявка, для которой просят новую карточку, хотя похожие в базе уже есть.
  // Спрашиваем явно: молча созданная карточка и была тем дублем, который
  // потом соединяли в «Рисках».
  const [confirmCreate, setConfirmCreate] = useState<{
    item: AccessRequestItem
    candidates: StudentCandidate[]
  } | null>(null)

  const createStudent = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      accessRequestsApi.createStudent(id, force),
    onSuccess: () => {
      setConfirmCreate(null)
      toast({ title: 'Карточка создана, кабинет открыт' })
      invalidate()
    },
    onError: (e, { id }) => {
      // Похожая карточка могла появиться уже после загрузки очереди — сервер
      // скажет об этом 409 со списком, и показываем тот же выбор.
      const detail = (e as { response?: { data?: { detail?: { code?: string; candidates?: StudentCandidate[] } } } })
        .response?.data?.detail
      const item = items.find((i) => i.id === id)
      if (getErrorStatus(e) === 409 && detail?.code === 'possible_duplicate' && item) {
        setConfirmCreate({ item, candidates: detail.candidates ?? [] })
        void queryClient.invalidateQueries({ queryKey: ['access-requests'] })
        return
      }
      toast({ variant: 'destructive', title: getErrorMessage(e) })
    },
  })

  const bulk = useMutation({
    mutationFn: (ids: string[]) => accessRequestsApi.bulkApprove(ids),
    onSuccess: (result) => {
      if (result.skipped.length === 0) {
        toast({ title: `Открыт доступ: ${result.approved.length}` })
      } else {
        // Пропущенных показываем поимённо: иначе админ уйдёт с экрана
        // уверенным, что разобрал всех.
        toast({
          variant: result.approved.length ? 'default' : 'destructive',
          title: `Открыт доступ: ${result.approved.length}. Осталось разобрать: ${result.skipped.length}`,
          description: result.skipped
            .slice(0, 5)
            .map((s) => `${s.name ?? 'Заявка'} — ${s.reason}`)
            .join('; '),
        })
      }
      invalidate()
    },
    onError: (e) => toast({ variant: 'destructive', title: getErrorMessage(e) }),
  })

  const [confirmStaff, setConfirmStaff] = useState(false)
  const [staffRole, setStaffRole] = useState<'mentor' | 'mzk_manager'>('mentor')
  // Выданные пароли живут до закрытия окна и только здесь: второй раз их не
  // посмотреть, поэтому окно закрывается явной кнопкой, а не по клику мимо.
  const [issuedStaff, setIssuedStaff] = useState<ApprovedStaff[] | null>(null)

  const bulkStaff = useMutation({
    mutationFn: (ids: string[]) => accessRequestsApi.bulkApproveStaff(ids, staffRole),
    onSuccess: (result) => {
      setConfirmStaff(false)
      const withPasswords = result.approved.filter((a) => a.temp_password)
      if (withPasswords.length > 0) setIssuedStaff(result.approved)
      else toast({ title: `Открыт доступ: ${result.approved.length}` })

      if (result.skipped.length > 0) {
        toast({
          variant: 'destructive',
          title: `Не взяли: ${result.skipped.length}`,
          description: result.skipped
            .slice(0, 5)
            .map((s) => `${s.name ?? 'Заявка'} — ${s.reason}`)
            .join('; '),
        })
      }
      invalidate()
    },
    onError: (e) => toast({ variant: 'destructive', title: getErrorMessage(e) }),
  })

  // Кандидаты на массовое одобрение — те же, кого пропустит сервер. Считаем
  // здесь только чтобы не предлагать кнопку, которая ничего не сделает;
  // настоящее решение всё равно принимается на бэкенде.
  const autoReady = useMemo(
    () =>
      visibleItems.filter((i) => {
        if (i.requested_role !== 'student') return false
        // Ровно одна карточка с этим телефоном и без кабинета. Две карточки
        // на номер — семейный телефон, угадывать нельзя.
        const byPhone = (i.candidates ?? []).filter((c) => c.reason === 'phone')
        return byPhone.length === 1 && byPhone[0].is_free
      }),
    [visibleItems],
  )

  /**
   * Сколько отмеченных заявок массовое одобрение точно не возьмёт.
   *
   * «Выбрать все» отмечает и менторов, а сервер их отбрасывает все до одной —
   * получалось «Открыт доступ: 0. Осталось разобрать: 16» уже ПОСЛЕ нажатия,
   * и выглядело это как отказ в правах. Считаем заранее, чтобы сказать до.
   */
  const selectedMentorItems = useMemo(
    () => items.filter((i) => selected.has(i.id) && i.requested_role !== 'student'),
    [items, selected],
  )

  const setRequestRoleFilter = (role: RequestRoleFilter) => {
    setRoleFilter(role)
    setSelected(new Set())
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const busy = approve.isPending || reject.isPending || createStudent.isPending || bulk.isPending

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Заявки на доступ"
        description="Кто зарегистрировался сам и ждёт привязки к карточке"
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          colorPrefix="p"
          icon={<Clock className="h-4 w-4" />}
          label="Ждут решения"
          // Вся очередь, а не текущая вкладка: это заголовочное число, по
          // которому судят «есть ли работа». Считая его по фильтру, страница
          // показывала 0 при шестнадцати ждущих.
          value={String(items.length)}
          valueClassName={visibleItems.length > 0 ? 'text-amber-500' : undefined}
          warn={visibleItems.length > 0}
        />
        <StatCard
          colorPrefix="p"
          label="Совпал телефон"
          value={String(autoReady.length)}
          sub={autoReady.length ? 'можно одобрить пачкой' : 'в этой вкладке'}
        />
        <StatCard
          colorPrefix="p"
          label="Нужна проверка"
          value={String(visibleItems.length - autoReady.length)}
          sub="в этой вкладке"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Фильтр заявок">
        {REQUEST_ROLE_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={roleFilter === filter.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRequestRoleFilter(filter.value)}
          >
            {filter.label}
            <span className="ml-1.5 tabular-nums opacity-70">
              {countByRole[filter.value]}
            </span>
          </Button>
        ))}
      </div>

      {visibleItems.length > 0 && canDecide && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={selected.size > 0 && selected.size === visibleItems.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(visibleItems.map((i) => i.id)) : new Set())
              }
            />
            Выбрать все
          </label>
          <Button
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={() => bulk.mutate([...selected])}
          >
            <Check className="mr-1.5 h-4 w-4" />
            Одобрить выбранные ({selected.size})
          </Button>
          {/* Отдельная кнопка, а не общая: у ученика решение опирается на
              совпадение телефона с карточкой, а здесь проверять нечего —
              доступ сотрудника выдаётся целиком под ответственность человека.
              Поэтому и подтверждение со списком имён. */}
          {selectedMentorItems.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmStaff(true)}
            >
              <UserPlus className="mr-1.5 h-4 w-4" />
              Одобрить как сотрудников ({selectedMentorItems.length})
            </Button>
          )}
          {autoReady.length > 0 && selected.size === 0 && (
            <button
              type="button"
              className="text-sm font-medium text-amber-600 hover:underline"
              onClick={() => setSelected(new Set(autoReady.map((i) => i.id)))}
            >
              Выбрать тех, у кого совпал телефон ({autoReady.length})
            </button>
          )}
        </div>
      )}

      {!canDecide && visibleItems.length > 0 && (
        <div className="mb-4 rounded-card border border-ds-border bg-ds-surface-muted p-4 text-sm text-ds-text-muted">
          Здесь видно, кто ждёт доступа. Открыть кабинет можно из карточки ученика —
          раздел «Доступ в кабинет». Одобрение прямо отсюда доступно администратору.
        </div>
      )}

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
        isEmpty={visibleItems.length === 0}
        empty={
          items.length === 0 ? (
            <EmptyState
              icon={<Check className="h-6 w-6" />}
              title="Очередь пуста"
              description="Все, кто зарегистрировался, уже получили доступ. Новые заявки появятся здесь автоматически."
            />
          ) : (
            // Заявки есть, просто не в этой вкладке. Говорить здесь «очередь
            // пуста» — прямая ложь, из-за которой 16 ждущих менторов выглядели
            // как «заявки перестали приходить».
            <EmptyState
              icon={<Check className="h-6 w-6" />}
              title="В этой вкладке пусто"
              description={`Здесь никого нет, но всего заявок ждёт ${items.length}. Переключитесь на «Все», чтобы увидеть остальных.`}
              action={
                <Button size="sm" variant="outline" onClick={() => setRequestRoleFilter('all')}>
                  Показать все ({items.length})
                </Button>
              }
            />
          )
        }
      >
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <RequestRow
              key={item.id}
              item={item}
              canDecide={canDecide}
              checked={selected.has(item.id)}
              busy={busy}
              onToggle={() => toggle(item.id)}
              onLink={(studentId) =>
                approve.mutate({ id: item.id, role: 'student', studentId })
              }
              onReplace={(candidate) =>
                setConfirmReplace({
                  item,
                  studentId: candidate.id,
                  studentName: candidate.full_name,
                  ownerEmail: candidate.portal_owner?.email ?? null,
                })
              }
              onApproveMentor={() => approve.mutate({ id: item.id, role: 'mentor' })}
              onCreateStudent={() =>
                item.candidates?.length
                  ? setConfirmCreate({ item, candidates: item.candidates })
                  : createStudent.mutate({ id: item.id, force: false })
              }
              onReject={() => reject.mutate(item.id)}
              onPickOther={() => setPickerFor(item)}
            />
          ))}
        </div>
      </QueryState>

      <StudentPicker
        request={pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(student) => {
          if (!pickerFor) return
          if (student.has_portal_access) {
            setConfirmReplace({
              item: pickerFor,
              studentId: student.id,
              studentName: student.full_name,
              ownerEmail: null,
            })
          } else {
            approve.mutate({ id: pickerFor.id, role: 'student', studentId: student.id })
          }
          setPickerFor(null)
        }}
      />

      <Dialog open={Boolean(confirmReplace)} onOpenChange={(open) => !open && setConfirmReplace(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Прикрепить к карточке с кабинетом?</DialogTitle>
            <DialogDescription>
              Карточка «{confirmReplace?.studentName}» сейчас привязана к{' '}
              {confirmReplace?.ownerEmail ? <b>{confirmReplace.ownerEmail}</b> : 'другому аккаунту'}.
              Этот аккаунт будет отключён, а кабинет перейдёт к{' '}
              <b>{confirmReplace?.item.user.email}</b>. Обычно это тот же человек, вошедший с
              другой почты.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReplace(null)}>
              Отмена
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={() => {
                if (!confirmReplace) return
                approve.mutate({
                  id: confirmReplace.item.id,
                  role: 'student',
                  studentId: confirmReplace.studentId,
                  replaceExisting: true,
                })
                setConfirmReplace(null)
              }}
            >
              <Link2 className="mr-1.5 h-4 w-4" />
              Прикрепить и отключить старый
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssuedPasswordDialog
        password={issuedPassword}
        onClose={() => setIssuedPassword(null)}
      />

      <Dialog open={Boolean(confirmCreate)} onOpenChange={(open) => !open && setConfirmCreate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>В базе уже есть похожие карточки</DialogTitle>
            <DialogDescription>
              Если это тот же студент, привяжите заявку к его карточке — новая станет дублем.
              Создавайте новую, только если это другой человек.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-3 overflow-y-auto rounded-ctl border border-ds-border bg-ds-surface-muted p-3 text-sm">
            {confirmCreate?.candidates.map((candidate) => (
              <CandidateLine
                key={candidate.id}
                candidate={candidate}
                canLink
                busy={busy}
                onLink={() => {
                  approve.mutate({ id: confirmCreate.item.id, role: 'student', studentId: candidate.id })
                  setConfirmCreate(null)
                }}
                onReplace={() => {
                  setConfirmReplace({
                    item: confirmCreate.item,
                    studentId: candidate.id,
                    studentName: candidate.full_name,
                    ownerEmail: candidate.portal_owner?.email ?? null,
                  })
                  setConfirmCreate(null)
                }}
              />
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreate(null)}>
              Отмена
            </Button>
            <Button
              variant="outline"
              disabled={createStudent.isPending}
              onClick={() => confirmCreate && createStudent.mutate({ id: confirmCreate.item.id, force: true })}
            >
              <UserPlus className="mr-1.5 h-4 w-4" />
              Это другой человек — создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmStaff} onOpenChange={(open) => !open && setConfirmStaff(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Одобрить как сотрудников: {selectedMentorItems.length}</DialogTitle>
            <DialogDescription>
              Проверять здесь нечего: заявку мог подать кто угодно, кто открыл ссылку
              регистрации. Одобрение сразу открывает доступ к данным студентов — убедитесь,
              что знаете каждого в списке.
            </DialogDescription>
          </DialogHeader>

          <div>
            <p className="mb-1 text-xs font-medium text-p-muted">Роль</p>
            <Select value={staffRole} onValueChange={(v) => setStaffRole(v as 'mentor' | 'mzk_manager')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mentor">Ментор</SelectItem>
                <SelectItem value="mzk_manager">МЗК-менеджер</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ul className="max-h-52 overflow-y-auto rounded-panel border border-p-line bg-p-bg p-3 text-sm">
            {selectedMentorItems.map((item) => (
              <li key={item.id} className="py-0.5">
                {item.full_name}
                <span className="ml-2 text-xs text-p-muted">{item.user.email}</span>
              </li>
            ))}
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStaff(false)}>
              Отмена
            </Button>
            <Button
              disabled={bulkStaff.isPending}
              onClick={() => bulkStaff.mutate(selectedMentorItems.map((i) => i.id))}
            >
              {bulkStaff.isPending ? 'Одобряем…' : 'Одобрить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssuedStaffDialog staff={issuedStaff} onClose={() => setIssuedStaff(null)} />
    </div>
  )
}

/** Пароли одобренной пачки: показываются один раз, поэтому вместе с именами. */
function IssuedStaffDialog({
  staff,
  onClose,
}: {
  staff: ApprovedStaff[] | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const withPassword = (staff ?? []).filter((s) => s.temp_password)

  const copyAll = async () => {
    const text = withPassword.map((s) => `${s.name}\t${s.email}\t${s.temp_password}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={Boolean(staff)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Доступ открыт — раздайте временные пароли</DialogTitle>
          <DialogDescription>
            У этих людей не было пароля: они регистрировались через Google. Пароли показаны
            один раз — скопируйте сейчас. Потерянный восстанавливается только сбросом
            в «Пользователях». При первом входе система попросит сменить пароль.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto rounded-panel border border-p-line">
          <table className="w-full text-sm">
            <tbody>
              {withPassword.map((s) => (
                <tr key={s.id} className="border-b border-p-line last:border-0">
                  <td className="px-3 py-2">
                    {s.name}
                    <div className="text-xs text-p-muted">{s.email}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{s.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(staff?.length ?? 0) > withPassword.length && (
          <p className="text-xs text-p-muted">
            Остальным пароль не выдавался — он у них уже есть.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={copyAll}>
            {copied ? 'Скопировано' : 'Скопировать всё'}
          </Button>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Одноразовый показ временного пароля сразу после одобрения заявки. */
function IssuedPasswordDialog({
  password,
  onClose,
}: {
  password: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Не удалось скопировать пароль', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={Boolean(password)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Доступ открыт — передайте временный пароль</DialogTitle>
          <DialogDescription>
            У этого аккаунта не было пароля: человек регистрировался через Google.
            Передайте пароль лично — при первом входе система попросит сменить его.
            Показывается один раз; потерян — сбросьте в «Пользователях».
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-panel border border-p-line bg-p-bg p-3 font-mono text-sm break-all">
          {password}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? 'Скопировано' : 'Скопировать пароль'}
          </Button>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestRow({
  item,
  canDecide,
  checked,
  busy,
  onToggle,
  onLink,
  onReplace,
  onApproveMentor,
  onCreateStudent,
  onReject,
  onPickOther,
}: {
  item: AccessRequestItem
  canDecide: boolean
  checked: boolean
  busy: boolean
  onToggle: () => void
  onLink: (studentId: string) => void
  onReplace: (candidate: StudentCandidate) => void
  onApproveMentor: () => void
  onCreateStudent: () => void
  onReject: () => void
  onPickOther: () => void
}) {
  const candidates = item.candidates ?? []
  const isStudent = item.requested_role === 'student'
  // Совпал телефон — это тот же человек, и новая карточка стала бы дублем.
  // При совпадении только по ФИО кнопку оставляем: однофамильцы бывают.
  const hasPhoneMatch = candidates.some((c) => c.reason === 'phone')

  return (
    <div className="rounded-card border border-ds-border bg-ds-surface p-4">
      <div className="flex items-start gap-3">
        {canDecide && (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-amber-500"
            checked={checked}
            onChange={onToggle}
            aria-label={`Выбрать заявку: ${item.full_name}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-ds-text">{item.full_name}</span>
            <span className="text-sm text-ds-text-muted">{item.user.email}</span>
            <span className="text-sm text-ds-text-muted">{item.phone}</span>
            <span className="rounded-pill border border-ds-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ds-text-muted">
              {isStudent ? 'Ученик' : 'Ментор'}
            </span>
          </div>

          {(item.city || item.direction) && (
            <p className="mt-1 text-sm text-ds-text-muted">
              {[item.city, item.direction].filter(Boolean).join(' · ')}
            </p>
          )}

          {isStudent && (
            <div className="mt-3 rounded-ctl border border-ds-border bg-ds-surface-muted p-3 text-sm">
              {candidates.length > 0 ? (
                <>
                  <p className="mb-2 text-xs font-medium text-ds-text-muted">
                    {candidates.length === 1
                      ? 'В базе есть похожая карточка'
                      : `В базе есть похожие карточки: ${candidates.length}`}
                  </p>
                  <ul className="space-y-3">
                    {candidates.map((candidate) => (
                      <CandidateLine
                        key={candidate.id}
                        candidate={candidate}
                        canLink={canDecide}
                        busy={busy}
                        onLink={() => onLink(candidate.id)}
                        onReplace={() => onReplace(candidate)}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <span className="text-ds-text-muted">
                  Совпадений в базе нет — похоже, карточку нужно создать
                </span>
              )}
            </div>
          )}

          {canDecide && (
          <div className="mt-3 flex flex-wrap gap-2">
            {isStudent ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={onPickOther}>
                  <Search className="mr-1.5 h-4 w-4" />
                  {candidates.length > 0 ? 'Найти другую' : 'Найти карточку'}
                </Button>
                {!hasPhoneMatch && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={onCreateStudent}>
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    Создать новую карточку
                  </Button>
                )}
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={onApproveMentor}>
                <Check className="mr-1.5 h-4 w-4" />
                Одобрить как ментора
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
              <X className="mr-1.5 h-4 w-4" />
              Отклонить
            </Button>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Похожая карточка: кто, почему попала в список и можно ли к ней привязать. */
function CandidateLine({
  candidate,
  canLink,
  busy,
  onLink,
  onReplace,
}: {
  candidate: StudentCandidate
  canLink: boolean
  busy: boolean
  onLink: () => void
  /** Карточка уже с кабинетом — перепривязать через подтверждение. */
  onReplace: () => void
}) {
  const owner = candidate.portal_owner
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="font-medium text-ds-text">{candidate.full_name}</span>
        <span className="text-ds-text-muted">
          {[candidate.phone, candidate.intake_year].filter(Boolean).map((v) => `, ${v}`).join('')}
        </span>
        <div className="mt-0.5 text-xs text-ds-text-muted">
          {candidate.reason_label}
          {!candidate.is_free && (
            // Занятую карточку не прячем: скорее всего человек завёл второй
            // аккаунт. Показываем, чей кабинет, — админ решает, заменять ли.
            <span className="ml-2 font-medium text-amber-600">
              {owner
                ? `кабинет: ${owner.email} · ${
                    owner.last_login_at ? `входил ${formatDate(owner.last_login_at)}` : 'ни разу не входил'
                  }`
                : 'у этой карточки уже есть кабинет'}
            </span>
          )}
        </div>
      </div>
      {canLink &&
        (candidate.is_free ? (
          <Button size="sm" disabled={busy} onClick={onLink}>
            <Link2 className="mr-1.5 h-4 w-4" />
            Прикрепить
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={onReplace}>
            <Link2 className="mr-1.5 h-4 w-4" />
            Прикрепить
          </Button>
        ))}
    </li>
  )
}

/** Поиск карточки руками — когда подсказки нет или она не та. */
function StudentPicker({
  request,
  onClose,
  onPick,
}: {
  request: AccessRequestItem | null
  onClose: () => void
  onPick: (student: { id: string; full_name: string; has_portal_access?: boolean }) => void
}) {
  // Предзаполняем телефоном, а не именем: по нему находится ровно один
  // человек, а по фамилии — половина потока. Формат номера не важен —
  // поиск сравнивает цифры.
  const [search, setSearch] = useState('')
  useEffect(() => {
    setSearch(request?.phone ?? '')
  }, [request])
  const query = useQuery({
    queryKey: ['students', 'picker', search],
    queryFn: () => studentsApi.list({ search, size: 20 }),
    enabled: Boolean(request) && search.trim().length >= 2,
  })

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Выберите карточку</DialogTitle>
          <DialogDescription>
            {request ? `${request.full_name} · ${request.phone}` : ''}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Имя или телефон"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {search.trim().length < 2 && (
            <p className="py-4 text-center text-sm text-ds-text-muted">
              Введите хотя бы два символа
            </p>
          )}
          {query.data?.items?.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-baseline justify-between gap-3 rounded-ctl px-3 py-2 text-left text-sm hover:bg-ds-surface-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="font-medium text-ds-text">{s.full_name}</span>
              <span className="text-ds-text-muted">
                {s.phone}
                {s.has_portal_access && (
                  <span className="ml-2 text-xs text-amber-600">есть кабинет — перепривязать</span>
                )}
              </span>
            </button>
          ))}
          {query.isFetched && (query.data?.items?.length ?? 0) === 0 && search.trim().length >= 2 && (
            <p className="py-4 text-center text-sm text-ds-text-muted">Ничего не найдено</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
