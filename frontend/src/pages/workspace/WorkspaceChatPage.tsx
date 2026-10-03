import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip, Plus, Search, X } from 'lucide-react'
import { chatApi, ConversationListItem } from '@/api/chat'
import { telegramApi } from '@/api/telegram'
import { workspaceApi, WorkspaceScopeParams } from '@/api/workspace'
import type { TelegramChat, TelegramContextDraft } from '@/types'
import { ChatThread } from '@/components/shared/ChatThread'
import { TelegramGroupManager } from '@/components/shared/TelegramGroupManager'
import { ContextDraftReviewDialog } from '@/components/shared/ContextDraftReviewDialog'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { cn, formatDate } from '@/lib/utils'
import { applySummaryText } from '@/lib/contextDraft'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { AppButton, AppCard, EmptyState, PageHeader, SegmentedTabs } from '@/components/ui'
import { QueryError } from '@/components/shared/QueryState'
import {
  ChatHeader,
  DaySeparator,
  MessageBubble,
  MessageComposer,
  SearchableParticipantSelect,
  UserAvatar,
  groupFlags,
  type ChatVariant,
} from '@/components/shared/ChatPrimitives'

// Roles that render on the staff side of the dialog (right, accented). Everyone
// else — student/client/unknown — renders on the client side (left). Keyed off
// sender_role so the layout is consistent for every viewer, not just the person
// whose own messages happen to be theirs (is_current_user).
// API normalizes messages sent from the CRM as `staff`; identified Telegram
// accounts retain their concrete user role.
const STAFF_SIDE_ROLES = new Set(['staff', 'mentor', 'admin', 'mzk_manager', 'academic_head'])
function isStaffSide(senderRole?: string | null): boolean {
  return senderRole ? STAFF_SIDE_ROLES.has(senderRole) : false
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
  const isManager = user?.role === 'admin' || user?.role === 'mzk_manager' || user?.role === 'academic_head'
  const effectiveWorkspaceParams: WorkspaceScopeParams = useMemo(() => {
    if (mentorId) return { mentor_id: mentorId }
    return isManager ? { scope: 'all' } : params
  }, [isManager, mentorId, params])

  const searchParams = new URLSearchParams(window.location.search)
  const requestedStudentId = searchParams.get('student_id')
  const requestedChannel = searchParams.get('channel')
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

  const { data: conversations = [], isLoading: internalLoading, isError: internalFailed, error: internalError, refetch: refetchInternal } = useQuery({
    queryKey: ['workspace', 'chat', 'conversations', mentorId],
    queryFn: () => chatApi.conversations(mentorId ? { mentor_id: mentorId } : undefined),
  })
  const { data: telegramChats = [], isLoading: telegramLoading, isError: telegramFailed, error: telegramError, refetch: refetchTelegram } = useQuery({
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

  const items = useMemo(
    () => channel === 'all'
      ? studentItems
      : allItems.filter((item) => item.channel === channel),
    [channel, studentItems, allItems],
  )

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
  }, [mentorId, requestedStudentId, items])

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

  const variant: ChatVariant = channel === 'telegram' ? 'telegram' : 'internal'
  const loading = internalLoading || telegramLoading
  // Список склеен из внутренних диалогов и Telegram: упади любой — «Ничего не
  // найдено» отправит крутить фильтр вместо повтора запроса.
  const listFailed = internalFailed || telegramFailed
  const listError = internalError ?? telegramError
  const retryList = () => { refetchInternal(); refetchTelegram() }
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
      <PageHeader colorPrefix="w" className="mb-4 sm:mb-4"
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

      <div className="mb-3">
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
      <div data-chat-variant={variant} className="grid min-w-0 gap-3 md:h-[calc(100dvh-250px)] md:min-h-[520px] md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <AppCard colorPrefix="w" className="flex min-w-0 max-h-[280px] flex-col overflow-hidden p-0 sm:max-h-[420px] md:h-full md:max-h-none">
          <div className="shrink-0 space-y-2 border-b border-w-line p-3">
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
                className={cn('rounded-full px-3 py-1 text-[11px] font-bold transition', !unreadOnly ? 'bg-[var(--chat-send-bg)] text-[var(--chat-send-text)]' : 'border border-w-line text-w-muted hover:text-w-ink')}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly(true)}
                className={cn('rounded-full px-3 py-1 text-[11px] font-bold transition', unreadOnly ? 'bg-[var(--chat-send-bg)] text-[var(--chat-send-text)]' : 'border border-w-line text-w-muted hover:text-w-ink')}
              >
                Требуют ответа{unreadTotal > 0 ? ` · ${unreadTotal}` : ''}
              </button>
            </div>
          </div>
          {listFailed ? (
            <QueryError colorPrefix="w" error={listError} onRetry={retryList} />
          ) : loading ? (
            <p className="p-3 text-sm text-w-muted">Загрузка диалогов...</p>
          ) : visibleItems.length === 0 ? (
            <p className="p-3 text-sm text-w-muted">
              {unreadOnly ? 'Непрочитанных диалогов нет.' : 'Ничего не найдено.'}
            </p>
          ) : (
            <div className="chat-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
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
                      'flex w-full items-start gap-2.5 rounded-panel border px-2.5 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent',
                      active
                        ? 'border-transparent bg-[var(--chat-active)] text-[var(--chat-active-text)]'
                        : 'border-transparent bg-w-panel text-w-ink hover:bg-w-panel2',
                    )}
                  >
                    <UserAvatar name={item.title} size="list" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{item.title}</span>
                        <span className={cn('shrink-0 text-[10px] tabular-nums', active ? 'text-[var(--chat-active-muted)]' : 'text-w-muted')}>{formatDate(item.updatedAt)}</span>
                      </span>
                      {item.preview && (
                        <span className={cn('mt-0.5 block truncate text-xs', active ? 'text-[var(--chat-active-muted)]' : hasUnread ? 'font-semibold text-w-ink' : 'text-w-muted')}>
                          {item.preview}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="rounded border border-w-line bg-w-panel2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-w-muted">
                          {itemChannel === 'all' ? 'TG + внутр.' : itemChannel === 'telegram' ? 'Telegram' : 'Внутренний'}
                        </span>
                        {hasUnread && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-[var(--chat-badge)] text-[var(--chat-send-text)]">Ответить</span>}
                        {paused && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-w-line text-w-muted2">Пауза</span>}
                        <span className="ml-auto" />
                        {hasUnread && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--chat-badge)] px-1.5 text-[10px] font-black text-[var(--chat-send-text)]">
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

        <AppCard colorPrefix="w" className="flex min-h-[520px] min-w-0 flex-col overflow-hidden p-0 md:h-full md:min-h-0">
          {!selected || !user ? (
            <EmptyState colorPrefix="w" title="Выберите диалог" description="Сообщения откроются справа." />
          ) : 'channel' in selected && selected.channel === 'internal' && selected.internal ? (
            <>
              <ChatHeader variant="internal" title={selected.title} source="Внутренний чат" />
              <ChatThread
                conversationId={selected.internal.id}
                peerName={selected.title}
                currentUserId={user.id}
                heightClass="min-h-0 flex-1"
                variant="portal"
                readOnly={selected.internal.can_write === false}
                shellClassName="min-h-0 flex-1 rounded-none border-0"
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

function TelegramThread({ chat, readOnly = false }: { chat: TelegramChat; readOnly?: boolean }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<TelegramContextDraft | null>(null)
  const [outgoingText, setOutgoingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram-messages', chat.id],
    queryFn: () => telegramApi.listMessages(chat.id, { limit: 200 }),
    refetchInterval: 15_000,
  })
  const { data: participants = [] } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram-participants', chat.id],
    queryFn: () => telegramApi.listParticipants(chat.id),
  })
  const latestTelegramMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (readOnly || !chat.student_id) return
    workspaceApi.markMessagesRead(chat.student_id, 'telegram').then(() => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
    }).catch(() => {})
  }, [chat.student_id, latestTelegramMessageId, queryClient, readOnly])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [latestTelegramMessageId, chat.id])

  const draftMutation = useMutation({
    mutationFn: () => telegramApi.createContextDraft(chat.id, { limit: 200 }),
    onSuccess: setDraft,
    onError: (error) => toast({ title: 'Не удалось подготовить AI-разбор', description: getErrorMessage(error), variant: 'destructive' }),
  })
  const applyMutation = useMutation({
    mutationFn: (payload: TelegramContextDraft) => telegramApi.applyContextDraft(chat.id, payload),
    onSuccess: (result) => {
      toast({ title: 'AI-разбор применён', description: applySummaryText(result) })
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    },
    onError: (error) => toast({ title: 'Не удалось применить AI-разбор', description: getErrorMessage(error), variant: 'destructive' }),
  })
  const sendMutation = useMutation({
    mutationFn: () => telegramApi.sendMessage(chat.id, outgoingText.trim()),
    onSuccess: () => {
      setOutgoingText('')
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-messages', chat.id] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram'] })
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось отправить в Telegram', description: detail, variant: 'destructive' })
    },
  })

  // Student defaults to the chat's linked Telegram contact; mentor to whoever
  // is tagged as staff (the logged-in user after identify-self). Manual picks
  // are persisted as participant roles, so every viewer sees the same sides.
  const studentTgId = participants.find((p) => p.role === 'student')?.telegram_user_id
    ?? (chat.student_telegram_user_id ? Number(chat.student_telegram_user_id) : undefined)
  const mentorTgId = participants.find((p) => p.is_current_user)?.telegram_user_id
    ?? participants.find((p) => p.role === 'mentor')?.telegram_user_id
  const options = participants.map((p) => ({
    value: String(p.telegram_user_id),
    label: p.display_name || p.sender_name || `ID ${p.telegram_user_id}`,
  }))

  const roleMutation = useMutation({
    mutationFn: async ({ role, telegramUserId }: { role: 'student' | 'mentor'; telegramUserId: number }) => {
      // Only one participant per role: demote the previous holder first.
      const previous = role === 'student' ? studentTgId : mentorTgId
      if (previous && previous !== telegramUserId) {
        const prev = participants.find((p) => p.telegram_user_id === previous)
        if (prev && prev.role === role) await telegramApi.setParticipantRole(chat.id, previous, 'unknown')
      }
      if (role === 'mentor') return telegramApi.identifySelf(chat.id, telegramUserId)
      return telegramApi.setParticipantRole(chat.id, telegramUserId, 'student')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-participants', chat.id] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-messages', chat.id] })
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось сохранить участника', description: detail, variant: 'destructive' })
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
      <ChatHeader
        variant="telegram"
        title={chat.student_name || chat.title || String(chat.chat_id)}
        source="Telegram"
        onAi={readOnly ? undefined : () => draftMutation.mutate()}
        aiPending={draftMutation.isPending}
      />
      {!readOnly && (
        <div className="grid shrink-0 gap-2 border-b border-w-line bg-w-panel px-3 py-2 sm:grid-cols-2 sm:px-4">
          <SearchableParticipantSelect
            label="Студент"
            value={studentTgId ? String(studentTgId) : undefined}
            options={options}
            placeholder="Выберите студента"
            disabled={roleMutation.isPending || options.length === 0}
            onChange={(value) => roleMutation.mutate({ role: 'student', telegramUserId: Number(value) })}
          />
          <SearchableParticipantSelect
            label="Ментор"
            value={mentorTgId ? String(mentorTgId) : undefined}
            options={options}
            placeholder="Вы (не выбран)"
            disabled={roleMutation.isPending || options.length === 0}
            onChange={(value) => roleMutation.mutate({ role: 'mentor', telegramUserId: Number(value) })}
          />
        </div>
      )}

      <ContextDraftReviewDialog
        variant="workspace"
        open={!!draft}
        draft={draft}
        onDraftChange={setDraft}
        onCancel={() => setDraft(null)}
        onConfirm={(payload) => applyMutation.mutate(payload)}
        isApplying={applyMutation.isPending}
      />

      <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto [background:var(--chat-canvas)] p-3 sm:p-4">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn('h-10 animate-pulse rounded-2xl bg-w-line/60', i % 2 ? 'ml-auto w-1/3' : 'w-1/2')} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-w-muted">Сообщений пока нет.</p>
        ) : (
          messages.map((message, index) => {
            const { groupStart, groupEnd, startsDay } = groupFlags(
              messages,
              index,
              (m) => `${isStaffSide(m.sender_role) ? 'staff' : 'client'}:${m.sender_tg_id ?? m.sender_name ?? ''}`,
              (m) => m.created_at,
            )
            const outgoing = isStaffSide(message.sender_role)
            return (
              <React.Fragment key={message.id}>
                {startsDay && <DaySeparator date={message.created_at} variant="telegram" />}
                <MessageBubble
                  variant="telegram"
                  outgoing={outgoing}
                  sender={message.sender_display_name || message.sender_name}
                  showSender={chat.chat_type !== 'private' && !outgoing && groupStart}
                  groupStart={groupStart}
                  groupEnd={groupEnd}
                  timestamp={message.created_at}
                  avatar={<UserAvatar name={message.sender_display_name || message.sender_name || 'Telegram'} size="message" />}
                >
                  {message.raw_text}
                  {message.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      disabled={!attachment.can_download}
                      onClick={() => download(attachment.id, attachment.file_name || 'telegram-file')}
                      className="mt-2 flex w-full items-center gap-2 rounded-ctl border border-black/15 bg-black/5 px-2.5 py-2 text-left text-xs font-bold transition hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent disabled:opacity-50"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                      <Download className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ))}
                </MessageBubble>
              </React.Fragment>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
      {!readOnly && chat.status === 'active' && (
        <MessageComposer
          variant="telegram"
          value={outgoingText}
          onChange={setOutgoingText}
          onSend={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
          placeholder="Отправить сообщение в Telegram…"
        />
      )}
    </>
  )
}
