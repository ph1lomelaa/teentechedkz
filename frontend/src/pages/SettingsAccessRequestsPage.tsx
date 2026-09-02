import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Link2, Search, UserPlus, X } from 'lucide-react'
import { accessRequestsApi } from '@/api/accessRequests'
import { useAuth } from '@/contexts/AuthContext'
import type { AccessRequestItem } from '@/api/accessRequests'
import { studentsApi } from '@/api/students'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/primitives/dialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { PageHeader, StatCard, EmptyState } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'

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

  const query = useQuery({
    queryKey: ['access-requests', 'new'],
    queryFn: () => accessRequestsApi.list('new'),
  })

  // Через useMemo, а не `?? []`: новый пустой массив на каждый рендер
  // пересчитывал бы всё, что от него зависит.
  const items = useMemo(() => query.data?.items ?? [], [query.data])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    setSelected(new Set())
  }

  const approve = useMutation({
    mutationFn: ({ id, role, studentId }: { id: string; role: string; studentId?: string }) =>
      accessRequestsApi.approve(id, { role, student_id: studentId }),
    onSuccess: () => {
      toast({ title: 'Доступ открыт' })
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

  const createStudent = useMutation({
    mutationFn: (id: string) => accessRequestsApi.createStudent(id),
    onSuccess: () => {
      toast({ title: 'Карточка создана, кабинет открыт' })
      invalidate()
    },
    onError: (e) => toast({ variant: 'destructive', title: getErrorMessage(e) }),
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

  // Кандидаты на массовое одобрение — те же, кого пропустит сервер. Считаем
  // здесь только чтобы не предлагать кнопку, которая ничего не сделает;
  // настоящее решение всё равно принимается на бэкенде.
  const autoReady = useMemo(
    () =>
      items.filter(
        (i) =>
          i.requested_role === 'student' &&
          i.method === 'phone_exact' &&
          i.suggested_student?.is_free,
      ),
    [items],
  )

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
          value={String(items.length)}
          valueClassName={items.length > 0 ? 'text-amber-500' : undefined}
          warn={items.length > 0}
        />
        <StatCard
          colorPrefix="p"
          label="Совпал телефон"
          value={String(autoReady.length)}
          sub={autoReady.length ? 'можно одобрить пачкой' : undefined}
        />
        <StatCard
          colorPrefix="p"
          label="Нужна проверка"
          value={String(items.length - autoReady.length)}
        />
      </div>

      {items.length > 0 && canDecide && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={selected.size > 0 && selected.size === items.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
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

      {!canDecide && items.length > 0 && (
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
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<Check className="h-6 w-6" />}
            title="Очередь пуста"
            description="Все, кто зарегистрировался, уже получили доступ. Новые заявки появятся здесь автоматически."
          />
        }
      >
        <div className="space-y-3">
          {items.map((item) => (
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
              onApproveMentor={() => approve.mutate({ id: item.id, role: 'mentor' })}
              onCreateStudent={() => createStudent.mutate(item.id)}
              onReject={() => reject.mutate(item.id)}
              onPickOther={() => setPickerFor(item)}
            />
          ))}
        </div>
      </QueryState>

      <StudentPicker
        request={pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(studentId) => {
          if (pickerFor) approve.mutate({ id: pickerFor.id, role: 'student', studentId })
          setPickerFor(null)
        }}
      />
    </div>
  )
}

function RequestRow({
  item,
  canDecide,
  checked,
  busy,
  onToggle,
  onLink,
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
  onApproveMentor: () => void
  onCreateStudent: () => void
  onReject: () => void
  onPickOther: () => void
}) {
  const card = item.suggested_student
  const isStudent = item.requested_role === 'student'

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
              {card ? (
                <>
                  <span className="text-ds-text-muted">Похоже на карточку: </span>
                  <span className="font-medium text-ds-text">{card.full_name}</span>
                  <span className="text-ds-text-muted">, {card.phone}</span>
                  <div className="mt-1 text-xs text-ds-text-muted">
                    {item.method_label}
                    {!card.is_free && (
                      // Занятая карточка — не кандидат, и молчать об этом нельзя:
                      // «Привязать» на ней всё равно откажет.
                      <span className="ml-2 font-medium text-red-500">
                        у этой карточки уже есть кабинет
                      </span>
                    )}
                  </div>
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
                {card && card.is_free && (
                  <Button size="sm" disabled={busy} onClick={() => onLink(card.id)}>
                    <Link2 className="mr-1.5 h-4 w-4" />
                    Привязать к этой карточке
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={onPickOther}>
                  <Search className="mr-1.5 h-4 w-4" />
                  Выбрать другую
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={onCreateStudent}>
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  Создать карточку
                </Button>
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

/** Поиск карточки руками — когда подсказки нет или она не та. */
function StudentPicker({
  request,
  onClose,
  onPick,
}: {
  request: AccessRequestItem | null
  onClose: () => void
  onPick: (studentId: string) => void
}) {
  // Предзаполняем телефоном, а не именем: по нему находится ровно один
  // человек, а по фамилии — половина потока.
  const [search, setSearch] = useState('')
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
              onClick={() => onPick(s.id)}
              className="flex w-full items-baseline justify-between gap-3 rounded-ctl px-3 py-2 text-left text-sm hover:bg-ds-surface-muted"
            >
              <span className="font-medium text-ds-text">{s.full_name}</span>
              <span className="text-ds-text-muted">{s.phone}</span>
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
