import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Paperclip, Send, Search, X } from 'lucide-react'
import { chatApi, ChatMessage } from '@/api/chat'
import { useWsEvent } from '@/lib/ws'
import { cn } from '@/lib/utils'
import { parseSimpleMarkdown, renderMarkdown } from '@/lib/markdown-simple'
import { toast } from '@/hooks/use-toast'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export const ChatThread: React.FC<{
  conversationId: string
  currentUserId: string
  heightClass?: string
  variant?: 'crm' | 'portal'
  showSearch?: boolean
  readOnly?: boolean
}> = ({
  conversationId,
  currentUserId,
  heightClass = 'h-[420px]',
  variant = 'crm',
  showSearch = true,
  readOnly = false,
}) => {
  const { data } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => chatApi.messages(conversationId),
  })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [reactionHover, setReactionHover] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return messages
    const q = search.toLowerCase()
    return messages.filter((m) => m.body?.toLowerCase().includes(q))
  }, [messages, search])

  useEffect(() => {
    if (data) setMessages(data)
  }, [data])

  useEffect(() => {
    chatApi.read(conversationId).catch(() => {})
  }, [conversationId])

  const append = (m: ChatMessage) =>
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

  useWsEvent('message.new', (payload) => {
    const p = payload as { conversation_id: string; message: ChatMessage }
    if (p.conversation_id === conversationId) {
      append(p.message)
      chatApi.read(conversationId).catch(() => {})
    }
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const body = text.trim()
    if (!body || sending || readOnly) return
    setSending(true)
    try {
      const msg = await chatApi.send(conversationId, body)
      append(msg)
      setText('')
    } finally {
      setSending(false)
    }
  }

  const upload = async (file?: File) => {
    if (!file || uploading || readOnly) return
    setUploading(true)
    try {
      append(await chatApi.uploadAttachment(conversationId, file))
    } catch {
      toast({ title: 'Не удалось отправить файл', description: 'Доступны PDF, JPG, PNG и WEBP до 25 МБ.', variant: 'destructive' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const download = async (attachmentId: string, fileName: string) => {
    try {
      const blob = await chatApi.downloadAttachment(attachmentId)
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

  const portal = variant === 'portal'

  return (
    <div className={cn(
      'flex flex-col border overflow-hidden',
      portal ? 'border-w-line rounded-panel bg-w-panel' : 'border-gray-200 rounded-panel bg-white'
    )}>
      {/* Search bar */}
      {variant === 'portal' && showSearch && (
        <div className="border-b border-w-line bg-w-panel2 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по сообщениям…"
              className="h-9 w-full rounded-ctl border border-w-line bg-w-panel pl-9 pr-9 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-brand transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-w-muted2 hover:text-w-text"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {search && (
            <div className="mt-2 text-xs text-w-muted">
              Найдено: {filtered.length} из {messages.length}
            </div>
          )}
        </div>
      )}

      <div className={cn('overflow-y-auto p-4 space-y-2.5', portal ? 'bg-w-panel2' : 'bg-[#FBFAF7]', heightClass)}>
        {filtered.length === 0 ? (
          <p className={cn('text-sm text-center mt-8', portal ? 'text-w-muted' : 'text-gray-400')}>
            {search ? 'Сообщения не найдены' : 'Пока нет сообщений — напишите первым.'}
          </p>
        ) : (
          filtered.map((m) => {
            const mine = m.sender_id === currentUserId
            const isHovering = reactionHover === m.id
            return (
              <div key={m.id} className={cn('flex group', mine ? 'justify-end' : 'justify-start')}>
                <div
                  onMouseEnter={() => setReactionHover(m.id)}
                  onMouseLeave={() => setReactionHover(null)}
                  className={cn(
                    'relative max-w-[75%] rounded-ctl px-3 py-2 text-sm',
                    mine
                      ? portal ? 'bg-w-accent text-black' : 'bg-brand text-black'
                      : portal
                        ? 'bg-w-panel border border-w-line text-w-ink'
                        : 'bg-white border border-gray-200 text-gray-900'
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {renderMarkdown(parseSimpleMarkdown(m.body), mine, portal)}
                  </div>
                  {(m.attachments ?? []).map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => download(attachment.id, attachment.file_name)}
                      className={cn(
                        'mt-2 flex w-full items-center gap-2 rounded-ctl border px-2.5 py-2 text-left text-xs font-bold',
                        mine ? 'border-black/15 bg-black/5 text-black' : portal ? 'border-w-line bg-w-panel2 text-w-muted' : 'border-gray-200 bg-gray-50 text-gray-700',
                      )}
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{attachment.file_name}</span>
                      <Download className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ))}
                  <div className={cn('text-[10px] mt-1 tabular-nums', mine ? 'text-black/80' : portal ? 'text-w-muted2' : 'text-gray-400')}>
                    {fmtTime(m.created_at)}
                  </div>

                  {/* Reaction button on hover */}
                  {isHovering && !readOnly && portal && (
                    <div className="absolute -top-10 right-0 bg-w-panel border border-w-line rounded-ctl p-1.5 shadow-lg flex gap-1 z-10">
                      {['👍', '❤️', '😂', '🎉'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          title={`React with ${emoji}`}
                          onClick={() => toast({ title: 'Reactions coming soon!', description: 'This feature will be available in the next update.' })}
                          className="text-xl hover:scale-125 transition-transform cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
      <div className={cn('flex items-center gap-2 border-t p-2.5', portal ? 'border-w-line bg-w-panel' : 'border-gray-200 bg-white')}>
        {readOnly && (
          <div className={cn('flex-1 rounded-ctl border px-3 py-2 text-sm', portal ? 'border-w-line bg-w-panel2 text-w-muted' : 'border-gray-200 bg-gray-50 text-gray-500')}>
            Preview mode: можно читать, но нельзя писать от имени другого ментора.
          </div>
        )}
        {!readOnly && (
          <>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => upload(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-ctl border disabled:opacity-50',
            portal ? 'border-w-line bg-w-panel2 text-w-muted hover:border-w-accentDim hover:text-w-accentText' : 'border-gray-300 text-gray-600',
          )}
          aria-label="Прикрепить файл"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Сообщение…"
          className={cn(
            'flex-1 h-10 px-3 text-sm border focus:outline-none',
            portal
              ? 'rounded-ctl border-w-line bg-w-panel2 text-w-ink placeholder:text-w-muted2 focus:border-w-accentDim'
              : 'rounded-ctl border-gray-300 focus:border-gray-700'
          )}
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className={cn(
            'h-10 w-10 grid place-items-center rounded-ctl text-black disabled:opacity-50 shrink-0',
            portal ? 'bg-w-accent hover:brightness-95' : 'bg-brand hover:bg-brand-dark'
          )}
          aria-label="Отправить"
        >
          <Send className="w-4 h-4" />
        </button>
          </>
        )}
      </div>
    </div>
  )
}
