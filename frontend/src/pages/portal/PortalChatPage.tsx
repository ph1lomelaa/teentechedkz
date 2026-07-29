import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { MessageCircle, Paperclip, Send, AlertCircle, Search } from 'lucide-react'
import { chatApi } from '@/api/chat'
import { portalApi } from '@/api/portal'
import { useAuth } from '@/contexts/AuthContext'
import { useWsEvent } from '@/lib/ws'
import { ChatThread } from '@/components/shared/ChatThread'
import { cn, formatDate } from '@/lib/utils'
import { PageHeader, AppCard, EmptyState, SegmentedTabs } from '@/components/ui'

type Channel = 'internal' | 'telegram'

function dayLabel(iso: string): string {
  try {
    const date = new Date(iso)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
    if (sameDay(date, today)) return 'Сегодня'
    if (sameDay(date, yesterday)) return 'Вчера'
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export const PortalChatPage: React.FC = () => {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<Channel>('internal')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [dialogSearch, setDialogSearch] = useState('')
  const [telegramSearch, setTelegramSearch] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['portal', 'conversations'],
    queryFn: () => chatApi.conversations(),
  })
  const { data: contacts = [] } = useQuery({
    queryKey: ['portal', 'contacts'],
    queryFn: chatApi.contacts,
  })
  const { data: telegram, isLoading: telegramLoading } = useQuery({
    queryKey: ['portal', 'telegram'],
    queryFn: portalApi.telegram,
  })

  useWsEvent('message.new', () => queryClient.invalidateQueries({ queryKey: ['portal', 'conversations'] }))

  const sendMessageMutation = useMutation({
    mutationFn: (text: string) => portalApi.telegramSend(text),
    onSuccess: () => {
      setMessageText('')
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['portal', 'telegram'] })
      }, 500)
    },
  })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [telegram?.messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!messageText.trim()) return
    await sendMessageMutation.mutateAsync(messageText.trim())
  }

  const activeConversation = conversations.find((item) => item.id === selectedId) || conversations[0] || null
  const visibleConversations = useMemo(() => {
    const q = dialogSearch.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((conversation) => {
      const title = (conversation.other?.name || conversation.title || '').toLowerCase()
      const body = (conversation.last_message?.body || '').toLowerCase()
      return title.includes(q) || body.includes(q)
    })
  }, [conversations, dialogSearch])
  const filteredTelegramMessages = useMemo(() => {
    const q = telegramSearch.trim().toLowerCase()
    const messages = telegram?.messages ?? []
    if (!q) return messages
    return messages.filter((m) => (m.raw_text || '').toLowerCase().includes(q))
  }, [telegram?.messages, telegramSearch])
  const newContacts = useMemo(() => {
    const existing = new Set(conversations.map((item) => item.other?.id).filter(Boolean))
    return contacts.filter((contact) => !existing.has(contact.id))
  }, [contacts, conversations])

  const startWith = async (userId: string) => {
    const conversation = await chatApi.start(userId)
    setSelectedId(conversation.id)
    queryClient.invalidateQueries({ queryKey: ['portal', 'conversations'] })
  }

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader
        eyebrow="Кабинет ученика"
        title="Чат"
        description="Telegram-группа с ментором и внутренний диалог с командой в одном разделе."
        colorPrefix="p"
      />

      <div className="mb-5">
        <SegmentedTabs
          value={channel}
          onChange={(value) => setChannel(value as Channel)}
          colorPrefix="p"
          tabs={[
            { value: 'telegram', label: 'Telegram-группа' },
            { value: 'internal', label: 'Внутренний чат' },
          ]}
        />
      </div>

      {channel === 'telegram' ? (
        <AppCard colorPrefix="p" className="p-5">
          {telegramLoading ? (
            <p className="text-sm text-p-muted">Загрузка сообщений…</p>
          ) : !telegram?.chat ? (
            <EmptyState
              icon={<Send className="h-5 w-5" />}
              title="Telegram-группа ещё не подключена"
              description="Как только ментор подключит вашу Telegram-группу, переписка появится здесь."
              colorPrefix="p"
            />
          ) : (
            <>
              <div className="mb-4 border-b border-p-line pb-4">
                <div className="text-base font-black text-p-text">{telegram.chat.title || 'Telegram-группа'}</div>
                <div className="mt-1 text-xs text-p-muted">
                  Отправляй сообщения прямо из кабинета
                </div>
              </div>
              <div className="mb-3 relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
                <input
                  value={telegramSearch}
                  onChange={(e) => setTelegramSearch(e.target.value)}
                  placeholder="Поиск по сообщениям…"
                  className="h-9 w-full rounded-ctl border border-p-line bg-p-panel2 pl-9 pr-3 text-sm text-p-text placeholder:text-p-muted2 outline-none"
                />
              </div>
              <div className="mb-4 flex flex-col gap-3">
                <div className="h-[min(480px,60dvh)] space-y-2.5 overflow-y-auto rounded-panel border border-p-line bg-p-panel2 p-3 sm:p-4 lg:h-[480px]">
                  {telegram.messages.length === 0 ? (
                    <p className="mt-8 text-center text-sm text-p-muted">Сообщений пока нет.</p>
                  ) : filteredTelegramMessages.length === 0 ? (
                    <p className="mt-8 text-center text-sm text-p-muted">Ничего не найдено.</p>
                  ) : (
                    <>
                      {filteredTelegramMessages.map((message, index) => {
                        const prev = filteredTelegramMessages[index - 1]
                        const showDaySeparator = !prev || dayLabel(prev.created_at) !== dayLabel(message.created_at)
                        return (
                          <React.Fragment key={message.id}>
                            {showDaySeparator && (
                              <div className="flex items-center justify-center py-1">
                                <span className="rounded-pill border border-p-line bg-p-panel px-3 py-1 text-[11px] font-bold text-p-muted">
                                  {dayLabel(message.created_at)}
                                </span>
                              </div>
                            )}
                            <div className={cn('flex', message.is_me ? 'justify-end' : 'justify-start')}>
                              <div
                                className={cn(
                                  'max-w-[82%] rounded-ctl border px-3 py-2 text-sm',
                                  message.is_me ? 'border-p-accent bg-p-accent text-black' : 'border-p-line bg-p-panel text-p-text',
                                )}
                              >
                                <div className={cn('mb-1 text-[11px] font-bold', message.is_me ? 'text-black/80' : 'text-p-accent')}>
                                  {message.sender_name || 'Участник'}
                                </div>
                                {message.raw_text && <div className="whitespace-pre-wrap break-words">{message.raw_text}</div>}
                                {message.attachments.map((attachment) => (
                                  <div
                                    key={attachment.id}
                                    className="mt-2 flex items-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-xs font-bold text-p-muted"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    <span className="min-w-0 flex-1 truncate">{attachment.file_name || message.message_type}</span>
                                  </div>
                                ))}
                                <div className={cn('mt-1 text-[10px] tabular-nums', message.is_me ? 'text-black/80' : 'text-p-muted2')}>
                                  {formatDate(message.created_at)}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {sendMessageMutation.isError && (
                  <div className="flex items-center gap-2 rounded-ctl border border-p-danger/30 bg-p-danger/10 px-3 py-2 text-xs text-p-danger">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {sendMessageMutation.error instanceof Error ? sendMessageMutation.error.message : 'Ошибка отправки'}
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Напиши сообщение..."
                    disabled={sendMessageMutation.isPending}
                    className="flex-1 rounded-ctl border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text placeholder-p-muted outline-none transition disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!messageText.trim() || sendMessageMutation.isPending}
                    className="rounded-ctl border border-p-accent bg-p-accent px-3 py-2.5 text-black transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </>
          )}
        </AppCard>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <AppCard colorPrefix="p" className="max-h-[320px] overflow-y-auto p-3 lg:max-h-none">
            <div className="mb-2 px-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
                <input
                  value={dialogSearch}
                  onChange={(e) => setDialogSearch(e.target.value)}
                  placeholder="Поиск диалогов"
                  className="h-9 w-full rounded-ctl border border-p-line bg-p-panel2 pl-9 pr-3 text-sm text-p-text placeholder:text-p-muted2 outline-none"
                />
              </div>
            </div>
            {isLoading ? (
              <p className="p-3 text-sm text-p-muted">Загрузка диалогов...</p>
            ) : visibleConversations.length === 0 && newContacts.length === 0 ? (
              <EmptyState
                icon={<MessageCircle className="h-5 w-5" />}
                title="Диалогов пока нет"
                description="Когда ментор будет назначен, здесь появится внутренний чат."
                colorPrefix="p"
              />
            ) : (
              <div className="space-y-1.5">
                {visibleConversations.map((conversation) => {
                  const active = activeConversation?.id === conversation.id
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className={cn(
                        'w-full rounded-panel border px-3 py-3 text-left transition relative overflow-hidden',
                        active
                          ? 'border-p-accent bg-p-accent text-black'
                          : 'border-p-line bg-p-panel2 text-p-text hover:border-p-accent-dim',
                      )}
                    >
                      {active && <span className="absolute inset-y-0 left-0 w-1 bg-p-accent" />}
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1 truncate text-sm font-black">
                          {conversation.other?.name || conversation.title || 'Команда TeenTechEd'}
                        </div>
                        {conversation.unread > 0 && (
                          <span className={cn('rounded-pill px-2 py-0.5 text-[10px] font-black', active ? 'bg-black text-p-accent' : 'bg-p-accent text-black')}>
                            {conversation.unread}
                          </span>
                        )}
                      </div>
                      <div className={cn('mt-1 truncate text-xs', active ? 'text-black' : 'text-p-muted')}>
                        {conversation.last_message?.body || 'Нет сообщений'}
                      </div>
                      <div className={cn('mt-1 text-[11px]', active ? 'text-black/85' : 'text-p-muted2')}>
                        {formatDate(conversation.updated_at)}
                      </div>
                    </button>
                  )
                })}

                {newContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => startWith(contact.id)}
                    className="w-full rounded-panel border border-dashed border-p-line bg-p-panel px-3 py-3 text-left text-p-muted transition hover:border-p-accent-dim hover:text-p-text"
                  >
                    <div className="flex items-center gap-2 text-sm font-black">
                      <MessageCircle className="h-4 w-4" />
                      Написать: {contact.name}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </AppCard>

          <AppCard colorPrefix="p" className="p-3 sm:p-5">
            {activeConversation && user ? (
              <>
                <div className="mb-4 border-b border-p-line pb-4">
                  <div className="text-base font-black text-p-text">
                    {activeConversation.other?.name || activeConversation.title || 'Команда TeenTechEd'}
                  </div>
                  <div className="mt-1 text-xs text-p-muted">Внутренний чат</div>
                </div>
                <ChatThread
                  conversationId={activeConversation.id}
                  currentUserId={user.id}
                  heightClass="h-[min(520px,60dvh)] lg:h-[520px]"
                  variant="portal"
                  readOnly={activeConversation.can_write === false}
                />
              </>
            ) : (
              <EmptyState
                icon={<MessageCircle className="h-5 w-5" />}
                title="Выберите диалог"
                description="Сообщения откроются справа."
                colorPrefix="p"
              />
            )}
          </AppCard>
        </div>
      )}
    </div>
  )
}
