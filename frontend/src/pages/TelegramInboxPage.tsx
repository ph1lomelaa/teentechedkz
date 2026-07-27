import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareWarning, Search } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import {
  TelegramChat,
  TelegramChatStatus,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DegreeLevel,
  hasReviewPending,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { PageHeader } from '@/components/ui'

const TABS: { value: TelegramChatStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unbound', label: 'Не привязаны' },
  { value: 'active', label: 'Активные' },
  { value: 'paused', label: 'На паузе' },
  { value: 'closed', label: 'Завершённые' },
]

type QuickFilter = 'none' | 'attention' | 'unbound' | 'mine-active'

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Deterministic avatar tint per chat so the same student keeps one colour —
// a long list becomes scannable by colour, not just by reading names.
const AVATAR_GRADIENTS = [
  'from-amber-400 to-yellow-600',
  'from-sky-400 to-blue-600',
  'from-violet-400 to-purple-600',
  'from-emerald-400 to-green-600',
  'from-rose-400 to-red-600',
  'from-cyan-400 to-teal-600',
]
function avatarGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

export default function TelegramInboxPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = true

  const [tab, setTab] = useState<TelegramChatStatus | 'all'>('all')
  const [scope, setScope] = useState<'all' | 'mine' | 'assigned' | 'unassigned'>('all')
  const [attachTarget, setAttachTarget] = useState<TelegramChat | null>(null)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('none')
  const [search, setSearch] = useState('')
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)

  const directory = useStudentDirectory()

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ['telegram-chats', 'all', scope],
    queryFn: () => telegramApi.listAll(undefined, scope),
  })

  const filtered = useMemo(() => {
    const byStatus = tab === 'all' ? chats : chats.filter((c) => c.status === tab)
    let byQuick = byStatus
    if (quickFilter === 'attention') byQuick = byStatus.filter(hasReviewPending)
    else if (quickFilter === 'unbound') byQuick = byStatus.filter((c) => c.status === 'unbound')
    else if (quickFilter === 'mine-active') byQuick = byStatus.filter((c) => c.is_mine && c.status === 'active')

    const q = search.trim().toLowerCase()
    const bySearch = q
      ? byQuick.filter(
          (c) =>
            (c.title ?? '').toLowerCase().includes(q) ||
            (c.student_name ?? '').toLowerCase().includes(q),
        )
      : byQuick

    return bySearch.filter((c) =>
      matchesDirectoryFilters(c.student_id ? directory.byId.get(c.student_id) : undefined, directoryFilters),
    )
  }, [chats, quickFilter, tab, search, directoryFilters, directory.byId])

  const activeFiltersCount =
    (scope !== 'all' ? 1 : 0) +
    (directoryFilters.year ? 1 : 0) +
    (directoryFilters.country ? 1 : 0) +
    (directoryFilters.degree ? 1 : 0) +
    (directoryFilters.responsibleId ? 1 : 0)

  const responsibleName = (id: string) => directory.responsibleUsers.find((u) => u.id === id)?.name ?? id
  const resetDirectoryFilters = () => {
    setScope('all')
    setDirectoryFilters(EMPTY_DIRECTORY_FILTERS)
  }

  const scopeLabels: Record<typeof scope, string> = {
    all: 'Все',
    mine: 'Только мои',
    assigned: 'С ответственными',
    unassigned: 'Без ответственного',
  }

  const filterChips = [
    scope !== 'all' && { key: 'scope', label: scopeLabels[scope], onRemove: () => setScope('all') },
    directoryFilters.year && { key: 'year', label: `Год: ${directoryFilters.year}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, year: '' })) },
    directoryFilters.country && { key: 'country', label: `Страна: ${directoryFilters.country}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, country: '' })) },
    directoryFilters.degree && {
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[directoryFilters.degree as DegreeLevel] ?? directoryFilters.degree}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, degree: '' })),
    },
    directoryFilters.responsibleId && {
      key: 'responsible',
      label: `Ответственный: ${responsibleName(directoryFilters.responsibleId)}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, responsibleId: '' })),
    },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const invalidate = () => qc.invalidateQueries({ queryKey: ['telegram-chats'] })

  const attachMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.attach(attachTarget!.id, studentId),
    onSuccess: () => {
      invalidate()
      setAttachTarget(null)
      toast({ title: 'Чат привязан' })
    },
    onError: (err) => toast({ title: 'Не удалось привязать чат', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Коммуникации"
        title="Чаты"
        description="Telegram-диалоги со студентами. Внутренний чат со студентом открывается прямо внутри диалога."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск по названию чата или студенту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <FilterPopover activeCount={activeFiltersCount} onReset={resetDirectoryFilters}>
          <FilterField label="Видимость">
            <div className="grid grid-cols-4 gap-1 rounded-panel border border-p-line bg-p-bg p-1">
              {[
                { value: 'all', label: 'Все' },
                { value: 'mine', label: 'Мои' },
                { value: 'assigned', label: 'С отв.' },
                { value: 'unassigned', label: 'Без отв.' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setScope(item.value as typeof scope)}
                  className={`px-2 py-1.5 text-[12px] font-medium rounded-ctl transition-colors ${
                    scope === item.value
                      ? 'bg-white text-black shadow-sm'
                      : 'text-p-muted hover:text-black hover:bg-p-bg'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </FilterField>
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Год">
              <Select
                value={directoryFilters.year || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, year: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все годы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все годы</SelectItem>
                  {directory.years.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ступень">
              <Select
                value={directoryFilters.degree || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, degree: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все ступени" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ступени</SelectItem>
                  {directory.degrees.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {DEGREE_LEVEL_LABELS[opt.value as DegreeLevel] ?? opt.value} · {opt.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          <FilterField label="Страна поступления">
            <Select
              value={directoryFilters.country || 'all'}
              onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, country: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все страны" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все страны</SelectItem>
                {directory.countries.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          {directory.canFilterByResponsible && (
            <FilterField label="Ответственный (ментор/МЗК)">
              <ResponsiblePicker
                users={directory.responsibleUsers}
                value={directoryFilters.responsibleId}
                onChange={(id) => setDirectoryFilters((f) => ({ ...f, responsibleId: id }))}
              />
            </FilterField>
          )}
        </FilterPopover>
      </div>

      <FilterChips chips={filterChips} onResetAll={resetDirectoryFilters} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-p-line bg-p-bg px-3 py-2">
        <div className="text-sm text-p-muted">
          {filtered.length} из {chats.length} чатов
          {quickFilter !== 'none' ? ' · включён быстрый фильтр' : ''}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {[
            { value: 'attention', label: 'Требуют внимания', icon: <MessageSquareWarning className="w-3.5 h-3.5" /> },
            { value: 'unbound', label: 'Новые без студента', icon: null },
            { value: 'mine-active', label: 'Мои активные', icon: null },
          ].map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={quickFilter === item.value ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setQuickFilter((current) => current === item.value ? 'none' : item.value as QuickFilter)}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-p-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === t.value
                ? 'border-black text-p-text font-medium'
                : 'border-transparent text-p-muted hover:text-p-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-p-text">Чатов по этому фильтру нет</p>
          <p className="mt-1 text-sm text-p-muted">
            Начните с фильтра «Требуют внимания» или «Новые без студента», если обрабатываете входящие сообщения.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((chat) => {
            const name = chat.student_name || chat.title || `Чат ${chat.chat_id}`
            const open = () => navigate(`/telegram-inbox/${chat.id}`)
            return (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              onClick={open}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
              className="group flex cursor-pointer items-start gap-3 rounded-panel border border-p-line bg-card px-4 py-3 transition-colors hover:border-p-muted2 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xs font-black text-black ${avatarGradient(chat.student_id || chat.id)}`}>
                {initials(name)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-p-text">{name}</span>
                  <span className={`shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] ${TELEGRAM_STATUS_COLORS[chat.status]}`}>{TELEGRAM_STATUS_LABELS[chat.status]}</span>
                  {!chat.student_id && chat.status === 'unbound' && (
                    <span className="shrink-0 rounded-pill border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">новый · без студента</span>
                  )}
                </div>

                <div className="mt-1 truncate text-[12px] text-p-muted">
                  {chat.last_message_preview || 'Без сообщений'}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {hasReviewPending(chat) && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
                      <MessageSquareWarning className="h-3 w-3" /> инсайт на проверку · {chat.pending_insight_count}
                    </span>
                  )}
                  {chat.has_context_signal && (
                    <span className="rounded-pill bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">важный контекст</span>
                  )}
                  {chat.unresolved_attachment_count > 0 && (
                    <span className="rounded-pill border border-p-line px-1.5 py-0.5 text-p-muted">вложения · {chat.unresolved_attachment_count}</span>
                  )}
                  {chat.is_mine && (
                    <span className="rounded-pill border border-p-line px-1.5 py-0.5 text-p-muted">мой</span>
                  )}
                  <span className="text-p-muted2">{chat.chat_type} · {formatDate(chat.last_message_at)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {canManage && (chat.status === 'unbound' || chat.status === 'closed') && (
                  <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setAttachTarget(chat)}>
                    {chat.status === 'closed' ? 'Открыть заново' : 'Привязать студента'}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={open}>
                  Открыть
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      <StudentPickerDialog
        open={!!attachTarget}
        title="Привязать Telegram-чат"
        onClose={() => setAttachTarget(null)}
        onSelect={(studentId) => attachMutation.mutate(studentId)}
        isPending={attachMutation.isPending}
      />
    </div>
  )
}
