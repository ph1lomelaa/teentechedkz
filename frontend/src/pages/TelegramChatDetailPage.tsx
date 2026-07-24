import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FolderInput, History, Paperclip, Search, Sparkles, Upload, X } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { pendingInsightsApi } from '@/api'
import { documentsApi } from '@/api/documents'
import {
  DocType,
  DOC_TYPE_LABELS,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Badge } from '@/components/ui/primitives/badge'
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
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { InsightCard } from '@/components/shared/InsightCard'
import { StudentChatSection } from '@/components/shared/StudentChatSection'
import { Accordion } from '@/components/ui/primitives/accordion'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/primitives/toast'
import { downloadBlob } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errorMessage'
import type { TelegramAttachment, TelegramContextDraft } from '@/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function compactContextDraft(draft: TelegramContextDraft): TelegramContextDraft {
  const cleanList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)
  return {
    ...draft,
    summary: draft.summary.trim(),
    profile_updates: draft.profile_updates.filter((item) => item.field.trim() && String(item.value ?? '').trim()),
    profile_notes: cleanList(draft.profile_notes),
    follow_ups: cleanList(draft.follow_ups),
    document_flags: cleanList(draft.document_flags),
    contradictions: cleanList(draft.contradictions),
    quality_warnings: cleanList(draft.quality_warnings),
    ignored_as_noise: cleanList(draft.ignored_as_noise),
  }
}

function replaceDraftList(
  draft: TelegramContextDraft,
  key: keyof Pick<TelegramContextDraft, 'profile_notes' | 'follow_ups' | 'document_flags' | 'contradictions' | 'quality_warnings'>,
  index: number,
  value: string,
): TelegramContextDraft {
  return {
    ...draft,
    [key]: draft[key].map((item, i) => (i === index ? value : item)),
  }
}

export default function TelegramChatDetailPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = true
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const [reassignOpen, setReassignOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [saveAsDocTarget, setSaveAsDocTarget] = useState<string | null>(null)
  const [saveAsDocType, setSaveAsDocType] = useState<DocType | ''>('')
  const [contextDraftOpen, setContextDraftOpen] = useState(false)
  const [contextDraft, setContextDraft] = useState<TelegramContextDraft | null>(null)
  const [messageSearch, setMessageSearch] = useState('')

  const { data: chat } = useQuery({
    queryKey: ['telegram-chat', chatId],
    queryFn: () => telegramApi.getById(chatId!),
    enabled: !!chatId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'messages', messageSearch],
    queryFn: () => telegramApi.listMessages(chatId!, {
      q: messageSearch.trim() || undefined,
      limit: messageSearch.trim() ? 500 : 200,
    }),
    enabled: !!chatId,
  })

  const { data: sessions = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'sessions'],
    queryFn: () => telegramApi.listSessions(chatId!),
    enabled: !!chatId,
  })

  const { data: importCapabilities } = useQuery({
    queryKey: ['telegram-chat', chatId, 'import-capabilities'],
    queryFn: () => telegramApi.importCapabilities(chatId!),
    enabled: !!chatId,
  })

  const { data: insights = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'insights'],
    queryFn: () => telegramApi.listInsights(chatId!),
    enabled: !!chatId,
  })

  const invalidateChat = () => {
    qc.invalidateQueries({ queryKey: ['telegram-chat', chatId] })
    qc.invalidateQueries({ queryKey: ['telegram-chats'] })
  }

  const reassignMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.reassign(chatId!, studentId),
    onSuccess: () => {
      invalidateChat()
      setReassignOpen(false)
      toast({ title: 'Студент изменён' })
    },
    onError: (err) => toast({ title: 'Не удалось сменить студента', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const pauseMutation = useMutation({
    mutationFn: () => telegramApi.pause(chatId!),
    onSuccess: (updated) => {
      invalidateChat()
      toast({
        title: 'AI-разбор поставлен на паузу',
        description: updated.title || `Чат ${updated.chat_id}`,
        action: (
          <ToastAction altText="Возобновить" onClick={() => resumeMutation.mutate()}>
            Отменить
          </ToastAction>
        ),
      })
    },
    onError: (err) => toast({ title: 'Не удалось поставить на паузу', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const resumeMutation = useMutation({
    mutationFn: () => telegramApi.resume(chatId!),
    onSuccess: (updated) => {
      invalidateChat()
      toast({
        title: 'AI-разбор возобновлён',
        description: updated.title || `Чат ${updated.chat_id}`,
        action: (
          <ToastAction altText="Поставить на паузу" onClick={() => pauseMutation.mutate()}>
            Отменить
          </ToastAction>
        ),
      })
    },
    onError: (err) => toast({ title: 'Не удалось возобновить чат', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const closeMutation = useMutation({
    mutationFn: () => telegramApi.close(chatId!),
    onSuccess: () => {
      invalidateChat()
      setCloseConfirmOpen(false)
      toast({ title: 'Сессия завершена' })
    },
    onError: (err) => toast({ title: 'Не удалось завершить сессию', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      pendingInsightsApi.review(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegram-chat', chatId, 'insights'] })
      qc.invalidateQueries({ queryKey: ['telegram-chats'] })
      qc.invalidateQueries({ queryKey: ['student-notes'] })
      toast({ title: 'Инсайт обработан' })
    },
    onError: (err) => toast({ title: 'Не удалось обработать инсайт', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const saveAsDocMutation = useMutation({
    mutationFn: () => documentsApi.saveFromTelegram(saveAsDocTarget!, saveAsDocType as DocType),
    onSuccess: () => {
      setSaveAsDocTarget(null)
      setSaveAsDocType('')
      if (chat?.student_id) {
        qc.invalidateQueries({ queryKey: ['student', chat.student_id] })
      }
      toast({ title: 'Файл добавлен в документы студента' })
    },
    onError: (err) => toast({ title: 'Не удалось сохранить файл', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const contextDraftMutation = useMutation({
    mutationFn: () => telegramApi.createContextDraft(chatId!, {
      limit: messageSearch.trim() ? 120 : 40,
      q: messageSearch.trim() || undefined,
    }),
    onSuccess: (draft) => {
      setContextDraft(draft)
      setContextDraftOpen(true)
    },
    onError: (err) => toast({ title: 'Не удалось создать заметки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const applyContextDraftMutation = useMutation({
    mutationFn: () => telegramApi.applyContextDraft(chatId!, compactContextDraft(contextDraft!)),
    onSuccess: (result) => {
      setContextDraftOpen(false)
      setContextDraft(null)
      qc.invalidateQueries({ queryKey: ['student-notes'] })
      qc.invalidateQueries({ queryKey: ['telegram-chat', chatId, 'insights'] })
      toast({
        title: 'Заметки сохранены',
        description: `Сохранено заметок: ${result.profile_notes_saved}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось сохранить заметки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const importJsonMutation = useMutation({
    mutationFn: (file: File) => telegramApi.importJson(chatId!, file),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['telegram-chat', chatId, 'messages'] })
      qc.invalidateQueries({ queryKey: ['telegram-chat', chatId, 'sessions'] })
      qc.invalidateQueries({ queryKey: ['telegram-chats'] })
      toast({
        title: 'История импортирована',
        description: `Добавлено: ${result.imported}, пропущено: ${result.skipped}`,
      })
      if (importInputRef.current) importInputRef.current.value = ''
    },
    onError: (err) => toast({ title: 'Не удалось импортировать историю', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const handleDownloadAttachment = async (a: TelegramAttachment) => {
    try {
      const blob = await telegramApi.downloadAttachment(a.id)
      downloadBlob(blob, a.file_name || 'file')
    } catch (err) {
      toast({ title: 'Не удалось скачать файл', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const renderDraftTextList = (
    title: string,
    key: keyof Pick<TelegramContextDraft, 'profile_notes' | 'follow_ups' | 'document_flags' | 'contradictions' | 'quality_warnings'>,
  ) => {
    if (!contextDraft) return null
    const items = contextDraft[key]
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-p-muted">{title}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setContextDraft({ ...contextDraft, [key]: [...items, ''] })}
          >
            Добавить
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-p-muted2">Нет пунктов</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${key}-${index}`} className="flex items-start gap-2">
                <Textarea
                  value={item}
                  className="min-h-[64px] text-sm"
                  onChange={(event) => setContextDraft(replaceDraftList(contextDraft, key, index, event.target.value))}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={() => setContextDraft({ ...contextDraft, [key]: items.filter((_, i) => i !== index) })}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!chat) {
    return <p className="text-sm text-p-muted">Загрузка…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 border-b border-p-line pb-6">
        <Button variant="outline" size="sm" onClick={() => navigate('/telegram-inbox')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-[200px]">
          <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-yellow-500">Telegram</div>
          <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-p-text md:text-4xl">{chat.title || `Чат ${chat.chat_id}`}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded-pill text-xs ${TELEGRAM_STATUS_COLORS[chat.status]}`}>
              {TELEGRAM_STATUS_LABELS[chat.status]}
            </span>
            {chat.student_name && chat.student_id ? (
              <Link to={`/students/${chat.student_id}`} className="text-sm text-blue-600 hover:underline">
                {chat.student_name}
              </Link>
            ) : (
              <span className="text-sm text-p-muted2">не привязан</span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setReassignOpen(true)}>
              {chat.student_id ? 'Сменить привязку' : 'Привязать студента'}
            </Button>
            {chat.student_id && (
              <Button
                variant="outline"
                size="sm"
                disabled={contextDraftMutation.isPending || messages.length === 0}
                onClick={() => contextDraftMutation.mutate()}
              >
                <Sparkles className="w-4 h-4" />
                {messageSearch.trim() ? 'Заметки из поиска' : `Создать заметки${chat.has_context_signal ? ` (${chat.context_signal_count})` : ''}`}
              </Button>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) importJsonMutation.mutate(file)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={importJsonMutation.isPending}
              onClick={() => importInputRef.current?.click()}
              title="Импорт Telegram Desktop export result.json"
            >
              <Upload className="w-4 h-4" />
              Импорт истории{importCapabilities?.active_mode === 'desktop_json' ? ' JSON' : ''}
            </Button>
            {chat.status === 'active' && (
              <Button variant="outline" size="sm" disabled={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>
                Пауза AI
              </Button>
            )}
            {chat.status === 'paused' && (
              <Button variant="outline" size="sm" disabled={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>
                Возобновить AI
              </Button>
            )}
            {(chat.status === 'active' || chat.status === 'paused') && (
              <Button variant="outline" size="sm" onClick={() => setCloseConfirmOpen(true)}>
                Закрыть чат
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border border-p-line rounded-card">
        <div className="px-4 py-2 border-b border-p-line">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-medium text-sm text-p-text">
              Переписка ({messages.length}{messageSearch.trim() ? ' найдено' : ''})
            </div>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-p-muted2" />
              <Input
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Поиск по истории"
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-p-muted2">
            История хранится на уровне Telegram-чата: при смене студента сообщения не удаляются.
          </p>
        </div>
        <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <p className="text-sm text-p-muted">Сообщений пока нет</p>}
          {messages.map((m) => (
            <div key={m.id} className="text-sm border-b border-p-line pb-3 last:border-0">
              <div className="flex items-center justify-between text-xs text-p-muted mb-1">
                <span className="font-medium text-p-text">{m.sender_name || 'Без имени'}</span>
                <span>{formatDate(m.created_at)}</span>
              </div>
              {m.raw_text && <p className="text-p-text whitespace-pre-wrap">{m.raw_text}</p>}
              {m.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {m.attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!a.can_download}
                        onClick={() => void handleDownloadAttachment(a)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-ctl text-xs border ${
                          a.can_download
                            ? 'border-p-line text-p-text hover:bg-p-bg'
                            : 'border-p-line text-p-muted2 cursor-not-allowed'
                        }`}
                      >
                        <Paperclip className="w-3 h-3" />
                        {a.file_name || 'файл'}
                      </button>
                      {chat.student_id && (a.status === 'downloaded' || a.status === 'parsed') && (
                        <button
                          title="В документы"
                          onClick={() => setSaveAsDocTarget(a.id)}
                          className="inline-flex items-center px-1.5 py-1 rounded-ctl text-xs border border-p-line text-p-muted hover:bg-p-bg"
                        >
                          <FolderInput className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {chat.student_id && (
        <Accordion type="single" collapsible defaultValue="chat">
          <StudentChatSection studentId={chat.student_id} />
        </Accordion>
      )}

      <div className="border border-p-line rounded-card">
        <div className="px-4 py-2 border-b border-p-line">
          <div className="font-medium text-sm text-p-text">Авто-изменения полей ({insights.length})</div>
          <p className="mt-0.5 text-xs text-p-muted2">
            Здесь только структурные изменения карточки. Для заметок, документов и follow-up используйте «Создать заметки».
          </p>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
          {chat.has_context_signal && (
            <div className="rounded-panel border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              В последних сообщениях есть потенциально важный контекст: экзамены, документы, даты или вложения.
            </div>
          )}
          {insights.length === 0 && <p className="text-sm text-p-muted">Авто-изменений полей пока нет</p>}
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              isPending={reviewMutation.isPending}
              onApprove={() => reviewMutation.mutate({ id: insight.id, action: 'approve' })}
              onReject={() => reviewMutation.mutate({ id: insight.id, action: 'reject' })}
            />
          ))}
        </div>
      </div>

      <div className="border border-p-line rounded-card">
        <div className="px-4 py-2 border-b border-p-line">
          <div className="flex items-center gap-2 font-medium text-sm text-p-text">
            <History className="h-4 w-4 text-p-muted2" />
            История привязок
          </div>
          <p className="mt-0.5 text-xs text-p-muted2">
            При перепривязке старая сессия закрывается, новая открывается. Сообщения остаются в общей истории чата.
          </p>
        </div>
        <div className="p-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-p-muted">Истории привязок пока нет.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div key={session.id} className="flex flex-col gap-1 rounded-panel border border-p-line p-3 text-sm md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-p-text">{session.student_name || 'Без студента'}</div>
                    <div className="text-xs text-p-muted">
                      Открыл: {session.opened_by_name || '—'} · {formatDate(session.opened_at)}
                      {session.closed_at ? ` · закрыто ${formatDate(session.closed_at)}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="w-fit text-[10px] font-medium">
                    {session.status === 'active' ? 'Активна' : 'Закрыта'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={contextDraftOpen} onOpenChange={setContextDraftOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Заметки из Telegram</DialogTitle>
            <DialogDescription>
              Проверьте черновик перед сохранением. В профиль попадут только оставленные пункты.
            </DialogDescription>
          </DialogHeader>
          {contextDraft && (
            <div className="space-y-5">
              {contextDraft.source_filter?.q && (
                <div className="rounded-panel border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  AI-разбор создан только по сообщениям, найденным по запросу: “{contextDraft.source_filter.q}”.
                </div>
              )}
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-p-muted">Кратко</p>
                <Textarea
                  value={contextDraft.summary}
                  className="min-h-[84px]"
                  onChange={(event) => setContextDraft({ ...contextDraft, summary: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-p-muted">Изменения полей</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setContextDraft({
                      ...contextDraft,
                      profile_updates: [...contextDraft.profile_updates, { field: '', value: '', reason: '' }],
                    })}
                  >
                    Добавить
                  </Button>
                </div>
                {contextDraft.profile_updates.length === 0 ? (
                  <p className="text-xs text-p-muted2">Подтверждённых изменений полей нет</p>
                ) : (
                  <div className="space-y-2">
                    {contextDraft.profile_updates.map((item, index) => (
                      <div key={index} className="grid gap-2 rounded-panel border border-p-line p-3 md:grid-cols-[1fr_1fr_auto]">
                        <Input
                          value={item.field}
                          placeholder="field"
                          onChange={(event) => setContextDraft({
                            ...contextDraft,
                            profile_updates: contextDraft.profile_updates.map((next, i) =>
                              i === index ? { ...next, field: event.target.value } : next
                            ),
                          })}
                        />
                        <Input
                          value={String(item.value ?? '')}
                          placeholder="Новое значение"
                          onChange={(event) => setContextDraft({
                            ...contextDraft,
                            profile_updates: contextDraft.profile_updates.map((next, i) =>
                              i === index ? { ...next, value: event.target.value } : next
                            ),
                          })}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-10 w-10 p-0"
                          onClick={() => setContextDraft({
                            ...contextDraft,
                            profile_updates: contextDraft.profile_updates.filter((_, i) => i !== index),
                          })}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                        <Textarea
                          value={item.reason || ''}
                          placeholder="Почему это подтверждено"
                          className="min-h-[56px] md:col-span-3"
                          onChange={(event) => setContextDraft({
                            ...contextDraft,
                            profile_updates: contextDraft.profile_updates.map((next, i) =>
                              i === index ? { ...next, reason: event.target.value } : next
                            ),
                          })}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {renderDraftTextList('Заметки профиля', 'profile_notes')}
              {renderDraftTextList('Follow-up', 'follow_ups')}
              {renderDraftTextList('Документы', 'document_flags')}
              <p className="text-xs text-p-muted2">
                Вложения пока не распознаются автоматически: AI видит факт файла, но не читает содержимое сертификата.
              </p>
              {renderDraftTextList('Противоречия / неясности', 'contradictions')}
              {renderDraftTextList('Предупреждения качества', 'quality_warnings')}

              {contextDraft.ignored_as_noise.length > 0 && (
                <div className="rounded-panel border border-p-line bg-p-bg p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-p-muted">Не сохранять</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-p-muted">
                    {contextDraft.ignored_as_noise.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContextDraftOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!contextDraft || applyContextDraftMutation.isPending}
              onClick={() => applyContextDraftMutation.mutate()}
            >
              Сохранить выбранное
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StudentPickerDialog
        open={reassignOpen}
        title="Сменить привязку"
        description="Проверьте текущую и новую привязку перед сохранением."
        onClose={() => setReassignOpen(false)}
        onSelect={(studentId) => reassignMutation.mutate(studentId)}
        isPending={reassignMutation.isPending}
        excludeStudentId={chat.student_id}
        currentStudentLabel={chat.student_name}
        confirmBeforeSelect
      />

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Завершить сессию?</DialogTitle>
            <DialogDescription>
              Чат будет закрыт, привязка к студенту снята. История переписки останется доступна.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseConfirmOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!saveAsDocTarget} onOpenChange={(open) => !open && setSaveAsDocTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить в документы</DialogTitle>
          </DialogHeader>
          <Select value={saveAsDocType} onValueChange={(v) => setSaveAsDocType(v as DocType)}>
            <SelectTrigger>
              <SelectValue placeholder="Тип документа" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsDocTarget(null)}>
              Отмена
            </Button>
            <Button
              disabled={!saveAsDocType || saveAsDocMutation.isPending}
              onClick={() => saveAsDocMutation.mutate()}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
