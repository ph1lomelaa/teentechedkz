import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Trash2, PlayCircle, FileText, CheckCircle2, Mic, Sparkles, MessageSquareText } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { MeetingType, meetingsApi, Meeting, MeetingUpdateInput } from '@/api/meetings'
import { notesApi } from '@/api/notes'
import { tasksApi } from '@/api/index'
import { FollowUpReviewDialog } from '@/components/shared/FollowUpReviewDialog'
import type { MeetingFollowUpDraft } from '@/api/meetings'

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Запланирована',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  intro: 'Первичный',
  regular: 'Регулярный',
  documents: 'Документы',
  roadmap: 'Roadmap',
  application: 'Подача',
  finance: 'Финансы',
  other: 'Другое',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const StudentMeetingsSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { toast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const key = ['student-meetings', studentId]

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => meetingsApi.studentMeetings(studentId),
  })

  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState<MeetingType>('regular')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [link, setLink] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState<MeetingFollowUpDraft | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key })
    queryClient.invalidateQueries({ queryKey: ['workspace'] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      meetingsApi.create({
        student_id: studentId,
        title: title.trim(),
        meeting_type: meetingType,
        description: description.trim(),
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        meeting_link: link.trim(),
      }),
    onSuccess: () => {
      setTitle('')
      setMeetingType('regular')
      setDescription('')
      setStart('')
      setEnd('')
      setLink('')
      invalidate()
      toast({ title: 'Встреча запланирована' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось создать встречу', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: MeetingUpdateInput }) => meetingsApi.update(id, body),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: 'Не удалось обновить', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => meetingsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Встреча удалена' })
    },
  })

  const createNoteSessionMutation = useMutation({
    mutationFn: (meeting: Meeting) => notesApi.createSession({
      student_id: meeting.student_id,
      meeting_id: meeting.id,
      title: `Конспект: ${meeting.title}`,
      source: 'meeting',
    }),
    onSuccess: (session) => {
      invalidate()
      navigate(`/notes/session/${session.id}`)
    },
    onError: () => toast({ title: 'Не удалось создать конспект', variant: 'destructive' }),
  })

  const createFollowUpMutation = useMutation({
    mutationFn: (meeting: Meeting) => {
      const source = meeting.outcome || meeting.description || meeting.title
      return tasksApi.create(meeting.student_id, {
        task_text: `Follow-up после звонка «${meeting.title}»: ${source}`,
        status: 'open',
      })
    },
    onSuccess: () => {
      invalidate()
      toast({ title: 'Follow-up задача создана' })
    },
    onError: () => toast({ title: 'Не удалось создать задачу', variant: 'destructive' }),
  })

  const createAiActionsMutation = useMutation({
    mutationFn: (meeting: Meeting) => meetingsApi.createAiActions(meeting.id),
    onSuccess: (note) => {
      invalidate()
      toast({ title: 'AI-разбор создан', description: 'Откроется черновик конспекта на проверку.' })
      navigate(`/notes/${note.id}`)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось создать AI-разбор', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const createFollowUpDraftMutation = useMutation({
    mutationFn: (meeting: Meeting) => meetingsApi.createFollowUpDraft(meeting.id),
    onSuccess: (draft) => setFollowUpDraft(draft),
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось создать follow-up', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const sendFollowUpMutation = useMutation({
    mutationFn: (message: string) => meetingsApi.sendFollowUp(followUpDraft!.meeting_id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast({ title: 'Follow-up отправлен', description: 'Сообщение сохранено в чате студента.' })
      setFollowUpDraft(null)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось отправить follow-up', description: detail ?? 'Текст можно скопировать вручную.', variant: 'destructive' })
    },
  })

  const copyFollowUpText = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message)
      toast({ title: 'Follow-up текст скопирован' })
    } catch {
      toast({ title: 'Не удалось скопировать', description: 'Выделите текст в окне и скопируйте вручную.', variant: 'destructive' })
    }
  }

  /*
   * Recording/transcript/outcome still use compact prompt flows. Follow-up is
   * deliberately upgraded to a review dialog because it can message a student.
   */
  const legacyCopyFollowUpDraftMutation = {
    isPending: createFollowUpDraftMutation.isPending,
    mutate: (meeting: Meeting) => createFollowUpDraftMutation.mutate(meeting),
  }

  const addLink = (m: Meeting, field: 'recording_url' | 'transcript_url') => {
    const url = window.prompt(field === 'recording_url' ? 'Ссылка на запись' : 'Ссылка на транскрипт', m[field])?.trim()
    if (url !== undefined) updateMutation.mutate({ id: m.id, body: { [field]: url } })
  }

  const finishMeeting = (m: Meeting) => {
    const outcome = window.prompt('Итог звонка / что решили / следующий шаг', m.outcome || '')?.trim()
    if (outcome === undefined) return
    updateMutation.mutate({ id: m.id, body: { status: 'completed', outcome } })
  }

  const editOutcome = (m: Meeting) => {
    const outcome = window.prompt('Итог звонка', m.outcome || '')?.trim()
    if (outcome !== undefined) updateMutation.mutate({ id: m.id, body: { outcome } })
  }

  const canCreate = title.trim() && start && end

  return (
    <>
    <AccordionItem value="meetings" className="border border-gray-200 rounded-[2px] px-4">
      <AccordionTrigger className="text-base font-semibold">
        <span className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-500" />
          Встречи
          <Badge variant="outline" className="ml-1 text-[10px] font-medium text-gray-500">
            {meetings.length}
          </Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {/* create */}
        <div className="border border-gray-200 rounded-[2px] p-3 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Input placeholder="Тема встречи" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value as MeetingType)}
              className="h-10 px-3 text-sm border border-gray-300 rounded-[2px] bg-white"
            >
              {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Input placeholder="Ссылка (Zoom/Meet)" value={link} onChange={(e) => setLink(e.target.value)} />
            <Input placeholder="Повестка / что проверить" value={description} onChange={(e) => setDescription(e.target.value)} />
            <label className="text-xs text-gray-500">
              Начало
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full h-10 px-3 text-sm border border-gray-300 rounded-[2px] bg-white"
              />
            </label>
            <label className="text-xs text-gray-500">
              Окончание
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 w-full h-10 px-3 text-sm border border-gray-300 rounded-[2px] bg-white"
              />
            </label>
          </div>
          <Button
            size="sm"
            className="mt-3 h-9 px-4 text-xs"
            disabled={!canCreate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Запланировать
          </Button>
        </div>

        {/* list */}
        {isLoading ? (
          <p className="text-sm text-gray-500 py-2">Загрузка…</p>
        ) : meetings.length === 0 ? (
          <p className="text-sm text-gray-400 py-1">Встреч пока нет</p>
        ) : (
          <div className="space-y-2">
            {meetings.map((m) => (
              <div key={m.id} className="border border-gray-100 rounded-[2px] p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">{m.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {fmt(m.starts_at)} — {new Date(m.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px] font-medium text-gray-500">
                        {MEETING_TYPE_LABELS[m.meeting_type]}
                      </Badge>
                      {m.note_session_id && (
                        <Badge variant="outline" className="text-[10px] font-medium text-emerald-600">
                          Конспект привязан
                        </Badge>
                      )}
                    </div>
                    {m.description && <p className="mt-2 text-xs text-gray-500">Повестка: {m.description}</p>}
                    {m.outcome && <p className="mt-2 text-xs text-emerald-700">Итог: {m.outcome}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] font-medium shrink-0">
                    {STATUS_LABEL[m.status]}
                  </Badge>
                  <button
                    onClick={() => window.confirm('Удалить встречу?') && deleteMutation.mutate(m.id)}
                    className="text-gray-300 hover:text-red-500 shrink-0"
                    aria-label="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {m.status === 'scheduled' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => finishMeeting(m)}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1.5" /> Завершить
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => editOutcome(m)}>
                    <CheckCircle2 className="w-3 h-3 mr-1.5" /> Итог
                  </Button>
                  {m.note_session_id ? (
                    <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                      <Link to={`/notes/session/${m.note_session_id}`}>
                        <Mic className="w-3 h-3 mr-1.5" /> Конспект ✓
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={createNoteSessionMutation.isPending}
                      onClick={() => createNoteSessionMutation.mutate(m)}
                    >
                      <Mic className="w-3 h-3 mr-1.5" /> Конспект
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={createFollowUpMutation.isPending}
                    onClick={() => createFollowUpMutation.mutate(m)}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1.5" /> Задача из итога
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={createAiActionsMutation.isPending}
                    onClick={() => createAiActionsMutation.mutate(m)}
                  >
                    <Sparkles className="w-3 h-3 mr-1.5" /> AI-разбор
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={legacyCopyFollowUpDraftMutation.isPending}
                    onClick={() => legacyCopyFollowUpDraftMutation.mutate(m)}
                  >
                    <MessageSquareText className="w-3 h-3 mr-1.5" /> Follow-up текст
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => addLink(m, 'recording_url')}>
                    <PlayCircle className="w-3 h-3 mr-1.5" /> {m.recording_url ? 'Запись ✓' : 'Запись'}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => addLink(m, 'transcript_url')}>
                    <FileText className="w-3 h-3 mr-1.5" /> {m.transcript_url ? 'Транскрипт ✓' : 'Транскрипт'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
    <FollowUpReviewDialog
      draft={followUpDraft}
      open={!!followUpDraft}
      isSending={sendFollowUpMutation.isPending}
      onOpenChange={(open) => !open && setFollowUpDraft(null)}
      onCopy={copyFollowUpText}
      onSend={(message) => sendFollowUpMutation.mutate(message)}
    />
    </>
  )
}
