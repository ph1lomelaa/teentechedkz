import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FolderInput, Paperclip, Sparkles, X } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { pendingInsightsApi } from '@/api'
import { documentsApi } from '@/api/documents'
import {
  DocType,
  DOC_TYPE_LABELS,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
} from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { InsightCard } from '@/components/shared/InsightCard'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
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

  const [reassignOpen, setReassignOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [saveAsDocTarget, setSaveAsDocTarget] = useState<string | null>(null)
  const [saveAsDocType, setSaveAsDocType] = useState<DocType | ''>('')
  const [contextDraftOpen, setContextDraftOpen] = useState(false)
  const [contextDraft, setContextDraft] = useState<TelegramContextDraft | null>(null)

  const { data: chat } = useQuery({
    queryKey: ['telegram-chat', chatId],
    queryFn: () => telegramApi.getById(chatId!),
    enabled: !!chatId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'messages'],
    queryFn: () => telegramApi.listMessages(chatId!),
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
    mutationFn: () => telegramApi.createContextDraft(chatId!, 40),
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
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">{title}</p>
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
          <p className="text-xs text-gray-400">Нет пунктов</p>
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
    return <p className="text-sm text-gray-500">Загрузка…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/telegram-inbox')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-xl font-semibold text-gray-900">{chat.title || `Чат ${chat.chat_id}`}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded-[2px] text-xs ${TELEGRAM_STATUS_COLORS[chat.status]}`}>
              {TELEGRAM_STATUS_LABELS[chat.status]}
            </span>
            {chat.student_name && chat.student_id ? (
              <Link to={`/students/${chat.student_id}`} className="text-sm text-blue-600 hover:underline">
                {chat.student_name}
              </Link>
            ) : (
              <span className="text-sm text-gray-400">не привязан</span>
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
                Создать заметки{chat.has_context_signal ? ` (${chat.context_signal_count})` : ''}
              </Button>
            )}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-gray-200 rounded-[2px]">
          <div className="px-4 py-2 border-b border-gray-200 font-medium text-sm text-gray-700">
            Переписка ({messages.length})
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && <p className="text-sm text-gray-500">Сообщений пока нет</p>}
            {messages.map((m) => (
              <div key={m.id} className="text-sm border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span className="font-medium text-gray-700">{m.sender_name || 'Без имени'}</span>
                  <span>{formatDate(m.created_at)}</span>
                </div>
                {m.raw_text && <p className="text-gray-800 whitespace-pre-wrap">{m.raw_text}</p>}
                {m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.attachments.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!a.can_download}
                          onClick={() => void handleDownloadAttachment(a)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-xs border ${
                            a.can_download
                              ? 'border-gray-200 text-gray-700 hover:bg-gray-50'
                              : 'border-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          <Paperclip className="w-3 h-3" />
                          {a.file_name || 'файл'}
                        </button>
                        {chat.student_id && (a.status === 'downloaded' || a.status === 'parsed') && (
                          <button
                            title="В документы"
                            onClick={() => setSaveAsDocTarget(a.id)}
                            className="inline-flex items-center px-1.5 py-1 rounded-[2px] text-xs border border-gray-200 text-gray-500 hover:bg-gray-50"
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

        <div className="border border-gray-200 rounded-[2px]">
          <div className="px-4 py-2 border-b border-gray-200">
            <div className="font-medium text-sm text-gray-700">Авто-изменения полей ({insights.length})</div>
            <p className="mt-0.5 text-xs text-gray-400">
              Здесь только структурные изменения карточки. Для заметок, документов и follow-up используйте «Создать заметки».
            </p>
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {chat.has_context_signal && (
              <div className="rounded-[2px] border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                В последних сообщениях есть потенциально важный контекст: экзамены, документы, даты или вложения.
              </div>
            )}
            {insights.length === 0 && <p className="text-sm text-gray-500">Авто-изменений полей пока нет</p>}
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
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Кратко</p>
                <Textarea
                  value={contextDraft.summary}
                  className="min-h-[84px]"
                  onChange={(event) => setContextDraft({ ...contextDraft, summary: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Изменения полей</p>
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
                  <p className="text-xs text-gray-400">Подтверждённых изменений полей нет</p>
                ) : (
                  <div className="space-y-2">
                    {contextDraft.profile_updates.map((item, index) => (
                      <div key={index} className="grid gap-2 rounded-[2px] border border-gray-200 p-3 md:grid-cols-[1fr_1fr_auto]">
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
              <p className="text-xs text-gray-400">
                Вложения пока не распознаются автоматически: AI видит факт файла, но не читает содержимое сертификата.
              </p>
              {renderDraftTextList('Противоречия / неясности', 'contradictions')}
              {renderDraftTextList('Предупреждения качества', 'quality_warnings')}

              {contextDraft.ignored_as_noise.length > 0 && (
                <div className="rounded-[2px] border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Не сохранять</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-600">
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
