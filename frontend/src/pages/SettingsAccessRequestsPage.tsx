import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Search, UserPlus } from 'lucide-react'
import { accessRequestsApi } from '@/api/accessRequests'
import { useAuth } from '@/contexts/AuthContext'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
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
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getErrorStatus } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { PageHeader, EmptyState } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import {
  GROUP_META,
  GROUP_ORDER,
  getRequestGroup,
  isAutoApprovable,
  isSameAccount,
  matchesSearch,
  phoneCandidates,
  type RequestTab,
} from './accessRequests/groups'
import { CandidateLine } from './accessRequests/CandidateLine'
import { RequestRow } from './accessRequests/RequestRow'
import {
  BulkAttachDialog,
  CloseLinkedDialog,
  ReplaceDialog,
  type BulkState,
} from './accessRequests/RequestDialogs'
import {
  describeActionError,
  summarizeBulk,
  summarizeBulkError,
  type BulkRow,
  type ReplaceTarget,
} from './accessRequests/texts'

// Экспорт сохранён: на него смотрит регрессионный тест.
export { isAutoApprovable }

/**
 * Очередь самозаписи: кто пришёл через /join и ждёт привязки к карточке.
 *
 * Страница построена вокруг одного вопроса — «что делать с этой заявкой».
 * Поэтому каждая заявка относится ровно к одной группе (groups.ts), а у группы
 * одна главная кнопка. Массовое действие есть только у группы «Прикрепить»:
 * там за выбор отвечает матчинг (точный телефон, свободная карточка), и сервер
 * пересчитывает это заново. Остальных он вернёт списком с причиной.
 */
export function SettingsAccessRequestsPage() {
  const queryClient = useQueryClient()
  // Смотреть очередь может и МЗК-менеджер, а решать — только админ
  // (access_requests:manage в реестре прав). Сервер на любое действие ответит
  // 403, поэтому здесь кнопки не рисуем, а причину говорим словами.
  const { can } = useAuth()
  const canDecide = can('access_requests', 'manage')
  const [pickerFor, setPickerFor] = useState<AccessRequestItem | null>(null)
  // null — пользователь ещё не выбирал: открываем первую непустую вкладку.
  const [chosenTab, setChosenTab] = useState<RequestTab | null>(null)
  const [search, setSearch] = useState('')
  // По умолчанию выбраны все готовые к прикреплению; храним снятые галочки,
  // чтобы заявки, пришедшие после обновления, не оказались «не выбранными».
  const [deselected, setDeselected] = useState<Set<string>>(new Set())

  const query = useQuery({
    queryKey: ['access-requests', 'new'],
    queryFn: () => accessRequestsApi.list('new'),
  })

  // Через useMemo, а не `?? []`: новый пустой массив на каждый рендер
  // пересчитывал бы всё, что от него зависит.
  const items = useMemo(() => query.data?.items ?? [], [query.data])
  // Счётчики вкладок считаются по результату поиска: сумма групп всегда
  // равна «Все», а число на вкладке равно числу строк под ней.
  const found = useMemo(() => items.filter((item) => matchesSearch(item, search)), [items, search])
  const grouped = useMemo(() => found.map((item) => ({ item, group: getRequestGroup(item) })), [found])
  const counts = useMemo(() => {
    const result: Record<RequestTab, number> = {
      attach: 0, busy: 0, linked: 0, check: 0, create: 0, mentor: 0, all: grouped.length,
    }
    for (const { group } of grouped) result[group] += 1
    return result
  }, [grouped])

  const tab: RequestTab = chosenTab ?? GROUP_ORDER.find((g) => counts[g] > 0) ?? 'all'
  const rows = useMemo(
    () => (tab === 'all' ? grouped : grouped.filter(({ group }) => group === tab)),
    [grouped, tab],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    setDeselected(new Set())
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

  // Закрыть заявку аккаунта, который уже владеет карточкой: меняет только
  // статус заявки, никого не отключает. Всегда через окно подтверждения.
  const [closeTarget, setCloseTarget] = useState<{ id: string; cardName: string | null } | null>(null)
  const doCloseLinked = async (id: string) => {
    await accessRequestsApi.closeLinked(id)
    toast({ title: 'Заявка закрыта: аккаунт уже привязан к карточке' })
    invalidate()
  }

  // Замена кабинета у карточки, у которой он уже есть. Всегда по одной заявке
  // и через подтверждение: старый аккаунт при этом отключается.
  const [confirmReplace, setConfirmReplace] = useState<ReplaceTarget | null>(null)
  const doReplace = async (t: ReplaceTarget) => {
    await accessRequestsApi.approve(t.item.id, {
      role: 'student',
      student_id: t.studentId,
      replace_existing: true,
    })
    toast({ title: 'Кабинет заменён' })
    invalidate()
  }

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

  // Массовое прикрепление: подтверждение со списком → ожидание → отчёт.
  // Неудавшиеся остаются в списке с красной пометкой до следующего обновления.
  const [bulkState, setBulkState] = useState<BulkState | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const openBulk = () => {
    const rows: BulkRow[] = selectedIds.flatMap((id) => {
      const item = items.find((i) => i.id === id)
      const card = item ? phoneCandidates(item)[0] : undefined
      return item && card
        ? [{ id, name: item.full_name, phone: item.phone, cardName: card.full_name }]
        : []
    })
    if (rows.length > 0) setBulkState({ stage: 'confirm', rows })
  }
  const runBulk = async () => {
    if (!bulkState || bulkState.stage !== 'confirm') return
    const { rows } = bulkState
    setBulkState({ stage: 'running', rows })
    let summary
    try {
      summary = summarizeBulk(rows, await accessRequestsApi.bulkApprove(rows.map((r) => r.id)))
    } catch (e) {
      summary = summarizeBulkError(rows, describeActionError(e))
    }
    setRowErrors(Object.fromEntries(summary.failed.map((f) => [f.id, f.reason])))
    setBulkState({ stage: 'result', rows, summary })
    invalidate()
  }

  const attachIds = useMemo(
    () => grouped.filter(({ group }) => group === 'attach').map(({ item }) => item.id),
    [grouped],
  )
  const selectedIds = useMemo(
    () => attachIds.filter((id) => !deselected.has(id)),
    [attachIds, deselected],
  )
  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const busy =
    approve.isPending || reject.isPending || createStudent.isPending

  const subline =
    tab === 'attach'
      ? null
      : tab === 'all'
        ? 'Все заявки. Группа у каждой — в бейдже, главное действие — справа.'
        : GROUP_META[tab].hint

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Заявки на доступ"
        description="Кто зарегистрировался сам и ждёт привязки к карточке"
      />

      <div className="relative mb-4 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted"
          aria-hidden="true"
        />
        <Input
          type="search"
          className="pl-9"
          placeholder="Поиск по имени, телефону или email"
          aria-label="Поиск заявок"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <RequestTabs tab={tab} counts={counts} onChange={setChosenTab} />

      {/* Панель действий закреплена: при длинной очереди кнопка «Прикрепить
          выбранных» не уезжает за экран вместе с первой строкой. */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-ds-line bg-ds-bg/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        {tab === 'attach' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-ds-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ds-accentText"
                checked={attachIds.length > 0 && selectedIds.length === attachIds.length}
                disabled={!canDecide || attachIds.length === 0}
                onChange={(e) => setDeselected(e.target.checked ? new Set() : new Set(attachIds))}
              />
              Выбрать все
            </label>
            <Button
              size="sm"
              disabled={!canDecide || busy || bulkState !== null || selectedIds.length === 0}
              onClick={openBulk}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Прикрепить выбранных ({selectedIds.length})
            </Button>
            <span className="text-sm text-ds-muted">
              {!canDecide
                ? 'Одобрять может только администратор'
                : attachIds.length === 0
                  ? 'Нет заявок с единственным совпадением телефона и свободной карточкой'
                  : selectedIds.length === 0
                    ? 'Отметьте хотя бы одну заявку'
                    : GROUP_META.attach.hint}
            </span>
          </div>
        ) : (
          <p className="text-sm text-ds-muted">{subline}</p>
        )}
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
        skeletonRows={4}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<Check className="h-6 w-6" />}
            title="Здесь пока нет заявок"
            description={
              search.trim()
                ? 'По этому запросу в этой вкладке ничего нет — попробуйте «Все» или очистите поиск.'
                : items.length > 0
                  ? `Всего заявок ждёт ${items.length} — они в других вкладках.`
                  : 'Новые заявки появятся здесь автоматически.'
            }
          />
        }
      >
        <ul className="space-y-2">
          {rows.map(({ item, group }) => (
            <RequestRow
              key={item.id}
              item={item}
              group={group}
              canDecide={canDecide}
              showCheckbox={tab === 'attach' && canDecide}
              checked={!deselected.has(item.id)}
              busy={busy}
              error={rowErrors[item.id]}
              onToggle={() => toggle(item.id)}
              onLink={(studentId) => approve.mutate({ id: item.id, role: 'student', studentId })}
              onReplace={(candidate) =>
                setConfirmReplace({
                  item,
                  studentId: candidate.id,
                  studentName: candidate.full_name,
                  ownerEmail: candidate.portal_owner?.email ?? null,
                  ownerLastLogin: candidate.portal_owner ? candidate.portal_owner.last_login_at : undefined,
                })
              }
              onApproveMentor={() => approve.mutate({ id: item.id, role: 'mentor' })}
              onCreateStudent={() =>
                item.candidates?.length
                  ? setConfirmCreate({ item, candidates: item.candidates })
                  : createStudent.mutate({ id: item.id, force: false })
              }
              onReject={() => reject.mutate(item.id)}
              onCloseLinked={() =>
                setCloseTarget({
                  id: item.id,
                  cardName: phoneCandidates(item).find((c) => isSameAccount(item, c))?.full_name ?? null,
                })
              }
              onPickOther={() => setPickerFor(item)}
            />
          ))}
        </ul>
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

      <ReplaceDialog
        target={confirmReplace}
        onClose={() => setConfirmReplace(null)}
        onConfirm={doReplace}
      />

      <CloseLinkedDialog
        target={closeTarget}
        onClose={() => setCloseTarget(null)}
        onConfirm={doCloseLinked}
      />

      <BulkAttachDialog
        state={bulkState}
        onConfirm={runBulk}
        onClose={() => {
          setBulkState(null)
          invalidate()
        }}
      />

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
          <ul className="max-h-64 space-y-3 overflow-y-auto rounded-ctl border border-ds-line bg-ds-panel2 p-3 text-sm">
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
                    ownerLastLogin: candidate.portal_owner ? candidate.portal_owner.last_login_at : undefined,
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

    </div>
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
        <div className="rounded-card border border-ds-line bg-ds-bg p-3 font-mono text-sm break-all">
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


/** Вкладки-фильтры. Нулевая видна, но приглушена: пропавшая вкладка читалась бы как «сломалось». */
function RequestTabs({
  tab,
  counts,
  onChange,
}: {
  tab: RequestTab
  counts: Record<RequestTab, number>
  onChange: (tab: RequestTab) => void
}) {
  const tabs: Array<{ value: RequestTab; label: string }> = [
    ...GROUP_ORDER.map((g) => ({ value: g as RequestTab, label: GROUP_META[g].tab })),
    { value: 'all', label: 'Все' },
  ]
  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    onChange(next.value)
    document.getElementById(`access-tab-${next.value}`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label="Группы заявок"
      className="mb-2 flex gap-2 overflow-x-auto pb-1"
    >
      {tabs.map((t, i) => {
        const active = t.value === tab
        return (
          <button
            key={t.value}
            id={`access-tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1) }
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1) }
            }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accentText focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg',
              active
                ? 'border-ds-accent bg-ds-accent text-black'
                : 'border-ds-line bg-ds-panel text-ds-ink hover:border-ds-muted2',
              !active && counts[t.value] === 0 && 'text-ds-muted opacity-60',
            )}
          >
            {t.label}
            <span className="tabular-nums opacity-80">({counts[t.value]})</span>
          </button>
        )
      })}
    </div>
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
            <p className="py-4 text-center text-sm text-ds-muted">
              Введите хотя бы два символа
            </p>
          )}
          {query.data?.items?.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-baseline justify-between gap-3 rounded-ctl px-3 py-2 text-left text-sm hover:bg-ds-panel2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="font-medium text-ds-ink">{s.full_name}</span>
              <span className="text-ds-muted">
                {s.phone}
                {s.has_portal_access && (
                  <span className="ml-2 text-xs text-st-busy">есть кабинет — перепривязать</span>
                )}
              </span>
            </button>
          ))}
          {query.isFetched && (query.data?.items?.length ?? 0) === 0 && search.trim().length >= 2 && (
            <p className="py-4 text-center text-sm text-ds-muted">Ничего не найдено</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

