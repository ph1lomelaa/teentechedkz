import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronDown, Clock3, Download, Paperclip, Plus, Search, Send, Sparkles, X } from 'lucide-react'
import { chatApi, ConversationListItem } from '@/api/chat'
import { telegramApi } from '@/api/telegram'
import { workspaceApi, WorkspaceScopeParams } from '@/api/workspace'
import type { TelegramChat, TelegramContextDraft } from '@/types'
import { ChatThread } from '@/components/shared/ChatThread'
import { TelegramGroupManager } from '@/components/shared/TelegramGroupManager'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useWsEvent } from '@/lib/ws'
import { AppButton, AppCard, EmptyState, PageHeader, Pill, SegmentedTabs } from '@/components/ui'

// Roles that render on the staff side of the dialog (right, accented). Everyone
// else — student/client/unknown — renders on the client side (left). Keyed off
// sender_role so the layout is consistent for every viewer, not just the person
// whose own messages happen to be theirs (is_current_user).
const STAFF_SIDE_ROLES = new Set(['mentor', 'admin', 'mzk_manager', 'staff'])
function isStaffSide(senderRole?: string | null): boolean {
  return senderRole ? STAFF_SIDE_ROLES.has(senderRole) : false
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Deterministic avatar tint so the same student keeps the same colour across the
// list — makes a long inbox scannable by colour, not just by reading names.
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

type Channel = 'all' | 'telegram' | 'internal'
type UnifiedConversation = {
  key: string
  channel: Exclude<Channel, 'all'>
  id: string
  studentId: string | null
  title: string
  preview: string | null
  updatedAt: string
  unread: number
  internal?: ConversationListItem
  telegram?: TelegramChat
}

type UnifiedStudentConversation = {
  key: string
  studentId: string
  title: string
  preview: string | null
  updatedAt: string
  unread: number
  internal?: ConversationListItem
  telegram?: TelegramChat
}

export const WorkspaceChatPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { mentorId, params, isPreview } = useWorkspaceScope()
  const isManager = user?.role === 'admin' || user?.role === 'mzk_manager'
  const effectiveWorkspaceParams: WorkspaceScopeParams = useMemo(() => {
    if (mentorId) return { mentor_id: mentorId }
    return isManager ? { scope: 'all' } : params
  }, [isManager, mentorId, params])

  const searchParams = new URLSearchParams(window.location.search)
  const requestedStudentId = searchParams.get('student_id')
  const requestedChannel = searchParams.get('channel')
  const requestedMessageId = searchParams.get('message_id')
  const [channel, setChannel] = useState<Channel>(
    requestedChannel === 'internal' ? 'internal' : 'telegram',
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [connectGroupOpen, setConnectGroupOpen] = useState(false)
  const [connectStudentId, setConnectStudentId] = useState<string>(requestedStudentId || '')
  const [createInternalOpen, setCreateInternalOpen] = useState(false)
  const [createInternalStudentId, setCreateInternalStudentId] = useState<string>(requestedStudentId || '')

  const { data: conversations = [], isLoading: internalLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'conversations', mentorId],
    queryFn: () => chatApi.conversations(mentorId ? { mentor_id: mentorId } : undefined),
  })
  const { data: telegramChats = [], isLoading: telegramLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram', mentorId, isManager ? 'all' : 'mine'],
    queryFn: () => telegramApi.listAll(undefined, mentorId || isManager ? 'all' : 'mine', mentorId),
  })
  const { data: workspaceStudents, isLoading: studentsLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'students', mentorId, effectiveWorkspaceParams.scope || 'preview'],
    queryFn: () => workspaceApi.students(effectiveWorkspaceParams),
    enabled: (connectGroupOpen || createInternalOpen) && !isPreview,
  })
  const { data: unreadData } = useQuery({
    queryKey: ['workspace', 'chat', 'unread', mentorId, effectiveWorkspaceParams.scope || 'preview'],
    queryFn: () => workspaceApi.messageUnread(effectiveWorkspaceParams),
    refetchInterval: 15_000,
  })
  const unread = useMemo(() => unreadData?.items ?? {}, [unreadData?.items])

  const allItems = useMemo<UnifiedConversation[]>(() => [
    ...conversations.map((conversation) => ({
      key: `internal-${conversation.id}`,
      channel: 'internal' as const,
      id: conversation.id,
      studentId: conversation.student?.id || null,
      title: conversation.student?.full_name || conversation.title || conversation.other?.name || 'Внутренний диалог',
      preview: conversation.last_message?.body || null,
      updatedAt: conversation.updated_at,
      unread: conversation.student?.id ? unread[conversation.student.id]?.internal ?? conversation.unread : conversation.unread,
      internal: conversation,
    })),
    ...telegramChats.map((chat) => ({
      key: `telegram-${chat.id}`,
      channel: 'telegram' as const,
      id: chat.id,
      studentId: chat.student_id,
      title: chat.student_name || chat.title || String(chat.chat_id),
      preview: chat.last_message_preview,
      updatedAt: chat.last_message_at || chat.created_at,
      unread: chat.student_id ? unread[chat.student_id]?.telegram ?? 0 : 0,
      telegram: chat,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [conversations, telegramChats, unread])

  const studentItems = useMemo<UnifiedStudentConversation[]>(() => {
    const grouped = new Map<string, UnifiedStudentConversation>()
    allItems.forEach((item) => {
      if (!item.studentId) return
      const current = grouped.get(item.studentId)
      const isLatest = !current || new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()
      const next: UnifiedStudentConversation = current || {
        key: `student-${item.studentId}`,
        studentId: item.studentId,
        title: item.title,
        preview: item.preview,
        updatedAt: item.updatedAt,
        unread: 0,
      }
      next.unread += item.unread
      if (item.internal) next.internal = item.internal
      if (item.telegram) next.telegram = item.telegram
      if (isLatest) {
        next.title = item.title
        next.preview = item.preview
        next.updatedAt = item.updatedAt
      }
      grouped.set(item.studentId, next)
    })
    return [...grouped.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [allItems])

  const items = channel === 'all'
    ? studentItems
    : allItems.filter((item) => item.channel === channel)

  // List-side search + "unread only" filter. Unread is our proxy for "требует
  // ответа" — an unread thread means the student wrote and we haven't caught up.
  const unreadTotal = items.reduce((sum, item) => sum + (item.unread > 0 ? 1 : 0), 0)
  const listQuery = listSearch.trim().toLowerCase()
  const visibleItems = items.filter((item) => {
    if (unreadOnly && item.unread <= 0) return false
    if (!listQuery) return true
    return item.title.toLowerCase().includes(listQuery) || (item.preview ?? '').toLowerCase().includes(listQuery)
  })
  const selected = items.find((item) => item.key === selectedKey)
    || items.find((item) => requestedStudentId && item.studentId === requestedStudentId)
    || items[0]

  useEffect(() => {
    if (requestedStudentId) {
      const byStudent = items.find((item) => item.studentId === requestedStudentId)
      setSelectedKey(byStudent?.key || null)
      return
    }
    setSelectedKey(items[0]?.key || null)
  }, [mentorId, requestedStudentId])

  useEffect(() => {
    if (!items.length) {
      setSelectedKey(null)
      return
    }
    if (!selectedKey || !items.some((item) => item.key === selectedKey)) {
      setSelectedKey(items[0].key)
    }
  }, [items, selectedKey])

  // Only students already taken on by a mentor — a fresh, unassigned lead
  // has no one to run a Telegram group or internal chat with yet.
  const assignedStudents = useMemo(
    () => (workspaceStudents?.items || []).filter((item) => item.primary_mentor),
    [workspaceStudents?.items],
  )

  useEffect(() => {
    if (!connectGroupOpen || connectStudentId || !assignedStudents.length) return
    setConnectStudentId(requestedStudentId || assignedStudents[0].student.id)
  }, [connectGroupOpen, connectStudentId, requestedStudentId, assignedStudents])

  useEffect(() => {
    if (!createInternalOpen || createInternalStudentId || !assignedStudents.length) return
    setCreateInternalStudentId(requestedStudentId || assignedStudents[0].student.id)
  }, [createInternalOpen, createInternalStudentId, requestedStudentId, assignedStudents])

  useEffect(() => {
    if (isPreview || channel !== 'internal' || !selected?.studentId) return
    workspaceApi.markMessagesRead(selected.studentId, 'internal').then(() => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
    }).catch(() => {})
  }, [channel, isPreview, queryClient, selected?.studentId])

  const loading = internalLoading || telegramLoading
  const connectStudent = assignedStudents.find((item) => item.student.id === connectStudentId)?.student
  const connectChat = telegramChats.find((chat) => chat.student_id === connectStudentId && chat.status !== 'closed') || null
  const createInternalStudent = assignedStudents.find((item) => item.student.id === createInternalStudentId)?.student

  const createInternalMutation = useMutation({
    mutationFn: () => chatApi.staffConversation(createInternalStudentId),
    onSuccess: (conversation) => {
      setCreateInternalOpen(false)
      setCreateInternalStudentId('')
      setChannel('internal')
      setSelectedKey(`internal-${conversation.id}`)
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'conversations'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
      toast({ title: 'Внутренний диалог открыт' })
    },
    onError: () => toast({ title: 'Не удалось открыть внутренний диалог', variant: 'destructive' }),
  })

  return (
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow={isPreview ? 'Preview чатов ментора' : 'Кабинет ментора'}
        title="Чат"
        description="Telegram и внутренние диалоги со студентами в одном рабочем разделе."
      />

      {connectGroupOpen && !isPreview && (
        <AppCard colorPrefix="w" className="mb-5 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-display text-xl font-black text-w-ink">Telegram-группа ученика</div>
              <p className="mt-1 text-sm text-w-muted">
                {connectChat
                  ? 'Управляйте подключённой группой: название, готовность бота, доступ ученика.'
                  : 'Выберите ученика — ниже появятся инструменты создания или привязки его группы.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {connectStudent && (
                <a href={`/workspace/students/${connectStudent.id}#telegram`} className="text-xs font-bold text-w-accentText hover:underline">
                  Открыть карточку ученика →
                </a>
              )}
              <button
                type="button"
                onClick={() => setConnectGroupOpen(false)}
                className="text-w-muted hover:text-w-ink"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <label className="block max-w-xl">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-w-muted">Ученик</span>
            <select
              aria-label="Ученик для Telegram-группы"
              value={connectStudentId}
              onChange={(event) => setConnectStudentId(event.target.value)}
              disabled={studentsLoading}
              className="h-11 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm font-bold text-w-ink outline-none focus:border-w-accentDim"
            >
              <option value="">Выберите ученика</option>
              {assignedStudents.map((item) => (
                <option key={item.student.id} value={item.student.id}>
                  {item.student.full_name} · {item.student.intake_year}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 border-t border-w-line pt-5">
            {studentsLoading ? (
              <p className="text-sm text-w-muted">Загрузка учеников...</p>
            ) : !assignedStudents.length ? (
              <EmptyState colorPrefix="w" title="Нет доступных учеников" description="Сначала назначьте ученика себе или выберите ментора в режиме preview." />
            ) : connectStudent ? (
              <TelegramGroupManager
                key={connectStudent.id}
                studentId={connectStudent.id}
                studentName={connectStudent.full_name}
                chat={connectChat}
                variant="workspace"
              />
            ) : (
              <EmptyState colorPrefix="w" title="Выберите ученика" description="После выбора появятся инструменты создания и подключения Telegram-группы." />
            )}
          </div>
        </AppCard>
      )}

      {createInternalOpen && !isPreview && (
        <AppCard colorPrefix="w" className="mb-5 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-display text-xl font-black text-w-ink">Новый внутренний диалог</div>
              <p className="mt-1 text-sm text-w-muted">
                Это отдельный чат кабинета, он не зависит от Telegram-группы.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateInternalOpen(false)}
              className="text-w-muted hover:text-w-ink"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="block max-w-xl">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-w-muted">Ученик</span>
            <select
              aria-label="Ученик для внутреннего чата"
              value={createInternalStudentId}
              onChange={(event) => setCreateInternalStudentId(event.target.value)}
              disabled={studentsLoading}
              className="h-11 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm font-bold text-w-ink outline-none focus:border-w-accentDim"
            >
              <option value="">Выберите ученика</option>
              {assignedStudents.map((item) => (
                <option key={item.student.id} value={item.student.id}>
                  {item.student.full_name} · {item.student.intake_year}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-w-line pt-4">
            <div className="text-xs text-w-muted">
              {createInternalStudent ? `Будет открыт диалог со студентом ${createInternalStudent.full_name}.` : 'Выберите студента для запуска чата.'}
            </div>
            <AppButton colorPrefix="w"
              size="sm"
              disabled={!createInternalStudentId || createInternalMutation.isPending}
              onClick={() => createInternalMutation.mutate()}
            >
              {createInternalMutation.isPending ? 'Открываем...' : 'Открыть чат'}
            </AppButton>
          </div>
        </AppCard>
      )}

      <div className="mb-5">
        <SegmentedTabs colorPrefix="w"
          value={channel}
          onChange={(value) => setChannel(value as Channel)}
          tabs={[
            { value: 'telegram', label: 'Telegram' },
            { value: 'internal', label: 'Внутренний чат' },
          ]}
        />
      </div>

      {!loading && items.length === 0 ? (
        <EmptyState colorPrefix="w"
          title={channel === 'telegram' ? 'Telegram-диалогов пока нет' : 'Внутренних диалогов пока нет'}
          description={channel === 'telegram'
            ? 'Подключите Telegram-группу студента, чтобы сообщения появились в ленте.'
            : 'Это отдельный чат кабинета. Откройте новый диалог со студентом.'}
          action={!isPreview ? (
            channel === 'telegram' ? (
              <AppButton colorPrefix="w" size="sm" onClick={() => setConnectGroupOpen(true)}>
                <Plus className="h-4 w-4" /> Подключить группу
              </AppButton>
            ) : (
              <AppButton colorPrefix="w" size="sm" onClick={() => setCreateInternalOpen(true)}>
                <Plus className="h-4 w-4" /> Открыть внутренний чат
              </AppButton>
            )
          ) : undefined}
        />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <AppCard colorPrefix="w" className="flex max-h-[600px] flex-col p-3">
          <div className="mb-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-w-muted2" />
              <input
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="Поиск по студенту или сообщению"
                className="h-9 w-full rounded-ctl border border-w-line bg-w-panel2 pl-8 pr-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setUnreadOnly(false)}
                className={cn('rounded-full px-3 py-1 text-[11px] font-bold transition', !unreadOnly ? 'bg-w-accent text-black' : 'border border-w-line text-w-muted hover:text-w-ink')}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly(true)}
                className={cn('rounded-full px-3 py-1 text-[11px] font-bold transition', unreadOnly ? 'bg-w-accent text-black' : 'border border-w-line text-w-muted hover:text-w-ink')}
              >
                Требуют ответа{unreadTotal > 0 ? ` · ${unreadTotal}` : ''}
              </button>
            </div>
          </div>
          {loading ? (
            <p className="p-3 text-sm text-w-muted">Загрузка диалогов...</p>
          ) : visibleItems.length === 0 ? (
            <p className="p-3 text-sm text-w-muted">
              {unreadOnly ? 'Непрочитанных диалогов нет.' : 'Ничего не найдено.'}
            </p>
          ) : (
            <div className="-mr-1 space-y-1.5 overflow-y-auto pr-1">
              {visibleItems.map((item) => {
                const active = selected?.key === item.key
                const itemChannel = 'channel' in item ? item.channel : 'all'
                const paused = item.telegram?.status === 'paused'
                const hasUnread = item.unread > 0
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedKey(item.key)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-panel border border-w-line px-3 py-2.5 text-left transition',
                      active
                        ? 'border-l-[3px] border-l-w-accent bg-w-accent/10 text-w-ink'
                        : 'bg-w-panel2 text-w-ink hover:border-w-accentDim',
                    )}
                  >
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[11px] font-black text-black', avatarGradient(item.studentId || item.title))}>
                      {initialsFrom(item.title)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('min-w-0 flex-1 truncate text-sm font-black', active && 'text-w-accentText')}>{item.title}</span>
                        <span className="shrink-0 text-[10px] text-w-muted2">{formatDate(item.updatedAt)}</span>
                      </span>
                      {item.preview && (
                        <span className={cn('mt-0.5 block truncate text-xs', hasUnread ? 'font-semibold text-w-ink' : 'text-w-muted')}>
                          {item.preview}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                          itemChannel === 'telegram' ? 'bg-sky-500/15 text-sky-300' : itemChannel === 'internal' ? 'bg-white/8 text-w-muted' : 'bg-white/8 text-w-muted')}>
                          {itemChannel === 'all' ? 'TG + внутр.' : itemChannel === 'telegram' ? 'Telegram' : 'Внутренний'}
                        </span>
                        {hasUnread && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-w-accent text-black">Ответить</span>}
                        {paused && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-w-line text-w-muted2">Пауза</span>}
                        <span className="ml-auto" />
                        {hasUnread && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-w-accent px-1.5 text-[10px] font-black text-black">
                            {item.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </AppCard>

        <AppCard colorPrefix="w" className="p-5">
          {!selected || !user ? (
            <EmptyState colorPrefix="w" title="Выберите диалог" description="Сообщения откроются справа." />
          ) : channel === 'all' ? (
            selected.studentId ? (
              <UnifiedThread
                studentId={selected.studentId}
                title={selected.title}
                internal={selected.internal}
                telegram={selected.telegram}
                scopeParams={params}
                highlightedMessageId={requestedMessageId}
                readOnly={isPreview}
                onOpenChannel={setChannel}
              />
            ) : selected.telegram ? (
              <TelegramThread chat={selected.telegram} readOnly={isPreview} />
            ) : null
          ) : 'channel' in selected && selected.channel === 'internal' && selected.internal ? (
            <>
              <ConversationHeader title={selected.title} channel="Внутренний чат" />
              <ChatThread
                conversationId={selected.internal.id}
                currentUserId={user.id}
                heightClass="h-[560px]"
                variant="portal"
                readOnly={selected.internal.can_write === false}
              />
            </>
          ) : selected.telegram ? (
            <TelegramThread chat={selected.telegram} readOnly={isPreview} />
          ) : null}
        </AppCard>
      </div>
      )}
    </div>
  )
}

function UnifiedThread({
  studentId,
  title,
  internal,
  telegram,
  scopeParams,
  highlightedMessageId,
  readOnly,
  onOpenChannel,
}: {
  studentId: string
  title: string
  internal?: ConversationListItem
  telegram?: TelegramChat
  scopeParams: WorkspaceScopeParams
  highlightedMessageId: string | null
  readOnly: boolean
  onOpenChannel: (channel: Channel) => void
}) {
  const queryClient = useQueryClient()
  const [messageText, setMessageText] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<TelegramContextDraft | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryKey = ['workspace', 'chat', 'unified-messages', studentId, scopeParams.mentor_id, search]
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => workspaceApi.studentMessages(studentId, {
      ...scopeParams,
      limit: 100,
      offset: pageParam,
      q: search.trim() || undefined,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    refetchInterval: 15_000,
  })
  const messages = useMemo(() => (data?.pages.flatMap((page) => page.items) ?? [])
    .filter((message, index, all) => all.findIndex((item) => item.id === message.id && item.source === message.source) === index)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [data?.pages])

  const latestMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (!highlightedMessageId || !data) return
    const element = document.getElementById(`workspace-message-${highlightedMessageId}`)
    if (!element && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
      return
    }
    element?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [data, fetchNextPage, hasNextPage, highlightedMessageId, isFetchingNextPage])

  useEffect(() => {
    if (readOnly) return
    workspaceApi.markMessagesRead(studentId, 'all').then(() => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'conversations'] })
    }).catch(() => {})
  }, [latestMessageId, queryClient, readOnly, studentId])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'conversations'] })
  }

  useWsEvent('message.new', (payload) => {
    const event = payload as { conversation_id?: string }
    if (internal && event.conversation_id === internal.id) refresh()
  })

  const sendMutation = useMutation({
    mutationFn: () => chatApi.send(internal!.id, messageText.trim()),
    onSuccess: () => {
      setMessageText('')
      refresh()
    },
    onError: () => toast({ title: 'Не удалось отправить сообщение', variant: 'destructive' }),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => chatApi.uploadAttachment(internal!.id, file),
    onSuccess: () => {
      refresh()
      if (fileInputRef.current) fileInputRef.current.value = ''
      toast({ title: 'Файл отправлен и сохранён в документах' })
    },
    onError: () => toast({
      title: 'Не удалось отправить файл',
      description: 'Доступны PDF, JPG, PNG и WEBP до 25 МБ.',
      variant: 'destructive',
    }),
  })

  const draftMutation = useMutation({
    mutationFn: () => workspaceApi.createContextDraft(studentId, {
      limit: 120,
      q: search.trim() || undefined,
      mentor_id: scopeParams.mentor_id,
    }),
    onSuccess: setDraft,
    onError: () => toast({ title: 'Не удалось подготовить общий AI-разбор', variant: 'destructive' }),
  })
  const applyDraftMutation = useMutation({
    mutationFn: () => workspaceApi.applyContextDraft(studentId, draft!),
    onSuccess: (result) => {
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      toast({ title: 'AI-разбор применён', description: `Создано задач: ${result.tasks_created}` })
    },
    onError: () => toast({ title: 'Не удалось применить AI-разбор', variant: 'destructive' }),
  })

  const download = async (kind: 'internal' | 'telegram', attachmentId: string, fileName: string) => {
    try {
      const blob = kind === 'internal'
        ? await chatApi.downloadAttachment(attachmentId)
        : await telegramApi.downloadAttachment(attachmentId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Не удалось скачать файл', variant: 'destructive' })
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <ConversationHeader title={title} channel="Все каналы" />
        <div className="flex gap-2">
          {!readOnly && (
            <AppButton colorPrefix="w" size="sm" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
              <Sparkles className="h-3.5 w-3.5" />{draftMutation.isPending ? 'AI анализирует...' : 'Общий AI-разбор'}
            </AppButton>
          )}
          {telegram && <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => onOpenChannel('telegram')}>Telegram-инструменты</AppButton>}
          {internal && <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => onOpenChannel('internal')}>Внутренний чат</AppButton>}
        </div>
      </div>

      {draft && (
        <div className="mb-4 rounded-panel border border-w-accentDim/40 bg-w-accent/10 p-4">
          <div className="mb-2 flex items-center gap-2 font-display text-sm font-black text-w-accentText"><Bot className="h-4 w-4" />Предпросмотр общей истории</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-w-ink">{draft.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill colorPrefix="w">Профиль: {draft.profile_updates.length}</Pill>
            <Pill colorPrefix="w">Задачи: {draft.follow_ups.length}</Pill>
            <Pill colorPrefix="w">Документы: {draft.document_flags.length}</Pill>
          </div>
          <div className="mt-4 flex gap-2">
            <AppButton colorPrefix="w" size="sm" onClick={() => applyDraftMutation.mutate()} disabled={applyDraftMutation.isPending}>Подтвердить и применить</AppButton>
            <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => setDraft(null)}>Отмена</AppButton>
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по Telegram и внутреннему чату"
          className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 pl-9 pr-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
        />
      </div>

      <div className="h-[520px] space-y-2.5 overflow-y-auto rounded-panel border border-w-line bg-w-panel2 p-4">
        {hasNextPage && (
          <div className="text-center">
            <AppButton colorPrefix="w" size="sm" variant="ghost" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Загрузка...' : 'Загрузить более ранние сообщения'}
            </AppButton>
          </div>
        )}
        {isLoading ? (
          <p className="text-center text-sm text-w-muted">Загрузка общей истории...</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-w-muted">Сообщений пока нет.</p>
        ) : messages.map((message) => {
          const staffSide = isStaffSide(message.sender_role)
          return (
          <div
            id={`workspace-message-${message.id}`}
            key={`${message.source}-${message.id}`}
            className={cn(
              'flex rounded-panel transition',
              staffSide ? 'justify-end' : 'justify-start',
              highlightedMessageId === message.id && 'ring-2 ring-w-accent ring-offset-2 ring-offset-w-panel2',
            )}
          >
            <div className={cn(
              'max-w-[82%] rounded-ctl border px-3 py-2 text-sm',
              staffSide ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel text-w-ink',
            )}>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em]">
                <span className={staffSide ? 'text-black/90' : 'text-w-accentText'}>{message.sender_name || 'Участник'}</span>
                <span className={cn('rounded-full px-1.5 py-0.5', staffSide ? 'bg-black/15 text-black/85' : 'bg-w-panel2 text-w-muted')}>
                  {message.source === 'telegram' ? 'Telegram' : 'Внутренний'}
                </span>
              </div>
              {message.body && <div className="whitespace-pre-wrap break-words">{message.body}</div>}
              {message.attachments.map((attachment) => (
                <button
                  key={`${attachment.kind}-${attachment.id}`}
                  type="button"
                  disabled={!attachment.can_download}
                  onClick={() => download(attachment.kind, attachment.id, attachment.file_name || 'attachment')}
                  className="mt-2 flex w-full items-center gap-2 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-left text-xs font-bold text-w-muted disabled:opacity-50"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                  <Download className="h-3.5 w-3.5" />
                </button>
              ))}
              <div className={cn('mt-1 text-[10px] tabular-nums', staffSide ? 'text-black/80' : 'text-w-muted2')}>
                {formatDate(message.created_at)}
              </div>
            </div>
          </div>
          )
        })}
      </div>

      {!readOnly && internal?.can_write !== false && internal && (
        <div className="mt-3 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Выберите файл для внутреннего чата"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0]
              if (selectedFile) uploadMutation.mutate(selectedFile)
            }}
          />
          <AppButton colorPrefix="w"
            size="sm"
            variant="ghost"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Прикрепить файл"
          >
            <Paperclip className="h-4 w-4" />
          </AppButton>
          <input
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && messageText.trim()) {
                event.preventDefault()
                sendMutation.mutate()
              }
            }}
            placeholder="Ответить во внутренний чат…"
            className="h-10 flex-1 rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <AppButton colorPrefix="w"
            size="sm"
            disabled={!messageText.trim() || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
            aria-label="Отправить во внутренний чат"
          >
            <Send className="h-4 w-4" />
          </AppButton>
        </div>
      )}
      {!internal && (
        <p className="mt-3 text-xs text-w-muted">Внутренний диалог ещё не создан. Его можно открыть из карточки студента.</p>
      )}
    </>
  )
}

function ConversationHeader({ title, channel }: { title: string; channel: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <div className="font-display text-lg font-black text-w-ink">{title}</div>
        <div className="mt-1 text-xs text-w-muted">{channel}</div>
      </div>
      <Pill colorPrefix="w">{channel}</Pill>
    </div>
  )
}

function TelegramThread({ chat, readOnly = false }: { chat: TelegramChat; readOnly?: boolean }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<TelegramContextDraft | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [outgoingText, setOutgoingText] = useState('')
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram-messages', chat.id],
    queryFn: () => telegramApi.listMessages(chat.id, { limit: 200 }),
    refetchInterval: 15_000,
  })
  const { data: participants = [] } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram-participants', chat.id],
    queryFn: () => telegramApi.listParticipants(chat.id),
  })
  const { data: sessions = [] } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram-sessions', chat.id],
    queryFn: () => telegramApi.listSessions(chat.id),
  })
  const latestTelegramMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (readOnly || !chat.student_id) return
    workspaceApi.markMessagesRead(chat.student_id, 'telegram').then(() => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
    }).catch(() => {})
  }, [chat.student_id, latestTelegramMessageId, queryClient, readOnly])
  const identifyMutation = useMutation({
    mutationFn: (telegramUserId: number) => telegramApi.identifySelf(chat.id, telegramUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-participants', chat.id] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-messages', chat.id] })
      toast({ title: 'Telegram-аккаунт сотрудника подтверждён' })
    },
    onError: () => toast({ title: 'Не удалось подтвердить аккаунт', variant: 'destructive' }),
  })
  const draftMutation = useMutation({
    mutationFn: () => telegramApi.createContextDraft(chat.id, { limit: 200 }),
    onSuccess: setDraft,
    onError: () => toast({ title: 'Не удалось подготовить AI-разбор', variant: 'destructive' }),
  })
  const applyMutation = useMutation({
    mutationFn: () => telegramApi.applyContextDraft(chat.id, draft!),
    onSuccess: () => {
      toast({ title: 'AI-разбор применён после подтверждения' })
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    },
    onError: () => toast({ title: 'Не удалось применить AI-разбор', variant: 'destructive' }),
  })
  const sendMutation = useMutation({
    mutationFn: () => telegramApi.sendMessage(chat.id, outgoingText.trim()),
    onSuccess: () => {
      setOutgoingText('')
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-messages', chat.id] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram'] })
      toast({ title: 'Сообщение отправлено в Telegram' })
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось отправить в Telegram', description: detail, variant: 'destructive' })
    },
  })

  const download = async (attachmentId: string, fileName: string) => {
    try {
      const blob = await telegramApi.downloadAttachment(attachmentId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Не удалось скачать файл', variant: 'destructive' })
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <ConversationHeader title={chat.student_name || chat.title || String(chat.chat_id)} channel="Telegram" />
        {!readOnly && (
          <AppButton colorPrefix="w" size="sm" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
            <Sparkles className="h-3.5 w-3.5" />
            {draftMutation.isPending ? 'AI анализирует...' : 'AI-разбор'}
          </AppButton>
        )}
      </div>

      {draft && (
        <div className="mb-4 rounded-panel border border-w-accentDim/40 bg-w-accent/10 p-4">
          <div className="mb-2 flex items-center gap-2 font-display text-sm font-black text-w-accentText">
            <Bot className="h-4 w-4" /> Предпросмотр AI-разбора
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-w-ink">{draft.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-w-muted">
            <Pill colorPrefix="w">Изменения профиля: {draft.profile_updates.length}</Pill>
            <Pill colorPrefix="w">Задачи: {draft.follow_ups.length}</Pill>
            <Pill colorPrefix="w">Документы: {draft.document_flags.length}</Pill>
          </div>
          <div className="mt-4 flex gap-2">
            <AppButton colorPrefix="w" size="sm" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              Подтвердить и применить
            </AppButton>
            <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => setDraft(null)}>Отмена</AppButton>
          </div>
        </div>
      )}

      {participants.length > 0 && (
        <div className="mb-4 rounded-panel border border-w-line bg-w-panel2 p-4">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-w-muted">Какой Telegram-аккаунт ваш?</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {participants.map((participant) => (
              <button
                key={participant.telegram_user_id}
                type="button"
                disabled={participant.is_current_user || identifyMutation.isPending}
                onClick={() => identifyMutation.mutate(participant.telegram_user_id)}
                className={cn(
                  'rounded-ctl border px-3 py-2 text-xs font-bold transition',
                  participant.is_current_user
                    ? 'border-w-good/40 bg-w-good/10 text-w-good'
                    : 'border-w-line bg-w-panel text-w-muted hover:border-w-accentDim hover:text-w-accentText',
                )}
              >
                {participant.sender_name || participant.display_name || participant.telegram_user_id}
                {participant.is_current_user ? ' · Это мой аккаунт' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-panel border border-w-line bg-w-panel2">
          <button
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] text-w-muted hover:text-w-accentText"
            aria-expanded={historyOpen}
          >
            <Clock3 className="h-4 w-4" />
            <span className="flex-1">История привязок · {sessions.length}</span>
            <ChevronDown className={cn('h-4 w-4 transition', historyOpen && 'rotate-180')} />
          </button>
          {historyOpen && (
            <div className="border-t border-w-line px-4 py-3">
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div key={session.id} className="rounded-ctl border border-w-line bg-w-panel px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-w-ink">{session.student_name || 'Студент не указан'}</span>
                      <Pill colorPrefix="w" tone={session.status === 'active' ? 'good' : 'neutral'}>
                        {session.status === 'active' ? 'Активна' : 'Закрыта'}
                      </Pill>
                    </div>
                    <div className="mt-1 text-w-muted">
                      {formatDate(session.opened_at)}
                      {session.closed_at ? ` — ${formatDate(session.closed_at)}` : ''}
                      {session.opened_by_name ? ` · подключил ${session.opened_by_name}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="h-[560px] space-y-2.5 overflow-y-auto rounded-panel border border-w-line bg-w-panel2 p-4">
        {isLoading ? (
          <p className="text-center text-sm text-w-muted">Загрузка сообщений...</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-w-muted">Сообщений пока нет.</p>
        ) : (
          messages.map((message) => {
            const staffSide = isStaffSide(message.sender_role)
            return (
            <div key={message.id} className={cn('flex', staffSide ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[82%] rounded-ctl border px-3 py-2 text-sm',
                staffSide ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel text-w-ink',
              )}>
                <div className={cn('mb-1 text-[11px] font-bold', staffSide ? 'text-black/90' : 'text-w-accentText')}>
                  {message.sender_display_name || message.sender_name || 'Telegram'}
                </div>
                {message.raw_text && <div className="whitespace-pre-wrap break-words">{message.raw_text}</div>}
                {message.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    disabled={!attachment.can_download}
                    onClick={() => download(attachment.id, attachment.file_name || 'telegram-file')}
                    className="mt-2 flex w-full items-center gap-2 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-left text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                    <Download className="h-3.5 w-3.5" />
                  </button>
                ))}
                <div className={cn('mt-1 text-[10px] tabular-nums', staffSide ? 'text-black/80' : 'text-w-muted2')}>{formatDate(message.created_at)}</div>
              </div>
            </div>
            )
          })
        )}
      </div>
      {!readOnly && chat.status === 'active' && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={outgoingText}
            maxLength={4096}
            onChange={(event) => setOutgoingText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && outgoingText.trim()) {
                event.preventDefault()
                sendMutation.mutate()
              }
            }}
            placeholder="Отправить сообщение в Telegram…"
            className="h-10 flex-1 rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <AppButton colorPrefix="w" size="sm" disabled={!outgoingText.trim() || sendMutation.isPending} onClick={() => sendMutation.mutate()}>
            <Send className="h-4 w-4" />
          </AppButton>
        </div>
      )}
    </>
  )
}
