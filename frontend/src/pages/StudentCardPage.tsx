import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  Edit2,
  Plus,
  Check,
  Eye,
  Shield,
  Download,
  Minus,
  BookText,
  UserRoundCheck,
  Link2Off,
  Trash2,
  ListChecks,
} from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { studentsApi } from '@/api/students'
import {
  guardiansApi,
  tasksApi,
  confidentialNotesApi,
  historyApi,
  usersApi,
  portfolioApi,
  servicesApi,
  telegramApi,
  mentorAssignmentsApi,
  contractsApi,
} from '@/api/index'
import { syncApi } from '@/api/sync'
import { notionApi, type NotionComparisonRow } from '@/api/notion'
import { stripMarkdown } from '@/components/shared/Markdown'
import { StudentRoadmapSection } from '@/components/shared/StudentRoadmapSection'
import { StudentMeetingsSection } from '@/components/shared/StudentMeetingsSection'
import { DocVisibilityToggle } from '@/components/shared/DocVisibilityToggle'
import { StudentChatSection } from '@/components/shared/StudentChatSection'
import { PortalAccessSection } from '@/components/shared/PortalAccessSection'
import { TelegramGroupManager } from '@/components/shared/TelegramGroupManager'
import { useAuth } from '@/contexts/AuthContext'
import {
  DOC_TYPE_LABELS,
  SERVICE_TYPE_LABELS,
  SERVICE_STATUS_LABELS,
  SUBMISSION_STATUS_LABELS,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_STATUS_COLORS,
  StudentFull,
  Service,
  Guardian,
  Document,
  NoteVisibility,
  StudentTimelineItem,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/primitives/accordion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import { downloadBlob, formatDate, formatCurrency, formatFileSize } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center py-2 border-b border-p-line last:border-0">
      <span className="text-sm text-p-muted sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-p-text font-medium mt-0.5 sm:mt-0">
        {value ?? '—'}
      </span>
    </div>
  )
}

/** Строка «поле: значение» с редактированием по двойному клику.
 * Enter/blur — сохранить, Esc — отмена; select сохраняет при выборе. */
function EditableInfoRow({
  label,
  display,
  editValue,
  canEdit,
  onSave,
  type = 'text',
  options,
}: {
  label: string
  display?: string | number | null
  editValue?: string | number | null
  canEdit: boolean
  onSave: (value: string) => void
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const committedRef = React.useRef(false)

  const initial = String(editValue ?? display ?? '')

  const start = () => {
    if (!canEdit) return
    committedRef.current = false
    setDraft(initial)
    setEditing(true)
  }
  const cancel = () => {
    committedRef.current = true // blur при размонтировании не должен сохранить
    setEditing(false)
  }
  const commit = (value?: string) => {
    if (committedRef.current) return
    committedRef.current = true
    setEditing(false)
    const v = (value ?? draft).trim()
    if (v === initial.trim()) return
    onSave(v)
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center py-2 border-b border-p-line last:border-0">
      <span className="text-sm text-p-muted sm:w-48 shrink-0">{label}</span>
      {!editing && !canEdit ? (
        <span className="text-sm text-p-text font-medium mt-0.5 sm:mt-0 min-w-0 break-words">
          {display ?? '—'}
        </span>
      ) : !editing ? (
        <button
          type="button"
          className="group flex min-w-0 cursor-pointer items-center rounded-ctl -mx-1 px-1 text-left text-sm text-p-text font-medium mt-0.5 sm:mt-0 hover:bg-amber-50/70"
          title="Редактировать"
          onClick={start}
          onDoubleClick={start}
        >
          <span className="min-w-0 break-words">{display ?? '—'}</span>
        </button>
      ) : type === 'select' ? (
        <Select
          defaultOpen
          value={draft || undefined}
          onValueChange={(v) => commit(v)}
          onOpenChange={(open) => {
            if (!open && !committedRef.current) cancel()
          }}
        >
          <SelectTrigger className="h-8 w-full sm:w-64 text-sm">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : type === 'textarea' ? (
        <div className="flex-1 min-w-0">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            }}
          />
          <div className="flex gap-1.5 mt-1.5">
            <Button size="sm" className="h-7 text-xs" onClick={() => commit()}>
              Сохранить
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancel}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 sm:max-w-sm">
          <Input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
              if (e.key === 'Enter') commit()
            }}
            className="h-8 w-full text-sm"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 text-xs" onClick={() => commit()}>
              Сохранить
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancel}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditStudentModal({
  student,
  open,
  onClose,
}: {
  student: StudentFull
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    full_name: student.full_name,
    phone: student.phone,
    specialty: student.specialty ?? '',
    gpa: student.gpa ?? '',
    achievements_text: student.achievements_text ?? '',
    budget_per_year: student.budget_per_year ?? '',
    city: student.city ?? '',
  })

  const mutation = useMutation({
    mutationFn: (data: Partial<StudentFull>) =>
      studentsApi.update(student.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', student.id] })
      toast({ title: 'Сохранено', description: 'Данные студента обновлены' })
      onClose()
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось сохранить', variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать студента</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>ФИО</Label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div>
            <Label>Телефон</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label>Город</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label>Специальность</Label>
            <Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
          </div>
          <div>
            <Label>GPA</Label>
            <Input value={form.gpa} onChange={(e) => setForm({ ...form, gpa: e.target.value })} />
          </div>
          <div>
            <Label>Достижения</Label>
            <Textarea value={form.achievements_text} onChange={(e) => setForm({ ...form, achievements_text: e.target.value })} />
          </div>
          <div>
            <Label>Бюджет в год</Label>
            <Input value={form.budget_per_year} onChange={(e) => setForm({ ...form, budget_per_year: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceEditModal({
  service,
  open,
  onClose,
  mentors,
}: {
  service: Service
  open: boolean
  onClose: () => void
  mentors: Array<{ id: string; name: string }>
}) {
  const queryClient = useQueryClient()
  const { id: studentId } = useParams()
  const [form, setForm] = useState({
    included: service.included,
    status: service.status,
    result: service.result ?? '',
    notes: service.notes ?? '',
    assigned_mentor_id: service.assigned_mentor_id ?? '',
    deadline: service.deadline ?? '',
    portfolio_directions_count: service.portfolio_directions_count ?? 0,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      return servicesApi.update(service.id, {
        ...form,
        assigned_mentor_id:
          form.assigned_mentor_id && form.assigned_mentor_id !== 'none'
            ? form.assigned_mentor_id
            : undefined,
        assigned_staff_id:
          form.assigned_mentor_id && form.assigned_mentor_id !== 'none'
            ? form.assigned_mentor_id
            : undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] })
      toast({ title: 'Сохранено' })
      onClose()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {SERVICE_TYPE_LABELS[service.service_type]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Включена в пакет</Label>
            <Select value={form.included ? 'true' : 'false'} onValueChange={(v) => setForm({ ...form, included: v === 'true' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Включена</SelectItem>
                <SelectItem value="false">Не включена</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={form.included ? undefined : 'opacity-50'}>
            <Label>Статус</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as Service['status'] })}
              disabled={!form.included}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SERVICE_STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!form.included && (
              <p className="mt-1 text-2xs text-p-muted">Статус работает только для включённых услуг</p>
            )}
          </div>
          <div>
            <Label>Ментор</Label>
            <Select value={form.assigned_mentor_id || 'none'} onValueChange={(v) => setForm({ ...form, assigned_mentor_id: v })}>
              <SelectTrigger><SelectValue placeholder="Выберите ментора" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не назначен</SelectItem>
                {mentors.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Результат</Label>
            <Input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
          </div>
          <div>
            <Label>Дедлайн</Label>
            <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <div>
            <Label>Примечания</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function serviceTone(status: Service['status']): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'in_progress' || status === 'scheduled') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-p-line bg-p-bg text-p-muted'
}

// Значение preview для диалога записи в Notion: число форматируем с разделителями,
// пусто → «—». (Даты/строки приходят уже в готовом виде из Notion/CRM.)
function formatPushValue(v: string | number | null): string {
  if (v === null || v === '') return '—'
  if (typeof v === 'number') return new Intl.NumberFormat('ru-RU').format(v)
  return String(v)
}

// Поля формы договора (patch-ключ) → поле push в Notion (PUSH_FIELDS на бэке) + подпись.
// Только колонки, которые Notion разрешает писать; формульные (TBP и т.п.) сюда не входят.
const CONTRACT_PUSH_FIELDS: Record<string, { field: string; label: string }> = {
  signed_date: { field: 'signed_date', label: 'Дата договора' },
  amount: { field: 'client_fee', label: 'Client fee' },
  pipeline_status: { field: 'pipeline_status', label: 'Статус выплат' },
  english_sum: { field: 'english_sum', label: 'Сумма (англ)' },
  english_paid: { field: 'english_paid', label: 'Оплачено (англ)' },
  client_remaining_amount: { field: 'client_remaining', label: 'Остаток клиента' },
  client_remaining_date: { field: 'client_remaining_date', label: 'Остаток (дата)' },
}

export const StudentCardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { canAccess, hasRole } = useAuth()
  const canEditContract = hasRole('admin', 'mzk_manager')

  const [editOpen, setEditOpen] = useState(false)
  const [editService, setEditService] = useState<Service | null>(null)
  const [revealedIins, setRevealedIins] = useState<Record<string, string>>({})
  const [revealConfirm, setRevealConfirm] = useState<string | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [noteRole, setNoteRole] = useState<NoteVisibility>('admin_and_mzk')
  const [documentOpenId, setDocumentOpenId] = useState<string | null>(null)
  const [documentDeleteTarget, setDocumentDeleteTarget] = useState<Document | null>(null)
  const [documentDeletePending, setDocumentDeletePending] = useState(false)
  const [unlinkNotionConfirm, setUnlinkNotionConfirm] = useState<string | null>(null)
  const [pushNotionConfirm, setPushNotionConfirm] = useState<NotionComparisonRow | null>(null)
  // Предложение записать в Notion после правки поля договора (см. CONTRACT_PUSH_FIELDS).
  const [pendingNotionPush, setPendingNotionPush] = useState<{ field: string; label: string } | null>(null)
  const [mentorToAssign, setMentorToAssign] = useState('')

  const { data: student, isLoading, error } = useQuery<StudentFull>({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id!),
    enabled: !!id,
  })

  const { data: mentors = [] } = useQuery({
    queryKey: ['users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: history = [] } = useQuery({
    queryKey: ['history', 'student', id],
    queryFn: () => historyApi.list({ entity_type: 'student', entity_id: id! }),
    enabled: !!id && (hasRole('admin', 'mzk_manager', 'mentor')),
  })

  const { data: timelineData } = useQuery({
    queryKey: ['student-timeline', id],
    queryFn: () => studentsApi.timeline(id!, { limit: 80 }),
    enabled: !!id && (hasRole('admin', 'mzk_manager', 'mentor')),
  })

  const { data: intake } = useQuery({
    queryKey: ['intake', 'student', id],
    queryFn: () => syncApi.studentIntake(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const { data: notion } = useQuery({
    queryKey: ['notion', 'student', id],
    queryFn: () => notionApi.studentNotion(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const updateContractFieldMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      contractsApi.update(student!.contracts![0].id, patch),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['notion', 'student', id] })
      toast({ title: 'Сохранено' })
      // Если поле пишется в Notion и запись привязана — предлагаем записать туда же.
      const key = Object.keys(variables)[0]
      const mapped = CONTRACT_PUSH_FIELDS[key]
      if (mapped && notion?.snapshot) setPendingNotionPush(mapped)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось сохранить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  // Preview записи в Notion для диалога-подтверждения (что было в Notion → что станет).
  const notionPushPreview = useQuery({
    queryKey: ['notion-push-preview', id, pendingNotionPush?.field],
    queryFn: () => notionApi.pushFieldPreview(id!, pendingNotionPush!.field),
    enabled: !!id && !!pendingNotionPush,
  })

  const unlinkNotionMutation = useMutation({
    mutationFn: (snapshotId: string) => notionApi.unlink(snapshotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notion'] })
      toast({
        title: 'Привязка к Notion снята',
        description: 'Запись вернулась в «Notion без привязки». Автосинк не привяжет её обратно.',
      })
    },
    onError: () => toast({ title: 'Не удалось отвязать', variant: 'destructive' }),
  })

  const applyNotionFieldMutation = useMutation({
    mutationFn: (field: string) => notionApi.applyField(id!, field),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notion', 'student', id] })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['history', 'student', id] })
      toast({ title: 'Значение принято из Notion' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось применить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const pushNotionFieldMutation = useMutation({
    mutationFn: ({ field, force }: { field: string; force?: boolean }) => notionApi.pushField(id!, field, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notion', 'student', id] })
      queryClient.invalidateQueries({ queryKey: ['history', 'student', id] })
      setPushNotionConfirm(null)
      toast({ title: 'Записано в Notion' })
    },
    onError: (err: unknown, variables) => {
      const resp = (err as { response?: { status?: number; data?: { detail?: string } } }).response
      // 409 — значение в Notion изменили после синка. Предлагаем осознанную перезапись.
      if (resp?.status === 409 && !variables.force) {
        if (window.confirm(`${resp.data?.detail ?? 'Конфликт с Notion.'}\n\nПерезаписать значением из CRM всё равно?`)) {
          pushNotionFieldMutation.mutate({ field: variables.field, force: true })
        }
        return
      }
      toast({ title: 'Не удалось записать в Notion', description: resp?.data?.detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const { data: telegramChat } = useQuery({
    queryKey: ['telegram-chat', 'student', id],
    queryFn: () => telegramApi.getForStudent(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const { data: telegramMessages = [] } = useQuery({
    queryKey: ['telegram-chat', telegramChat?.id, 'messages'],
    queryFn: () => telegramApi.listMessages(telegramChat!.id),
    enabled: !!telegramChat?.id,
  })

  const assignSelfMutation = useMutation({
    mutationFn: () => mentorAssignmentsApi.assignSelf(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  const assignMentorMutation = useMutation({
    mutationFn: (mentorId: string) =>
      mentorAssignmentsApi.create(id!, {
        mentor_id: mentorId,
        role: 'lead',
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      setMentorToAssign('')
      toast({
        title: 'Ментор назначен',
        description: 'Студент появится у этого ментора в CRM «Мои студенты» и в личном кабинете.',
      })
    },
    onError: () =>
      toast({
        title: 'Ошибка',
        description: 'Не удалось назначить ментора',
        variant: 'destructive',
      }),
  })

  const unassignSelfMutation = useMutation({
    mutationFn: () => mentorAssignmentsApi.setSelfActive(id!, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент снят с ваших' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось снять студента', variant: 'destructive' }),
  })

  const toggleTaskMutation = useMutation({
    mutationFn: (task: { id: string; status: 'open' | 'done' }) =>
      tasksApi.update(task.id, {
        status: task.status === 'open' ? 'done' : 'open',
        done_at: task.status === 'open' ? new Date().toISOString() : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student', id] }),
  })

  const addTaskMutation = useMutation({
    mutationFn: (text: string) =>
      tasksApi.create(id!, { task_text: text, status: 'open' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      setNewTaskText('')
      setAddingTask(false)
    },
  })

  const addNoteMutation = useMutation({
    mutationFn: () =>
      confidentialNotesApi.create(id!, {
        note_text: newNote,
        visible_to_role: noteRole,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      setNewNote('')
      setAddingNote(false)
    },
  })

  const noteVisibilityMutation = useMutation({
    mutationFn: ({ noteId, visible }: { noteId: string; visible: boolean }) =>
      confidentialNotesApi.setStudentVisibility(noteId, visible),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      toast({ title: vars.visible ? 'Заметка видна ученику' : 'Заметка скрыта от ученика' })
    },
    onError: () => toast({ title: 'Не удалось изменить видимость', variant: 'destructive' }),
  })

  const revealIin = async (guardianId: string) => {
    try {
      const result = await guardiansApi.revealIin(guardianId)
      setRevealedIins((prev) => ({ ...prev, [guardianId]: result.iin }))
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось раскрыть ИИН', variant: 'destructive' })
    }
    setRevealConfirm(null)
  }

  const handleExportStudent = async () => {
    if (!id) return
    try {
      const blob = await studentsApi.exportOne(id)
      downloadBlob(blob, `student-${id}.xlsx`)
    } catch {
      toast({ title: 'Ошибка', description: 'Ошибка экспорта', variant: 'destructive' })
    }
  }

  const handleOpenDocument = async (doc: Document) => {
    setDocumentOpenId(doc.id)
    try {
      const blob = await documentsApi.download(doc.id)
      const url = URL.createObjectURL(blob)
      const tab = window.open(url, '_blank', 'noopener,noreferrer')
      if (!tab) {
        downloadBlob(blob, doc.file_name)
      } else {
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось открыть документ', variant: 'destructive' })
    } finally {
      setDocumentOpenId(null)
    }
  }

  const handleDeleteDocument = async () => {
    if (!documentDeleteTarget) return
    setDocumentDeletePending(true)
    try {
      await documentsApi.delete(documentDeleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      toast({ title: 'Удалено', description: 'Документ удалён из карточки' })
      setDocumentDeleteTarget(null)
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось удалить документ', variant: 'destructive' })
    } finally {
      setDocumentDeletePending(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-p-muted">Загрузка...</div>
      </div>
    )
  }

  if (error || !student) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Студент не найден</p>
        <Link to="/students" className="text-p-muted hover:text-black underline underline-offset-4 text-sm mt-2 block">
          Вернуться к списку
        </Link>
      </div>
    )
  }

  const contract = student.contracts?.[0]
  const portfolio = student.portfolio_progress
  const openTasks = (student.student_tasks || []).filter((task) => task.status === 'open')
  const intakeMismatchCount = intake?.comparison?.filter((row) => (
    (row.mismatch && row.ai_same_meaning !== true) ||
    (row.crm_matches === false && !row.human_only && row.crm_ai_same_meaning !== true)
  )).length ?? 0
  const notionMismatchCount = notion?.comparison?.filter((row) => row.matches === false).length ?? 0
  const fallbackTimeline: StudentTimelineItem[] = [
    ...(student.documents || []).map((doc) => ({
      id: `doc-${doc.id}`,
      at: doc.uploaded_at,
      kind: 'Документ',
      title: doc.file_name,
      text: `${DOC_TYPE_LABELS[doc.doc_type as keyof typeof DOC_TYPE_LABELS] || doc.doc_type}${doc.is_verified ? ' · проверен' : ' · на проверке'}`,
      href: '#documents',
    })),
    ...(student.student_tasks || []).map((task) => ({
      id: `task-${task.id}`,
      at: task.done_at || task.created_at,
      kind: task.status === 'done' ? 'Задача закрыта' : 'Задача',
      title: task.task_text,
      text: task.status === 'done' ? 'Выполнена' : 'Открыта',
      href: '#tasks',
    })),
    ...(student.communication_logs || []).map((log) => ({
      id: `comm-${log.id}`,
      at: log.created_at,
      kind: log.source,
      title: log.ai_summary || log.raw_text || log.message_type,
      text: log.raw_text || log.ai_summary || '',
      href: '#timeline',
    })),
    ...(student.notes || []).map((note) => ({
      id: `note-${note.id}`,
      at: note.reviewed_at || note.created_at,
      kind: note.status === 'draft' ? 'AI-черновик' : 'Конспект',
      title: note.title,
      text: note.status,
      href: `/notes/${note.id}`,
    })),
    ...(student.pending_insights || []).map((insight) => ({
      id: `insight-${insight.id}`,
      at: insight.created_at,
      kind: 'AI-сигнал',
      title: insight.insight_type,
      text: `${insight.status} · ${Math.round((insight.confidence || 0) * 100)}%`,
      href: '#timeline',
    })),
    ...history.map((entry) => ({
      id: `history-${entry.id}`,
      at: entry.changed_at,
      kind: 'Изменение CRM',
      title: entry.field_changed,
      text: `${entry.old_value ?? '—'} → ${entry.new_value ?? '—'}${entry.source ? ` · ${entry.source}` : ''}`,
      href: '#history',
    })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40)
  const timeline = timelineData?.items?.length ? timelineData.items : fallbackTimeline

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-p-line pb-6">
        <Link to="/students" className="flex items-center text-p-muted hover:text-black text-sm transition-colors">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Назад
        </Link>
        <div className="flex-1 min-w-[240px]">
          <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Карточка студента</div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-p-text md:text-4xl">{student.full_name}</h1>
            {student.is_archived && (
              <span className="text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide bg-p-panel text-p-muted border border-p-line">
                Архивирован
              </span>
            )}
            <span className={`text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
              {DEGREE_LEVEL_LABELS[student.degree_level]}
            </span>
            {student.pipeline_status && (
              <span className={`text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                {PIPELINE_STATUS_LABELS[student.pipeline_status]}
              </span>
            )}
          </div>
        </div>
        <Button
          variant={student.is_mine ? 'outline' : 'default'}
          size="sm"
          className="h-10 px-4"
          disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
          onClick={() => {
            if (student.is_mine) unassignSelfMutation.mutate()
            else assignSelfMutation.mutate()
          }}
        >
          {student.is_mine ? 'Мой студент' : 'Взять в работу'}
        </Button>
        <Button variant="outline" size="sm" className="h-10 px-4" onClick={handleExportStudent}>
          <Download className="w-4 h-4 mr-2" />
          Экспорт
        </Button>
        <Button asChild variant="outline" size="sm" className="h-10 px-4">
          <Link to={`/notes?student_id=${student.id}&create=1`}>
            <BookText className="w-4 h-4 mr-2" />
            Конспекты
          </Link>
        </Button>
        {canAccess('confidential') && (
          <Button variant="outline" size="sm" className="h-10 px-4" onClick={() => document.getElementById('student-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Shield className="w-4 h-4 mr-2" />
            Заметки
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="h-10 px-4">
          <Link to={`/workspace/students/${student.id}`}>
            <UserRoundCheck className="w-4 h-4 mr-2" />
            Кабинет staff
          </Link>
        </Button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        {(student.alerts ?? []).map((a, i) => {
          const tone = a.level === 'danger'
            ? 'border-red-300 text-red-700 dark:border-red-900/60 dark:text-red-300'
            : a.level === 'warning'
              ? 'border-amber-300 text-amber-700 dark:border-amber-900/60 dark:text-amber-300'
              : 'border-sky-300 text-sky-700 dark:border-sky-900/60 dark:text-sky-300'
          const label = a.kind === 'mentor_unpaid' ? 'Выплата ментору' : 'Оплата клиента'
          const sub = a.kind === 'payment_overdue'
            ? `просрочка ${Math.abs(a.days ?? 0)} дн.${a.due_date ? ` · срок ${formatDate(a.due_date)}` : ''}`
            : a.kind === 'payment_due'
              ? `через ${a.days ?? 0} дн.${a.due_date ? ` · срок ${formatDate(a.due_date)}` : ''}`
              : 'осталось выплатить'
          return (
            <div key={`${a.kind}-${i}`} className={`rounded-panel border bg-p-bg px-3 py-2 ${tone}`}>
              <p className="text-2xs uppercase tracking-[0.18em] opacity-80">{label}</p>
              <p className="mt-1 text-sm font-bold">
                {a.amount != null ? `${new Intl.NumberFormat('ru-RU').format(Math.round(a.amount))} ${a.currency}` : '—'}
              </p>
              <p className="text-2xs opacity-70">{sub}</p>
            </div>
          )
        })}
        <div className="rounded-panel border border-p-line bg-p-bg px-3 py-2">
          <p className="text-2xs uppercase tracking-[0.18em] text-p-muted2">Следующее действие</p>
          <p className="mt-1 text-sm font-semibold text-p-text">
            {openTasks[0]?.task_text || (student.is_mine ? 'Открытых задач нет' : 'Назначьте ответственного')}
          </p>
        </div>
        <div className="rounded-panel border border-p-line bg-p-bg px-3 py-2">
          <p className="text-2xs uppercase tracking-[0.18em] text-p-muted2">Риски данных</p>
          {intakeMismatchCount + notionMismatchCount > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-700">
              <span>{intakeMismatchCount + notionMismatchCount} расхожд.</span>
              {notionMismatchCount > 0 && (
                <button
                  type="button"
                  onClick={() => document.getElementById('notion-sync')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="inline-flex items-center gap-1 rounded-pill border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
                  title="Перейти к сверке с Notion"
                >
                  ⇆ {notionMismatchCount} с Notion
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-emerald-700">Расхождений нет</p>
          )}
        </div>
      </div>

      <Accordion type="multiple" defaultValue={['profile', 'applications', 'services', 'tasks']} className="space-y-2">
        <AccordionItem value="responsibles" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Ответственные
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              {student.responsibles && student.responsibles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {student.responsibles.map((responsible) => (
                    <span
                      key={responsible.assignment_id || responsible.id}
                      className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-1 text-xs ${
                        responsible.is_active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-p-line bg-p-bg text-p-muted2'
                      }`}
                    >
                      {responsible.name || 'Без имени'}
                      <span className="text-2xs uppercase tracking-wide opacity-70">
                        {responsible.is_active ? 'активен' : 'снят'}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-p-muted">Ответственные не назначены</p>
              )}
              <Button
                variant={student.is_mine ? 'outline' : 'default'}
                size="sm"
                disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
                onClick={() => {
                  if (student.is_mine) unassignSelfMutation.mutate()
                  else assignSelfMutation.mutate()
                }}
              >
                {student.is_mine ? 'Снять с моих' : 'Добавить себя'}
              </Button>
              {hasRole('admin', 'mzk_manager') && (
                <div className="rounded-panel border border-p-line bg-p-bg p-3">
                  <div className="mb-2">
                    <p className="text-sm font-medium text-p-text">Назначить ментора</p>
                    <p className="text-xs text-p-muted">
                      После назначения студент появится у выбранного ментора в CRM «Мои студенты» и в личном кабинете ментора.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select value={mentorToAssign} onValueChange={setMentorToAssign}>
                      <SelectTrigger className="sm:max-w-xs bg-white">
                        <SelectValue placeholder="Выберите ментора" />
                      </SelectTrigger>
                      <SelectContent>
                        {mentors.map((mentor) => {
                          const alreadyActive = student.responsibles?.some(
                            (responsible) => responsible.id === mentor.id && responsible.is_active
                          )
                          return (
                            <SelectItem key={mentor.id} value={mentor.id} disabled={alreadyActive}>
                              {mentor.name}{alreadyActive ? ' · уже назначен' : ''}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!mentorToAssign || assignMentorMutation.isPending}
                      onClick={() => assignMentorMutation.mutate(mentorToAssign)}
                    >
                      {assignMentorMutation.isPending ? 'Назначаем...' : 'Назначить'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 0. Сверка анкет: менеджер vs студент vs CRM */}
        {intake && (intake.package || intake.cases) && (
          <AccordionItem value="intake" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              Сверка анкет
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-p-muted">
                <span>
                  Пакет (менеджер):{' '}
                  {intake.package
                    ? `${intake.package.manager_name ?? '—'} · ${intake.package.submitted_at ? new Date(intake.package.submitted_at).toLocaleDateString('ru-RU') : ''}`
                    : 'анкеты нет'}
                </span>
                <span>
                  Кейс (студент):{' '}
                  {intake.cases
                    ? `${intake.cases.submitted_at ? new Date(intake.cases.submitted_at).toLocaleDateString('ru-RU') : 'есть'}`
                    : 'анкеты нет'}
                </span>
              </div>
              <div className="border border-p-line rounded-panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-p-line">
                      <th className="text-left px-3 py-2 label-caps font-medium w-44">Поле</th>
                      {intake.package && (
                        <th className="text-left px-3 py-2 label-caps font-medium">Менеджер · Пакет</th>
                      )}
                      {intake.cases && (
                        <th className="text-left px-3 py-2 label-caps font-medium">Студент · Кейс</th>
                      )}
                      <th className="text-left px-3 py-2 label-caps font-medium">CRM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intake.comparison.map((row) => {
                      const crmMatches = row.crm_matches ?? false
                      const aiSuggestsSame = row.mismatch && row.ai_same_meaning === true
                      const realMismatch = row.mismatch && !aiSuggestsSame
                      const crmMismatch = row.crm_matches === false && !row.human_only && row.crm_ai_same_meaning !== true
                      return (
                        <tr
                          key={row.field}
                          className={`border-b border-p-line last:border-0 ${
                            realMismatch || crmMismatch ? 'bg-amber-50' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-p-muted align-top whitespace-nowrap">
                            {row.label}
                            {row.human_only && (
                              <span className="block text-xs text-p-muted2 mt-0.5">
                                🔒 вносится вручную
                              </span>
                            )}
                            {realMismatch && (
                              <span className="block text-xs text-amber-600 mt-0.5">
                                расхождение
                              </span>
                            )}
                            {crmMismatch && (
                              <span className="block text-xs text-amber-600 mt-0.5">
                                CRM расходится
                              </span>
                            )}
                            {aiSuggestsSame && (
                              <span className="block text-xs text-sky-600 mt-0.5" title={row.ai_note ?? undefined}>
                                вероятно совпадает{row.ai_note ? ` · ${row.ai_note}` : ''}
                              </span>
                            )}
                          </td>
                          {intake.package && (
                            <td className="px-3 py-2 text-p-text align-top">
                              {row.package ?? <span className="text-p-muted2">—</span>}
                            </td>
                          )}
                          {intake.cases && (
                            <td className="px-3 py-2 text-p-text align-top">
                              {row.cases ?? <span className="text-p-muted2">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-2 text-p-muted align-top">
                            {crmMatches ? (
                              <span className="text-emerald-600/80 text-xs">✓ совпадает</span>
                            ) : row.crm_ai_same_meaning ? (
                              <span className="text-sky-600 text-xs" title={row.crm_ai_note ?? undefined}>
                                ✓ вероятно совпадает{row.crm_ai_note ? ` · ${row.crm_ai_note}` : ''}
                              </span>
                            ) : (
                              row.crm ?? <span className="text-p-muted2">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-p-muted2 mt-2.5">
                Жёлтым подсвечены поля, где ответы менеджера и студента не совпадают. Стоимость и
                договорённости в CRM вносятся только вручную.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 0.5 Notion: сверка «Notion | CRM» + финансы из Notion */}
        {notion?.snapshot && (
          <AccordionItem value="notion" id="notion-sync" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              <span className="flex items-center gap-2.5">
                Notion
                {notion.comparison.some((r) => r.matches === false) && (
                  <span className="text-2xs font-medium normal-case tracking-normal px-1.5 py-0.5 rounded-pill bg-amber-50 text-amber-700 border border-amber-200">
                    есть расхождения
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="text-xs text-p-muted">
                  Синхронизировано:{' '}
                  {notion.snapshot.synced_at
                    ? new Date(notion.snapshot.synced_at).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                  {notion.snapshot.notion_last_edited_at &&
                    ` · изменено в Notion: ${new Date(notion.snapshot.notion_last_edited_at).toLocaleDateString('ru-RU')}`}
                </p>
                <div className="flex items-center gap-3">
                  {notion.snapshot.notion_url && (
                    <a
                      href={notion.snapshot.notion_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-p-muted underline hover:text-black"
                    >
                      Открыть в Notion
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-p-muted"
                    disabled={unlinkNotionMutation.isPending}
                    title="Если запись Notion привязана не к тому студенту"
                    onClick={() => setUnlinkNotionConfirm(notion.snapshot!.id)}
                  >
                    <Link2Off className="w-3 h-3 mr-1" />
                    Отвязать
                  </Button>
                </div>
              </div>
              <div className="border border-p-line rounded-panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-p-line">
                      <th className="text-left px-3 py-2 label-caps font-medium w-44">Поле</th>
                      <th className="text-left px-3 py-2 label-caps font-medium">Notion</th>
                      <th className="text-left px-3 py-2 label-caps font-medium">CRM</th>
                      <th className="w-32" />
                    </tr>
                  </thead>
                  <tbody>
                    {notion.comparison.map((row) => (
                      <tr
                        key={row.field}
                        className={`border-b border-p-line last:border-0 ${
                          row.matches === false ? 'bg-amber-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-p-muted align-top whitespace-nowrap">
                          {row.label}
                          {row.matches === false && (
                            <span className="block text-xs text-amber-600 mt-0.5">
                              {row.direction === 'notion_newer' ? 'изменено в Notion'
                                : row.direction === 'crm_newer' ? 'изменено в CRM'
                                : row.direction === 'conflict' ? 'конфликт — выбери сторону'
                                : 'расхождение'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-p-text align-top">
                          {row.notion ?? <span className="text-p-muted2">—</span>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.matches ? (
                            <span className="text-emerald-600/80 text-xs">✓ совпадает</span>
                          ) : (
                            <span className="text-p-muted">{row.crm ?? <span className="text-p-muted2">—</span>}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          {row.matches === false && (row.can_apply || row.can_push) && (
                            <div className="flex flex-col items-end gap-1">
                              {row.can_apply && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={`h-6 text-xs ${row.direction === 'notion_newer' ? 'order-first border-amber-400 text-amber-700' : ''}`}
                                  disabled={applyNotionFieldMutation.isPending}
                                  onClick={() => applyNotionFieldMutation.mutate(row.field)}
                                >
                                  Принять из Notion
                                </Button>
                              )}
                              {row.can_push && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={`h-6 text-xs ${row.direction === 'crm_newer' ? 'order-first border-amber-400 text-amber-700' : ''}`}
                                  disabled={pushNotionFieldMutation.isPending}
                                  onClick={() => setPushNotionConfirm(row)}
                                >
                                  → Записать в Notion
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {notion.finance.length > 0 && (
                <div className="mt-4">
                  <p className="label-caps mb-2">Финансы из Notion · только просмотр</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-p-panel2 border border-p-line rounded-panel overflow-hidden">
                    {notion.finance.map((f) => (
                      <div key={f.label} className="bg-white px-3 py-2">
                        <p className="text-2xs uppercase tracking-wide text-p-muted2">{f.label}</p>
                        <p className="text-sm text-p-text font-medium mt-0.5">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-p-muted2 mt-2.5">
                «Принять из Notion» переносит значение в карточку, «→ Записать в Notion» —
                наоборот, из CRM в Notion (с подтверждением). Каждое изменение попадает в историю.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 0. Portal access (staff cockpit for the student's cabinet) */}

        {/* 0b. Roadmap control */}
        {hasRole('admin', 'mzk_manager', 'mentor') && <StudentRoadmapSection studentId={id!} />}

        {/* 0c. Meetings */}
        {hasRole('admin', 'mzk_manager', 'mentor') && <StudentMeetingsSection studentId={id!} />}

        {/* 0e. Chat with student */}
        {hasRole('admin', 'mzk_manager', 'mentor') && <PortalAccessSection studentId={id!} />}
        {hasRole('admin', 'mzk_manager', 'mentor') && <StudentChatSection studentId={id!} />}

        {/* 1. Profile */}
        <AccordionItem value="profile" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Профиль студента
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex justify-end gap-2 mb-2">
              {canAccess('all_students') && (
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditOpen(true)}>
                  <Edit2 className="w-3 h-3 mr-2" />
                  Редактировать
                </Button>
              )}
            </div>
            <InfoRow label="ФИО" value={student.full_name} />
            <InfoRow label="Телефон" value={student.phone} />
            <InfoRow label="Город" value={student.city} />
            <InfoRow label="Уровень" value={DEGREE_LEVEL_LABELS[student.degree_level]} />
            <InfoRow label="Год поступления" value={student.intake_year} />
            <InfoRow label="Специальность" value={student.specialty} />
            <InfoRow label="GPA" value={student.gpa} />
            <InfoRow label="Бюджет/год" value={student.budget_per_year} />
            <InfoRow label="Достижения" value={student.achievements_text} />
            <InfoRow label="Дней в работе" value={student.days_in_work} />

            {canAccess('guardians') && (
              <div className="mt-5 pt-4 border-t border-p-line">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-p-text">Родители / Опекуны</h3>
                </div>
                {student.guardians && student.guardians.length > 0 ? (
                  <div className="overflow-hidden rounded-panel border border-p-line">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ФИО</TableHead>
                          <TableHead>Отношение</TableHead>
                          <TableHead>Телефон</TableHead>
                          <TableHead>ИИН</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {student.guardians.map((g: Guardian) => (
                          <TableRow key={g.id}>
                            <TableCell className="font-medium">{g.full_name}</TableCell>
                            <TableCell>{g.relation}</TableCell>
                            <TableCell>{g.phone}</TableCell>
                            <TableCell className="font-mono text-sm">
                              {revealedIins[g.id] ?? g.iin_masked ?? '***'}
                            </TableCell>
                            <TableCell>
                              {!revealedIins[g.id] && hasRole('admin', 'mzk_manager') && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRevealConfirm(g.id)}
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  Раскрыть
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-p-muted">Опекуны не добавлены</p>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 3. Contract */}
        {canAccess('finances') && contract && (
          <AccordionItem value="contract" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              Договор
            </AccordionTrigger>
            <AccordionContent>
              <EditableInfoRow label="Дата подписания" display={formatDate(contract.signed_date)}
                editValue={contract.signed_date ? String(contract.signed_date).slice(0, 10) : ''}
                canEdit={canEditContract} type="date"
                onSave={(v) => updateContractFieldMutation.mutate({ signed_date: v || null })} />
              <EditableInfoRow label="Сумма" display={formatCurrency(contract.amount, contract.currency)}
                editValue={contract.amount ?? ''} canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ amount: v || null })} />
              <EditableInfoRow label="Валюта" display={contract.currency} canEdit={canEditContract}
                onSave={(v) => v && updateContractFieldMutation.mutate({ currency: v.toUpperCase() })} />
              <EditableInfoRow label="Статус"
                display={contract.pipeline_status ? PIPELINE_STATUS_LABELS[contract.pipeline_status] : '—'}
                editValue={contract.pipeline_status ?? ''} canEdit={canEditContract} type="select"
                options={Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                onSave={(v) => updateContractFieldMutation.mutate({ pipeline_status: v })} />
              <EditableInfoRow label="IELTS включён" display={contract.ielts_payment_included ? 'Да' : 'Нет'}
                editValue={contract.ielts_payment_included ? 'true' : 'false'} canEdit={canEditContract} type="select"
                options={[{ value: 'true', label: 'Да' }, { value: 'false', label: 'Нет' }]}
                onSave={(v) => updateContractFieldMutation.mutate({ ielts_payment_included: v === 'true' })} />
              <EditableInfoRow label="Сумма англ." display={contract.english_sum}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ english_sum: v || null })} />
              <EditableInfoRow label="Оплачено англ." display={contract.english_paid}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ english_paid: v || null })} />
              <EditableInfoRow label="Остаток клиент" display={contract.client_remaining_amount}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ client_remaining_amount: v || null })} />
              <EditableInfoRow label="Дата остатка" display={formatDate(contract.client_remaining_date)}
                editValue={contract.client_remaining_date ? String(contract.client_remaining_date).slice(0, 10) : ''}
                canEdit={canEditContract} type="date"
                onSave={(v) => updateContractFieldMutation.mutate({ client_remaining_date: v || null })} />
              <EditableInfoRow label="Ментору итого" display={contract.mentor_total_owed}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ mentor_total_owed: v || null })} />
              <EditableInfoRow label="Примечания" display={contract.notes} canEdit={canEditContract} type="textarea"
                onSave={(v) => updateContractFieldMutation.mutate({ notes: v || null })} />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 4. Finances */}
        {canAccess('finances') && contract && (
          <AccordionItem value="finances" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              Финансы
            </AccordionTrigger>
            <AccordionContent>
              {contract.payments && contract.payments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Тип</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Валюта</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Дата</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contract.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.type}</TableCell>
                        <TableCell className="font-medium">{p.amount}</TableCell>
                        <TableCell>{p.currency}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {p.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-p-muted">{formatDate(p.paid_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-p-muted py-2">Платежи не найдены</p>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 5. Applications */}
        <AccordionItem value="applications" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Заявки в вузы
          </AccordionTrigger>
          <AccordionContent>
            {student.applications && student.applications.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Страна</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Подано</TableHead>
                    <TableHead>Виза</TableHead>
                    <TableHead>Основная</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {student.applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-medium">{app.country}</TableCell>
                      <TableCell>
                        <span className="text-xs text-p-muted">
                          {SUBMISSION_STATUS_LABELS[app.submission_status]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {app.submissions_done}/{app.submissions_planned}
                      </TableCell>
                      <TableCell className="text-p-muted">{app.visa_status ?? '—'}</TableCell>
                      <TableCell>
                        {app.is_primary && <Check className="w-4 h-4 text-green-600" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-p-muted py-2">Заявки не добавлены</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 6. Services */}
        <AccordionItem value="services" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Программы / услуги
          </AccordionTrigger>
          <AccordionContent>
            {student.services && student.services.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Программа</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Ответственный</TableHead>
                    <TableHead>Дедлайн</TableHead>
                    <TableHead>Результат</TableHead>
                    <TableHead>Заметки</TableHead>
                    {canAccess('all_students') && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {student.services.map((svc) => {
                    const assignedMentor = mentors.find((m) => m.id === svc.assigned_mentor_id)
                    return (
                      <TableRow key={svc.id} className={!svc.included ? 'opacity-60' : undefined}>
                        <TableCell className="font-medium">{SERVICE_TYPE_LABELS[svc.service_type]}</TableCell>
                        <TableCell>
                          <span className={`rounded-pill border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${serviceTone(svc.status)}`}>
                            {svc.included ? SERVICE_STATUS_LABELS[svc.status] : 'Не включена'}
                          </span>
                        </TableCell>
                        <TableCell className="text-p-muted">{assignedMentor?.name || 'Не назначен'}</TableCell>
                        <TableCell className="whitespace-nowrap text-p-muted">{svc.deadline ? formatDate(svc.deadline) : '—'}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{svc.result || '—'}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-p-muted">{svc.notes || '—'}</TableCell>
                        {canAccess('all_students') && (
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => setEditService(svc)}>
                              <Edit2 className="mr-1.5 h-3 w-3" /> Править
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-p-muted py-2">Услуги не настроены</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 7. Portfolio UP */}
        <AccordionItem value="portfolio" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Portfolio UP
          </AccordionTrigger>
          <AccordionContent>
            {portfolio ? (
              <div className="space-y-3">
                <InfoRow label="Группа VPP" value={portfolio.vpp_group} />
                <InfoRow label="Статус" value={portfolio.status} />
                <InfoRow label="Дедлайн" value={portfolio.deadline_text} />
                <InfoRow label="Первый звонок" value={portfolio.first_call_milestone} />
                {portfolio.special_notes && (
                  <InfoRow label="Особые заметки" value={portfolio.special_notes} />
                )}
                <div className="flex items-center gap-4 py-2 border-b border-p-line">
                  <span className="text-sm text-p-muted w-48 shrink-0">Достижения</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          achievements_count: Math.max(0, portfolio.achievements_count - 1),
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="font-semibold text-lg w-8 text-center">
                      {portfolio.achievements_count}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          achievements_count: portfolio.achievements_count + 1,
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-4 py-2 border-b border-p-line">
                  <span className="text-sm text-p-muted w-48 shrink-0">Звонки</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          calls_count: Math.max(0, portfolio.calls_count - 1),
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="font-semibold text-lg w-8 text-center">
                      {portfolio.calls_count}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          calls_count: portfolio.calls_count + 1,
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {portfolio.focus_areas && portfolio.focus_areas.length > 0 && (
                  <div className="py-2">
                    <span className="text-sm text-p-muted block mb-2">Направления</span>
                    <div className="flex flex-wrap gap-2">
                      {portfolio.focus_areas.map((area, i) => (
                        <span key={i} className="px-3 py-1 bg-sky-50 text-sky-700 border border-sky-200 text-xs rounded-pill">
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-p-muted py-2">Portfolio UP не настроено</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 8. Documents */}
        <AccordionItem value="documents" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Документы
          </AccordionTrigger>
          <AccordionContent>
            {student.documents && student.documents.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {student.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="border border-p-line rounded-panel p-3 bg-p-bg flex flex-col gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-p-text truncate">{doc.file_name}</p>
                      <p className="text-xs text-p-muted mt-1">
                        {DOC_TYPE_LABELS[doc.doc_type as keyof typeof DOC_TYPE_LABELS] ?? doc.doc_type}
                        {' · '}
                        {formatFileSize(doc.file_size)}
                        {' · '}
                        {doc.source}
                      </p>
                      {doc.is_verified && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 mt-2">
                          <Check className="w-3 h-3" />
                          Проверен
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => handleOpenDocument(doc)}
                        disabled={documentOpenId === doc.id}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        {documentOpenId === doc.id ? 'Открытие…' : 'Открыть'}
                      </Button>
                      {hasRole('admin', 'mzk_manager', 'mentor') && (
                        <DocVisibilityToggle
                          docId={doc.id}
                          visible={!!doc.visible_to_student}
                          studentId={id!}
                        />
                      )}
                      {hasRole('admin', 'mzk_manager') && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          onClick={() => setDocumentDeleteTarget(doc)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-p-muted py-2">Документы не загружены</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 9b. Telegram */}
        {hasRole('admin', 'mzk_manager') && (
          <AccordionItem value="telegram" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              <span className="flex items-center gap-2.5">
                Telegram
                {telegramChat && telegramChat.status !== 'closed' ? (
                  <span className="text-2xs px-1.5 py-0.5 rounded-pill font-medium uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {telegramChat.status === 'active' ? 'подключён' : 'на паузе'}
                  </span>
                ) : (
                  <span className="text-2xs px-1.5 py-0.5 rounded-pill font-medium uppercase tracking-wide bg-p-bg text-p-muted border border-p-line">
                    не привязан
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-5">
                <TelegramGroupManager
                  studentId={student.id}
                  studentName={student.full_name}
                  chat={telegramChat && telegramChat.status !== 'closed' ? telegramChat : null}
                  variant="crm"
                />
                {telegramChat && telegramChat.status !== 'closed' && (
                  <div className="space-y-2 border-t border-p-line pt-4">
                    <div className="flex items-center justify-between text-xs text-p-muted">
                      <span>Последние сообщения: {telegramMessages.length}</span>
                      <Link to={`/telegram-inbox/${telegramChat.id}`} className="text-p-text hover:text-black underline underline-offset-4">
                        Вся переписка и AI-разбор
                      </Link>
                    </div>
                    {telegramMessages.length > 0 ? telegramMessages.slice(-5).map((message) => (
                      <div key={message.id} className="rounded-panel border border-p-line bg-white p-2 text-sm">
                        <p className="mb-0.5 text-xs text-p-muted">{message.sender_name || 'Без имени'} · {formatDate(message.created_at)}</p>
                        <p className="text-p-text">{message.raw_text || `[${message.message_type}]`}</p>
                      </div>
                    )) : <p className="text-sm text-p-muted">Сообщений пока нет. После проверки готовности новые сообщения появятся здесь.</p>}
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 10. Notes */}
        <AccordionItem value="notes" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Конспекты
          </AccordionTrigger>
          <AccordionContent>
            {student.notes && student.notes.length > 0 ? (
              <div className="space-y-3">
                {student.notes.map((note) => (
                  <div key={note.id} className="border border-p-line rounded-panel p-3 bg-p-bg/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/notes/${note.id}`}
                          className="font-medium text-p-text hover:text-black underline underline-offset-4"
                        >
                          {note.title}
                        </Link>
                        <p className="text-xs text-p-muted mt-1">
                          {note.status} · {formatDate(note.created_at)}
                        </p>
                      </div>
                      <Link to={`/notes/${note.id}`} className="text-xs text-p-muted hover:text-black underline underline-offset-4">
                        Открыть
                      </Link>
                    </div>
                    <p className="text-sm text-p-muted mt-2 line-clamp-3">
                      {stripMarkdown(note.summary_markdown)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-p-muted py-2">Конспектов пока нет</p>
            )}
            <div className="mt-3">
              <Button asChild variant="outline" size="sm">
                <Link to={`/notes?student_id=${student.id}&create=1`}>
                  <Plus className="w-3 h-3 mr-2" />
                  Новый конспект
                </Link>
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 11. Confidential notes */}
        {canAccess('confidential') && (
          <AccordionItem id="student-notes" value="confidential" className="scroll-mt-6 border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-orange-600" />
                Конфиденциальные заметки
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 mb-4">
                {student.confidential_notes && student.confidential_notes.map((note) => (
                  <div key={note.id} className="bg-orange-50 border border-orange-100 rounded-lg p-3">
                    <p className="text-sm text-p-text">{note.note_text}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-p-muted">
                        Видят: {note.visible_to_role} · {formatDate(note.created_at)}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={noteVisibilityMutation.isPending}
                        onClick={() => noteVisibilityMutation.mutate({ noteId: note.id, visible: !note.visible_to_student })}
                      >
                        {note.visible_to_student ? 'Скрыть от ученика' : 'Показать ученику'}
                      </Button>
                    </div>
                    {note.visible_to_student && (
                      <p className="mt-1 text-xs font-medium text-emerald-700">Видно ученику в разделе «Заметки»</p>
                    )}
                  </div>
                ))}
              </div>

              {!addingNote ? (
                <Button variant="outline" size="sm" onClick={() => setAddingNote(true)}>
                  <Plus className="w-3 h-3 mr-2" />
                  Добавить заметку
                </Button>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Конфиденциальная заметка..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Select value={noteRole} onValueChange={(v) => setNoteRole(v as NoteVisibility)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin_only">Только admin</SelectItem>
                        <SelectItem value="admin_and_mzk">Admin и MZK</SelectItem>
                        <SelectItem value="all_mentors">Все менторы</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => addNoteMutation.mutate()}
                      disabled={!newNote.trim() || addNoteMutation.isPending}
                    >
                      Сохранить
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setAddingNote(false); setNewNote('') }}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 12. Tasks */}
        <AccordionItem value="tasks" className="border border-p-line rounded-card px-4">
          <AccordionTrigger className="text-base font-semibold">
            Задачи
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 mb-3">
              {student.student_tasks && student.student_tasks.length > 0 ? (
                student.student_tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 py-2 border-b border-p-line last:border-0">
                    <Checkbox
                      checked={task.status === 'done'}
                      onCheckedChange={() => toggleTaskMutation.mutate(task)}
                      disabled={!canAccess('tasks_create')}
                    />
                    <div className="flex-1">
                      <p className={`text-sm ${task.status === 'done' ? 'line-through text-p-muted' : 'text-p-text'}`}>
                        {task.task_text}
                      </p>
                      <p className="text-xs text-p-muted mt-0.5">
                        {formatDate(task.created_at)}
                        {task.done_at && ` · Выполнено ${formatDate(task.done_at)}`}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-p-muted">Задач нет</p>
              )}
            </div>

            {canAccess('tasks_create') && (
              !addingTask ? (
                <Button variant="outline" size="sm" onClick={() => setAddingTask(true)}>
                  <Plus className="w-3 h-3 mr-2" />
                  Добавить задачу
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Текст задачи..."
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTaskText.trim() && !addTaskMutation.isPending) {
                        addTaskMutation.mutate(newTaskText)
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={() => addTaskMutation.mutate(newTaskText)}
                    disabled={!newTaskText.trim() || addTaskMutation.isPending}
                  >
                    Добавить
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setAddingTask(false); setNewTaskText('') }}>
                    Отмена
                  </Button>
                </div>
              )
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 12. Unified timeline */}
        {hasRole('admin', 'mzk_manager', 'mentor') && (
          <AccordionItem value="timeline" className="border border-p-line rounded-card px-4">
            <AccordionTrigger className="text-base font-semibold">
              <span className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-p-muted" />
                Единая история работы
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {timelineData && (
                <div className="mb-3 text-xs text-p-muted">
                  Показано {timeline.length} из {timelineData.total} событий
                </div>
              )}
              {timeline.length > 0 ? (
                <div className="space-y-2">
                  {timeline.map((item) => {
                    const content = (
                      <div className="border-l-2 border-p-line pl-3 py-1 transition hover:border-gray-400">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-pill border border-p-line bg-p-bg px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-p-muted">
                            {item.kind}
                          </span>
                          <span className="text-xs text-p-muted">{formatDate(item.at)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm font-medium text-p-text">{item.title || 'Событие'}</p>
                        {item.text && <p className="mt-0.5 line-clamp-2 text-xs text-p-muted">{item.text}</p>}
                      </div>
                    )
                    return item.href?.startsWith('/') ? (
                      <Link key={item.id} to={item.href} className="block">{content}</Link>
                    ) : item.href ? (
                      <a key={item.id} href={item.href} className="block">{content}</a>
                    ) : (
                      <div key={item.id}>{content}</div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-p-muted py-2">Рабочей истории пока нет</p>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

      </Accordion>

      {/* Edit student modal */}
      {editOpen && (
        <EditStudentModal
          student={student}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* Edit service modal */}
      {editService && (
        <ServiceEditModal
          service={editService}
          open={!!editService}
          onClose={() => setEditService(null)}
          mentors={mentors}
        />
      )}

      {/* Reveal IIN confirm dialog */}
      <Dialog open={!!revealConfirm} onOpenChange={() => setRevealConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Раскрыть ИИН</DialogTitle>
            <DialogDescription>
              ИИН является персональными данными. Убедитесь в необходимости просмотра. Это действие будет записано в журнал.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => revealConfirm && revealIin(revealConfirm)}
            >
              Раскрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!documentDeleteTarget} onOpenChange={() => setDocumentDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить документ?</DialogTitle>
            <DialogDescription>
              {documentDeleteTarget?.file_name} будет удалён из карточки студента и из хранилища.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteDocument}
              disabled={documentDeletePending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unlinkNotionConfirm} onOpenChange={() => setUnlinkNotionConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отвязать запись Notion?</DialogTitle>
            <DialogDescription>
              Связь между этим студентом и записью Notion будет разорвана. Данные Notion не удаляются и их можно привязать заново.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkNotionConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (unlinkNotionConfirm) unlinkNotionMutation.mutate(unlinkNotionConfirm)
                setUnlinkNotionConfirm(null)
              }}
              disabled={unlinkNotionMutation.isPending}
            >
              Отвязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pushNotionConfirm} onOpenChange={() => setPushNotionConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Записать в Notion?</DialogTitle>
            <DialogDescription>
              Значение в Notion будет перезаписано данными из CRM. Отменить в Notion можно вручную.
            </DialogDescription>
          </DialogHeader>
          {pushNotionConfirm && (
            <div className="rounded-panel border border-p-line bg-p-panel2 px-3 py-2 text-sm">
              <p className="text-p-muted mb-1">{pushNotionConfirm.label}</p>
              <p className="text-p-text">
                <span className="text-p-muted2 line-through">{pushNotionConfirm.notion ?? '—'}</span>
                {'  →  '}
                <span className="font-medium text-emerald-700">{pushNotionConfirm.crm ?? '—'}</span>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushNotionConfirm(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (pushNotionConfirm) pushNotionFieldMutation.mutate({ field: pushNotionConfirm.field })
              }}
              disabled={pushNotionFieldMutation.isPending}
            >
              Записать в Notion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Предложение записать поле договора в Notion после правки в CRM */}
      <Dialog open={!!pendingNotionPush} onOpenChange={() => setPendingNotionPush(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Записать также в Notion?</DialogTitle>
            <DialogDescription>
              Вы изменили поле в CRM. Записать это значение в привязанную запись Notion?
            </DialogDescription>
          </DialogHeader>
          {pendingNotionPush && (
            <div className="rounded-panel border border-p-line bg-p-panel2 px-3 py-2 text-sm">
              <p className="text-p-muted mb-1">{pendingNotionPush.label}</p>
              {notionPushPreview.isLoading ? (
                <p className="text-p-muted2">Загрузка значения из Notion…</p>
              ) : notionPushPreview.data ? (
                <>
                  <p className="text-p-text">
                    <span className="text-p-muted2 line-through">{formatPushValue(notionPushPreview.data.notion_current)}</span>
                    {'  →  '}
                    <span className="font-medium text-emerald-700">{formatPushValue(notionPushPreview.data.will_write)}</span>
                  </p>
                  {notionPushPreview.data.conflict && (
                    <p className="mt-1 text-xs text-amber-600">
                      ⚠️ В Notion это поле меняли после последней синхронизации — запись затрёт ту правку.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-red-500 text-xs">Не удалось получить значение из Notion.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingNotionPush(null)}>
              Только в CRM
            </Button>
            <Button
              onClick={() => {
                if (pendingNotionPush) {
                  pushNotionFieldMutation.mutate({ field: pendingNotionPush.field })
                  setPendingNotionPush(null)
                }
              }}
              disabled={pushNotionFieldMutation.isPending || notionPushPreview.isLoading}
            >
              Записать в Notion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
