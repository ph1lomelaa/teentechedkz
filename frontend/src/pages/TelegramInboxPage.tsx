import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MessageSquareWarning, Paperclip, Search, Sparkles } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { mentorAssignmentsApi } from '@/api/index'
import {
  TelegramChat,
  TelegramChatStatus,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DegreeLevel,
  hasReviewPending,
} from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'

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

export default function TelegramInboxPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = true

  const [tab, setTab] = useState<TelegramChatStatus | 'all'>('all')
  const [scope, setScope] = useState<'all' | 'mine' | 'assigned' | 'unassigned'>('all')
  const [attachTarget, setAttachTarget] = useState<TelegramChat | null>(null)
  const [reassignTarget, setReassignTarget] = useState<TelegramChat | null>(null)
  const [closeTarget, setCloseTarget] = useState<TelegramChat | null>(null)
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

  const assignStudentMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: (_data, studentId) => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({
        title: 'Вы стали ответственным',
        description: 'Чат появится в фильтре «Мои».',
        action: (
          <ToastAction
            altText="Отменить"
            onClick={() => {
              if (assignStudentMutation.variables) {
                mentorAssignmentsApi.setSelfActive(assignStudentMutation.variables, false).then(invalidate).catch(() => undefined)
              }
            }}
          >
            Отменить
          </ToastAction>
        ),
      })
    },
    onError: (err) => toast({ title: 'Не удалось стать ответственным', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const attachMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.attach(attachTarget!.id, studentId),
    onSuccess: () => {
      invalidate()
      setAttachTarget(null)
      toast({ title: 'Чат привязан' })
    },
    onError: (err) => toast({ title: 'Не удалось привязать чат', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const reassignMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.reassign(reassignTarget!.id, studentId),
    onSuccess: () => {
      invalidate()
      setReassignTarget(null)
      toast({ title: 'Студент изменён' })
    },
    onError: (err) => toast({ title: 'Не удалось сменить студента', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const pauseMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.pause(chatId),
    onSuccess: (chat) => {
      invalidate()
      toast({
        title: 'AI-разбор поставлен на паузу',
        description: chat.title || `Чат ${chat.chat_id}`,
        action: (
          <ToastAction altText="Возобновить" onClick={() => resumeMutation.mutate(chat.id)}>
            Отменить
          </ToastAction>
        ),
      })
    },
    onError: (err) => toast({ title: 'Не удалось поставить на паузу', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const resumeMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.resume(chatId),
    onSuccess: (chat) => {
      invalidate()
      toast({
        title: 'AI-разбор возобновлён',
        description: chat.title || `Чат ${chat.chat_id}`,
        action: (
          <ToastAction altText="Поставить на паузу" onClick={() => pauseMutation.mutate(chat.id)}>
            Отменить
          </ToastAction>
        ),
      })
    },
    onError: (err) => toast({ title: 'Не удалось возобновить чат', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const closeMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.close(chatId),
    onSuccess: () => {
      invalidate()
      setCloseTarget(null)
      toast({ title: 'Сессия завершена' })
    },
    onError: (err) => toast({ title: 'Не удалось завершить сессию', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <CrmPageHeader
        eyebrow="Коммуникации"
        title="Telegram"
        description="Диалоги со студентами и сообщения, требующие внимания команды."
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
            <div className="grid grid-cols-4 gap-1 rounded-[2px] border border-p-line bg-p-bg p-1">
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
                  className={`px-2 py-1.5 text-[12px] font-medium rounded-[2px] transition-colors ${
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-p-line bg-p-bg px-3 py-2">
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Чат</TableHead>
              <TableHead>Статус</TableHead>
                <TableHead>Студент</TableHead>
                <TableHead>Ответственные</TableHead>
                <TableHead>Последнее сообщение</TableHead>
              <TableHead>Не разобрано</TableHead>
              {canManage && <TableHead className="text-right">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((chat) => (
              <TableRow
                key={chat.id}
                className="cursor-pointer hover:bg-p-bg"
                onClick={() => navigate(`/telegram-inbox/${chat.id}`)}
              >
                <TableCell>
                  <div className="font-medium text-p-text">{chat.title || `Чат ${chat.chat_id}`}</div>
                  <div className="text-xs text-p-muted">{chat.chat_type}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-[2px] text-xs ${TELEGRAM_STATUS_COLORS[chat.status]}`}>
                      {TELEGRAM_STATUS_LABELS[chat.status]}
                    </span>
                    {hasReviewPending(chat) && (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <MessageSquareWarning className="w-3 h-3" />
                        на проверку
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {chat.student_name ? (
                    <div className="space-y-1">
                      <span className="text-p-text">{chat.student_name}</span>
                      {chat.is_mine && (
                        <span className="block w-fit text-[10px] px-1.5 py-0.5 rounded-[2px] border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium uppercase tracking-wide">
                          Мой чат
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-p-muted2">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-p-muted max-w-[160px] block truncate">
                    {chat.responsibles?.filter((r) => r.is_active).map((r) => r.name || 'Без имени').join(', ') || '—'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-p-muted">
                  <div className="max-w-[240px] truncate">{chat.last_message_preview || '—'}</div>
                  <div className="text-xs text-p-muted2">{formatDate(chat.last_message_at)}</div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2 text-xs text-p-muted">
                    {chat.pending_insight_count > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquareWarning className="w-3.5 h-3.5" />
                        {chat.pending_insight_count} изм.
                      </span>
                    )}
                    {chat.has_context_signal && (
                      <span className="flex items-center gap-1 text-amber-700">
                        <Sparkles className="w-3.5 h-3.5" />
                        {chat.context_signal_count} конт.
                      </span>
                    )}
                    {chat.unresolved_attachment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Paperclip className="w-3.5 h-3.5" />
                        {chat.unresolved_attachment_count} файл.
                      </span>
                    )}
                  </div>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {(chat.status === 'unbound' || chat.status === 'closed') && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAttachTarget(chat)}>
                          {chat.status === 'closed' ? 'Открыть заново' : 'Привязать студента'}
                        </Button>
                      )}
                      {chat.student_id && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setReassignTarget(chat)}>
                          Сменить привязку
                        </Button>
                      )}
                      {chat.student_id && !chat.is_mine && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={assignStudentMutation.isPending && assignStudentMutation.variables === chat.student_id}
                          onClick={() => assignStudentMutation.mutate(chat.student_id!)}
                        >
                          {assignStudentMutation.isPending && assignStudentMutation.variables === chat.student_id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : 'Стать ответственным'}
                        </Button>
                      )}
                      {chat.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={pauseMutation.isPending && pauseMutation.variables === chat.id}
                          onClick={() => pauseMutation.mutate(chat.id)}
                        >
                          {pauseMutation.isPending && pauseMutation.variables === chat.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : 'Пауза AI'}
                        </Button>
                      )}
                      {chat.status === 'paused' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={resumeMutation.isPending && resumeMutation.variables === chat.id}
                          onClick={() => resumeMutation.mutate(chat.id)}
                        >
                          {resumeMutation.isPending && resumeMutation.variables === chat.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : 'Возобновить AI'}
                        </Button>
                      )}
                      {(chat.status === 'active' || chat.status === 'paused') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCloseTarget(chat)}
                        >
                          Закрыть чат
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <StudentPickerDialog
        open={!!attachTarget}
        title="Привязать Telegram-чат"
        onClose={() => setAttachTarget(null)}
        onSelect={(studentId) => attachMutation.mutate(studentId)}
        isPending={attachMutation.isPending}
      />
      <StudentPickerDialog
        open={!!reassignTarget}
        title="Сменить студента"
        description="Проверьте текущую и новую привязку перед сохранением."
        onClose={() => setReassignTarget(null)}
        onSelect={(studentId) => reassignMutation.mutate(studentId)}
        isPending={reassignMutation.isPending}
        excludeStudentId={reassignTarget?.student_id}
        currentStudentLabel={reassignTarget?.student_name}
        confirmBeforeSelect
      />

      <Dialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Завершить сессию?</DialogTitle>
            <DialogDescription>
              Чат {closeTarget?.title || `${closeTarget?.chat_id}`} будет закрыт, привязка к студенту снята.
              Историю переписки можно будет посмотреть, но чат перестанет принимать AI-разбор.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate(closeTarget!.id)}
            >
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
