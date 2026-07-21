import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronDown, Clock3, Download, MessageCircle, Paperclip, Plus, Search, Send, Sparkles, X } from 'lucide-react'
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
import {
  WorkspaceButton,
  WorkspaceCard,
  WorkspaceEmptyState,
  WorkspacePageHeader,
  WorkspaceSegmentedTabs,
  WorkspaceStatusPill,
} from '@/components/workspace/ui'

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
  const searchParams = new URLSearchParams(window.location.search)
  const requestedStudentId = searchParams.get('student_id')
  const requestedChannel = searchParams.get('channel')
  const requestedMessageId = searchParams.get('message_id')
  const [channel, setChannel] = useState<Channel>(
    requestedChannel === 'telegram' ? 'telegram' : 'internal',
  )
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(requestedStudentId)
  const [connectGroupOpen, setConnectGroupOpen] = useState(false)
  const [connectStudentId, setConnectStudentId] = useState<string>(requestedStudentId || '')

  const { data: conversations = [], isLoading: internalLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'conversations', mentorId],
    queryFn: () => chatApi.conversations(params),
  })
  const { data: telegramChats = [], isLoading: telegramLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'telegram', mentorId],
    queryFn: () => telegramApi.listAll(undefined, mentorId ? 'all' : 'mine', mentorId),
  })
  const { data: workspaceStudents, isLoading: studentsLoading } = useQuery({
    queryKey: ['workspace', 'chat', 'students', mentorId],
    queryFn: () => workspaceApi.students(params),
    enabled: connectGroupOpen && !isPreview,
  })
  const { data: unreadData } = useQuery({
    queryKey: ['workspace', 'chat', 'unread', mentorId],
    queryFn: () => workspaceApi.messageUnread(params),
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
    : allItems.filter((item) => item.channel === channel && item.studentId)
  const selected = items.find((item) => item.studentId === selectedStudentId)
    || items.find((item) => requestedStudentId && item.studentId === requestedStudentId)
    || items[0]

  useEffect(() => {
    setSelectedStudentId(requestedStudentId)
  }, [mentorId, requestedStudentId])

  useEffect(() => {
    if (!connectGroupOpen || connectStudentId || !workspaceStudents?.items.length) return
    setConnectStudentId(requestedStudentId || workspaceStudents.items[0].student.id)
  }, [connectGroupOpen, connectStudentId, requestedStudentId, workspaceStudents?.items])

  useEffect(() => {
    if (isPreview || channel !== 'internal' || !selected?.studentId) return
    workspaceApi.markMessagesRead(selected.studentId, 'internal').then(() => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'unread'] })
    }).catch(() => {})
  }, [channel, isPreview, queryClient, selected?.studentId])

  const loading = internalLoading || telegramLoading
  const connectStudent = workspaceStudents?.items.find((item) => item.student.id === connectStudentId)?.student
  const connectChat = telegramChats.find((chat) => chat.student_id === connectStudentId && chat.status !== 'closed') || null

  return (
    <div className="fade-in">
      <WorkspacePageHeader
        eyebrow={isPreview ? 'Preview чатов ментора' : 'Кабинет ментора'}
        title="Чат"
        description="Telegram и внутренние диалоги со студентами в одном рабочем разделе."
      />

      {connectGroupOpen && !isPreview && (
        <WorkspaceCard className="mb-5 p-5">
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
              className="h-11 w-full rounded-[12px] border border-w-line bg-w-panel2 px-3 text-sm font-bold text-w-ink outline-none focus:border-w-accentDim"
            >
              <option value="">Выберите ученика</option>
              {(workspaceStudents?.items || []).map((item) => (
                <option key={item.student.id} value={item.student.id}>
                  {item.student.full_name} · {item.student.intake_year}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 border-t border-w-line pt-5">
            {studentsLoading ? (
              <p className="text-sm text-w-muted">Загрузка учеников...</p>
            ) : !workspaceStudents?.items.length ? (
              <WorkspaceEmptyState title="Нет доступных учеников" text="Сначала назначьте ученика себе или выберите ментора в режиме preview." />
            ) : connectStudent ? (
              <TelegramGroupManager
                key={connectStudent.id}
                studentId={connectStudent.id}
                studentName={connectStudent.full_name}
                chat={connectChat}
                variant="workspace"
              />
            ) : (
              <WorkspaceEmptyState title="Выберите ученика" text="После выбора появятся инструменты создания и подключения Telegram-группы." />
            )}
          </div>
        </WorkspaceCard>
      )}

      <div className="mb-5">
        <WorkspaceSegmentedTabs
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'telegram', label: 'Telegram' },
            { value: 'internal', label: 'Внутренний чат' },
          ]}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <WorkspaceCard className="p-3">
          {loading ? (
            <p className="p-3 text-sm text-w-muted">Загрузка диалогов...</p>
          ) : items.length === 0 ? (
            <WorkspaceEmptyState
              title="Диалогов пока нет"
              text="Подключите Telegram или откройте внутренний диалог со студентом."
              action={!isPreview ? (
                <WorkspaceButton size="sm" onClick={() => setConnectGroupOpen(true)}>
                  <Plus className="h-4 w-4" /> Подключить группу
                </WorkspaceButton>
              ) : undefined}
            />
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => {
                const active = selected?.studentId === item.studentId
                const itemChannel = 'channel' in item ? item.channel : 'all'
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedStudentId(item.studentId)}
                    className={cn(
                      'w-full rounded-[16px] border px-3 py-3 text-left transition',
                      active ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel2 text-w-ink hover:border-w-accentDim',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {itemChannel === 'telegram' ? <Send className="h-4 w-4 shrink-0" /> : <MessageCircle className="h-4 w-4 shrink-0" />}
                      <div className="min-w-0 flex-1 truncate text-sm font-black">{item.title}</div>
                      {item.unread > 0 && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', active ? 'bg-black text-w-accent' : 'bg-w-accent text-black')}>
                          {item.unread}
                        </span>
                      )}
                    </div>
                    {item.preview && <div className={cn('mt-1 truncate text-xs', active ? 'text-black/65' : 'text-w-muted')}>{item.preview}</div>}
                    <div className={cn('mt-1 flex items-center gap-1.5 text-[11px]', active ? 'text-black/55' : 'text-w-muted2')}>
                      <span>{itemChannel === 'all' ? 'Telegram + внутренний' : itemChannel === 'telegram' ? 'Telegram' : 'Внутренний'}</span>
                      <span>·</span>
                      <span>{formatDate(item.updatedAt)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </WorkspaceCard>

        <WorkspaceCard className="p-5">
          {!selected || !user ? (
            // Когда диалогов нет, пустое состояние показывается только в списке
            // слева — здесь не дублируем тот же текст.
            items.length === 0 ? null : (
              <WorkspaceEmptyState title="Выберите диалог" text="Сообщения откроются справа." />
            )
          ) : channel === 'all' ? (
            <UnifiedThread
              studentId={selected.studentId!}
              title={selected.title}
              internal={selected.internal}
              telegram={selected.telegram}
              scopeParams={params}
              highlightedMessageId={requestedMessageId}
              readOnly={isPreview}
              onOpenChannel={setChannel}
            />
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
        </WorkspaceCard>
      </div>
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
            <WorkspaceButton size="sm" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
              <Sparkles className="h-3.5 w-3.5" />{draftMutation.isPending ? 'AI анализирует...' : 'Общий AI-разбор'}
            </WorkspaceButton>
          )}
          {telegram && <WorkspaceButton size="sm" variant="ghost" onClick={() => onOpenChannel('telegram')}>Telegram-инструменты</WorkspaceButton>}
          {internal && <WorkspaceButton size="sm" variant="ghost" onClick={() => onOpenChannel('internal')}>Внутренний чат</WorkspaceButton>}
        </div>
      </div>

      {draft && (
        <div className="mb-4 rounded-[16px] border border-w-accentDim/40 bg-w-accent/10 p-4">
          <div className="mb-2 flex items-center gap-2 font-display text-sm font-black text-w-accentText"><Bot className="h-4 w-4" />Предпросмотр общей истории</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-w-ink">{draft.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <WorkspaceStatusPill>Профиль: {draft.profile_updates.length}</WorkspaceStatusPill>
            <WorkspaceStatusPill>Задачи: {draft.follow_ups.length}</WorkspaceStatusPill>
            <WorkspaceStatusPill>Документы: {draft.document_flags.length}</WorkspaceStatusPill>
          </div>
          <div className="mt-4 flex gap-2">
            <WorkspaceButton size="sm" onClick={() => applyDraftMutation.mutate()} disabled={applyDraftMutation.isPending}>Подтвердить и применить</WorkspaceButton>
            <WorkspaceButton size="sm" variant="ghost" onClick={() => setDraft(null)}>Отмена</WorkspaceButton>
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по Telegram и внутреннему чату"
          className="h-10 w-full rounded-[11px] border border-w-line bg-w-panel2 pl-9 pr-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
        />
      </div>

      <div className="h-[520px] space-y-2.5 overflow-y-auto rounded-[16px] border border-w-line bg-w-panel2 p-4">
        {hasNextPage && (
          <div className="text-center">
            <WorkspaceButton size="sm" variant="ghost" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Загрузка...' : 'Загрузить более ранние сообщения'}
            </WorkspaceButton>
          </div>
        )}
        {isLoading ? (
          <p className="text-center text-sm text-w-muted">Загрузка общей истории...</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-w-muted">Сообщений пока нет.</p>
        ) : messages.map((message) => (
          <div
            id={`workspace-message-${message.id}`}
            key={`${message.source}-${message.id}`}
            className={cn(
              'flex rounded-[14px] transition',
              message.is_current_user ? 'justify-end' : 'justify-start',
              highlightedMessageId === message.id && 'ring-2 ring-w-accent ring-offset-2 ring-offset-w-panel2',
            )}
          >
            <div className={cn(
              'max-w-[82%] rounded-[12px] border px-3 py-2 text-sm',
              message.is_current_user ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel text-w-ink',
            )}>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em]">
                <span className={message.is_current_user ? 'text-black/60' : 'text-w-accentText'}>{message.sender_name || 'Участник'}</span>
                <span className={cn('rounded-full px-1.5 py-0.5', message.is_current_user ? 'bg-black/10 text-black/60' : 'bg-w-panel2 text-w-muted')}>
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
                  className="mt-2 flex w-full items-center gap-2 rounded-[10px] border border-w-line bg-w-panel2 px-3 py-2 text-left text-xs font-bold text-w-muted disabled:opacity-50"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                  <Download className="h-3.5 w-3.5" />
                </button>
              ))}
              <div className={cn('mt-1 text-[10px] tabular-nums', message.is_current_user ? 'text-black/55' : 'text-w-muted2')}>
                {formatDate(message.created_at)}
              </div>
            </div>
          </div>
        ))}
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
          <WorkspaceButton
            size="sm"
            variant="ghost"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Прикрепить файл"
          >
            <Paperclip className="h-4 w-4" />
          </WorkspaceButton>
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
            className="h-10 flex-1 rounded-[11px] border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <WorkspaceButton
            size="sm"
            disabled={!messageText.trim() || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
            aria-label="Отправить во внутренний чат"
          >
            <Send className="h-4 w-4" />
          </WorkspaceButton>
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
      <WorkspaceStatusPill>{channel}</WorkspaceStatusPill>
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
          <WorkspaceButton size="sm" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
            <Sparkles className="h-3.5 w-3.5" />
            {draftMutation.isPending ? 'AI анализирует...' : 'AI-разбор'}
          </WorkspaceButton>
        )}
      </div>

      {draft && (
        <div className="mb-4 rounded-[16px] border border-w-accentDim/40 bg-w-accent/10 p-4">
          <div className="mb-2 flex items-center gap-2 font-display text-sm font-black text-w-accentText">
            <Bot className="h-4 w-4" /> Предпросмотр AI-разбора
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-w-ink">{draft.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-w-muted">
            <WorkspaceStatusPill>Изменения профиля: {draft.profile_updates.length}</WorkspaceStatusPill>
            <WorkspaceStatusPill>Задачи: {draft.follow_ups.length}</WorkspaceStatusPill>
            <WorkspaceStatusPill>Документы: {draft.document_flags.length}</WorkspaceStatusPill>
          </div>
          <div className="mt-4 flex gap-2">
            <WorkspaceButton size="sm" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              Подтвердить и применить
            </WorkspaceButton>
            <WorkspaceButton size="sm" variant="ghost" onClick={() => setDraft(null)}>Отмена</WorkspaceButton>
          </div>
        </div>
      )}

      {participants.length > 0 && (
        <div className="mb-4 rounded-[16px] border border-w-line bg-w-panel2 p-4">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-w-muted">Какой Telegram-аккаунт ваш?</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {participants.map((participant) => (
              <button
                key={participant.telegram_user_id}
                type="button"
                disabled={participant.is_current_user || identifyMutation.isPending}
                onClick={() => identifyMutation.mutate(participant.telegram_user_id)}
                className={cn(
                  'rounded-[10px] border px-3 py-2 text-xs font-bold transition',
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
        <div className="mb-4 overflow-hidden rounded-[16px] border border-w-line bg-w-panel2">
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
                  <div key={session.id} className="rounded-[11px] border border-w-line bg-w-panel px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-w-ink">{session.student_name || 'Студент не указан'}</span>
                      <WorkspaceStatusPill tone={session.status === 'active' ? 'good' : 'neutral'}>
                        {session.status === 'active' ? 'Активна' : 'Закрыта'}
                      </WorkspaceStatusPill>
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

      <div className="h-[560px] space-y-2.5 overflow-y-auto rounded-[16px] border border-w-line bg-w-panel2 p-4">
        {isLoading ? (
          <p className="text-center text-sm text-w-muted">Загрузка сообщений...</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-w-muted">Сообщений пока нет.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn('flex', message.is_current_user ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[82%] rounded-[12px] border px-3 py-2 text-sm',
                message.is_current_user ? 'border-w-accent bg-w-accent text-black' : 'border-w-line bg-w-panel text-w-ink',
              )}>
                <div className={cn('mb-1 text-[11px] font-bold', message.is_current_user ? 'text-black/60' : 'text-w-accentText')}>
                  {message.sender_display_name || message.sender_name || 'Telegram'}
                </div>
                {message.raw_text && <div className="whitespace-pre-wrap break-words">{message.raw_text}</div>}
                {message.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    disabled={!attachment.can_download}
                    onClick={() => download(attachment.id, attachment.file_name || 'telegram-file')}
                    className="mt-2 flex w-full items-center gap-2 rounded-[10px] border border-w-line bg-w-panel2 px-3 py-2 text-left text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText disabled:opacity-50"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                    <Download className="h-3.5 w-3.5" />
                  </button>
                ))}
                <div className={cn('mt-1 text-[10px] tabular-nums', message.is_current_user ? 'text-black/55' : 'text-w-muted2')}>{formatDate(message.created_at)}</div>
              </div>
            </div>
          ))
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
            className="h-10 flex-1 rounded-[11px] border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <WorkspaceButton size="sm" disabled={!outgoingText.trim() || sendMutation.isPending} onClick={() => sendMutation.mutate()}>
            <Send className="h-4 w-4" />
          </WorkspaceButton>
        </div>
      )}
    </>
  )
}
