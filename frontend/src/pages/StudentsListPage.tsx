import React, { useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, Search, RefreshCw, Inbox, EyeOff, Eye, CheckCheck, Filter, X } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { mentorAssignmentsApi, usersApi } from '@/api/index'
import { syncApi, IntakeSubmission } from '@/api/sync'
import { notionApi, NotionSnapshotItem } from '@/api/notion'
import { useAuth } from '@/contexts/AuthContext'
import {
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  SERVICE_TYPE_LABELS,
  SERVICE_STATUS_LABELS,
  ServiceType,
} from '@/types'
import { Button } from '@/components/ui/button'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { downloadBlob } from '@/lib/utils'
import { debounce } from '@/lib/utils'
import { fuzzyStudentMatch } from '@/lib/fuzzyName'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

const SOURCE_LABELS: Record<string, string> = {
  package: 'Пакет (менеджер)',
  cases: 'Кейс (студент)',
}

type ResponsibleRoleFilter = 'any' | 'mzk_manager' | 'lead_mentor' | 'mentor'
type OperationalFilter = 'all' | 'no_roadmap' | 'no_meeting' | 'telegram_unlinked' | 'open_tasks' | 'docs_review'
const SERVICE_FILTER_OPTIONS: ServiceType[] = [
  'proforientation',
  'ielts_mock',
  'ielts_prep',
  'sat_prep',
  'portfolio_improvement',
  'english_general',
]

/** Диалог привязки входящей анкеты к студенту */
function LinkDialog({
  submission,
  onClose,
}: {
  submission: IntakeSubmission
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(submission.suggested_student_id ?? '')

  const { data: allStudents = [] } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = q ? allStudents.filter((s) => fuzzyStudentMatch(q, s.full_name, s.phone)) : allStudents
    // Предложенный кандидат — всегда первым в списке
    const suggested = submission.suggested_student_id
      ? allStudents.find((s) => s.id === submission.suggested_student_id)
      : undefined
    const rest = suggested ? base.filter((s) => s.id !== suggested.id) : base
    return (suggested ? [suggested, ...rest] : rest).slice(0, 30)
  }, [allStudents, query, submission.suggested_student_id])

  const linkMutation = useMutation({
    mutationFn: () => syncApi.link(submission.id, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      toast({ title: 'Анкета привязана' })
      onClose()
    },
    onError: (err) => toast({ title: 'Ошибка привязки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать анкету</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-p-muted">
            {SOURCE_LABELS[submission.source]} · <span className="text-p-text">{submission.full_name}</span>
          </p>
          {submission.suggested_student_name && (
            <p className="text-xs text-emerald-700">
              Предложение: {submission.suggested_student_name}
              {submission.suggested_confidence != null &&
                ` (${Math.round(submission.suggested_confidence * 100)}%)`}
            </p>
          )}
          <Input
            placeholder="Поиск студента..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-[2px] divide-y divide-gray-100">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-black text-white'
                    : 'text-p-text hover:bg-p-bg'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-p-muted text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-p-muted">Не найдено</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!selectedId || linkMutation.isPending}
          >
            {linkMutation.isPending ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Панель входящих анкет (status=new) */
function IntakeInbox() {
  const qc = useQueryClient()
  const [linkTarget, setLinkTarget] = useState<IntakeSubmission | null>(null)
  const [ignoreTarget, setIgnoreTarget] = useState<IntakeSubmission | null>(null)
  const [intakeView, setIntakeView] = useState<'new' | 'hidden' | 'all'>('new')
  const [confirmLinkAll, setConfirmLinkAll] = useState(false)
  const [confirmCreateAll, setConfirmCreateAll] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['intake', 'inbox', intakeView],
    queryFn: () =>
      syncApi.submissions({
        status: intakeView === 'hidden' ? 'ignored' : intakeView === 'all' ? 'all' : 'new',
        size: 100,
      }),
  })

  const bulkLinkMutation = useMutation({
    mutationFn: () => syncApi.linkAll({ status: 'new' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      setConfirmLinkAll(false)
      toast({
        title: 'Совпадения привязаны',
        description: `Привязано: ${res.linked}${res.skipped ? ` · пропущено: ${res.skipped}` : ''}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось привязать все совпадения', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => syncApi.ignore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      setIgnoreTarget(null)
      toast({ title: 'Анкета скрыта' })
    },
    onError: (err) => toast({ title: 'Не удалось скрыть анкету', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const createMutation = useMutation({
    mutationFn: (id: string) => syncApi.createStudent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Студент создан из анкеты' })
    },
    onError: (err: unknown) => {
      toast({ title: 'Студент не создан', description: getErrorMessage(err, 'Ошибка создания'), variant: 'destructive' })
      qc.invalidateQueries({ queryKey: ['intake'] })
    },
  })

  const createMissingMutation = useMutation({
    mutationFn: () => syncApi.createMissing(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      setConfirmCreateAll(false)
      toast({
        title: 'Студенты созданы',
        description: `Создано: ${res.created}${res.skipped ? ` · пропущено (нашёлся похожий студент): ${res.skipped}` : ''}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось создать студентов', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const items = data?.items ?? []
  const linkableCount = items.filter((item) => item.status === 'new' && item.suggested_student_id).length
  const creatableCount = items.filter((item) => item.status === 'new' && !item.suggested_student_id).length

  return (
    <div className="border border-p-line rounded-[2px]">
      <div className="px-4 py-3 border-b border-p-line flex items-center justify-between gap-3 flex-wrap">
        <p className="label-caps">Входящие анкеты · {data?.total ?? 0}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[2px] border border-p-line bg-p-bg p-1">
            {[
              { value: 'new', label: 'Новые' },
              { value: 'hidden', label: 'Скрытые' },
              { value: 'all', label: 'Все' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setIntakeView(item.value as typeof intakeView)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-[2px] transition-colors ${
                  intakeView === item.value
                    ? 'bg-white text-black'
                    : 'text-p-muted hover:text-black hover:bg-p-bg'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmLinkAll(true)}
            disabled={bulkLinkMutation.isPending || linkableCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Привязать все{linkableCount ? ` · ${linkableCount}` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmCreateAll(true)}
            disabled={createMissingMutation.isPending || creatableCount === 0}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Создать всех{creatableCount ? ` · ${creatableCount}` : ''}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-p-muted text-sm">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-p-muted text-sm">
          {intakeView === 'hidden' ? 'Скрытых анкет нет' : 'Все анкеты обработаны'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Форма</TableHead>
              <TableHead>ФИО из анкеты</TableHead>
              <TableHead>Менеджер</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Кандидат</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((sub) => (
              <TableRow key={sub.id} className="border-p-line hover:bg-p-bg">
                <TableCell>
                  <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${
                    sub.source === 'package'
                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                      : 'bg-violet-50 text-violet-700 border border-violet-200'
                  }`}>
                    {sub.source === 'package' ? 'Пакет' : 'Кейс'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-p-text font-medium">{sub.full_name}</TableCell>
                <TableCell className="text-sm text-p-muted">{sub.manager_name ?? '—'}</TableCell>
                <TableCell className="text-xs text-p-muted">
                  {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('ru-RU') : '—'}
                </TableCell>
                <TableCell className="text-sm">
                  {sub.suggested_student_name ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {sub.suggested_student_name}
                      {sub.suggested_confidence != null && (
                        <span className="text-p-muted text-xs ml-1">
                          {Math.round(sub.suggested_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-p-muted2">нет</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setLinkTarget(sub)}>
                      Привязать
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      disabled={createMutation.isPending}
                      onClick={() => createMutation.mutate(sub.id)}>
                      Создать
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-p-muted"
                      disabled={ignoreMutation.isPending}
                      onClick={() => setIgnoreTarget(sub)}>
                      <EyeOff className="w-3.5 h-3.5 mr-1" />
                      Скрыть
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={!!ignoreTarget} onOpenChange={(open) => !open && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Скрыть анкету?</DialogTitle>
            <DialogDescription>
              Анкета {ignoreTarget?.full_name ?? 'выбранного студента'} будет перемещена в скрытые и останется доступной через фильтр.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => ignoreMutation.mutate(ignoreTarget?.id ?? '')}
              disabled={!ignoreTarget || ignoreMutation.isPending}
            >
              Скрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmLinkAll} onOpenChange={(open) => !open && setConfirmLinkAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязать найденные совпадения?</DialogTitle>
            <DialogDescription>
              Будет привязано до {linkableCount} новых анкет к предложенным студентам. Анкеты без кандидата не будут затронуты.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Если кандидат выбран неверно, откройте анкету и привяжите её вручную.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLinkAll(false)}>Отмена</Button>
            <Button onClick={() => bulkLinkMutation.mutate()} disabled={bulkLinkMutation.isPending}>
              {bulkLinkMutation.isPending ? 'Привязываем…' : `Привязать · ${linkableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCreateAll} onOpenChange={(open) => !open && setConfirmCreateAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Создать студентов из анкет?</DialogTitle>
            <DialogDescription>
              Будет создано {creatableCount} студентов из новых анкет без кандидата на привязку.
              Анкеты с кандидатом останутся на ручное решение. Суммы и договорённости
              не переносятся — их менеджер вносит вручную.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            С кандидатом на привязку: {linkableCount}. Эти анкеты не будут созданы как новые студенты, чтобы не плодить дубли.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreateAll(false)}>Отмена</Button>
            <Button
              onClick={() => createMissingMutation.mutate()}
              disabled={createMissingMutation.isPending}
            >
              {createMissingMutation.isPending ? 'Создаём…' : `Создать · ${creatableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {linkTarget && <LinkDialog submission={linkTarget} onClose={() => setLinkTarget(null)} />}
    </div>
  )
}

/** Диалог привязки Notion-записи к студенту */
function NotionLinkDialog({
  snapshot,
  onClose,
}: {
  snapshot: NotionSnapshotItem
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(snapshot.suggested_student_id ?? '')

  const { data: allStudents = [] } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = q ? allStudents.filter((s) => fuzzyStudentMatch(q, s.full_name, s.phone)) : allStudents
    // Предложенный кандидат — всегда первым в списке
    const suggested = snapshot.suggested_student_id
      ? allStudents.find((s) => s.id === snapshot.suggested_student_id)
      : undefined
    const rest = suggested ? base.filter((s) => s.id !== suggested.id) : base
    return (suggested ? [suggested, ...rest] : rest).slice(0, 30)
  }, [allStudents, query, snapshot.suggested_student_id])

  const linkMutation = useMutation({
    mutationFn: () => notionApi.link(snapshot.id, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      toast({ title: 'Запись Notion привязана' })
      onClose()
    },
    onError: (err) => toast({ title: 'Ошибка привязки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать запись Notion</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-p-muted">
            Notion · <span className="text-p-text">{snapshot.full_name}</span>
          </p>
          {snapshot.suggested_student_name && (
            <p className="text-xs text-emerald-700">
              Предложение: {snapshot.suggested_student_name}
              {snapshot.suggested_confidence != null &&
                ` (${Math.round(snapshot.suggested_confidence * 100)}%)`}
            </p>
          )}
          <Input
            placeholder="Поиск студента..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-[2px] divide-y divide-gray-100">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-black text-white'
                    : 'text-p-text hover:bg-p-bg'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-p-muted text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-p-muted">Не найдено</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!selectedId || linkMutation.isPending}
          >
            {linkMutation.isPending ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Панель непривязанных записей Notion (status=new) */
function NotionInbox() {
  const qc = useQueryClient()
  const [linkTarget, setLinkTarget] = useState<NotionSnapshotItem | null>(null)
  const [view, setView] = useState<'new' | 'ignored' | 'all'>('new')
  const [confirmLinkAll, setConfirmLinkAll] = useState(false)
  const [confirmCreateAll, setConfirmCreateAll] = useState(false)
  const [ignoreTarget, setIgnoreTarget] = useState<NotionSnapshotItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['notion', 'inbox', view],
    queryFn: () => notionApi.snapshots(view),
  })

  const createMutation = useMutation({
    mutationFn: (id: string) => notionApi.createStudent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Студент создан из Notion' })
    },
    onError: (err: unknown) => {
      toast({ title: 'Студент не создан', description: getErrorMessage(err, 'Ошибка создания'), variant: 'destructive' })
      qc.invalidateQueries({ queryKey: ['notion'] })
    },
  })

  const createMissingMutation = useMutation({
    mutationFn: () => notionApi.createMissing(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      setConfirmCreateAll(false)
      toast({
        title: 'Студенты созданы',
        description: `Создано: ${res.created}${res.skipped ? ` · пропущено (нашёлся похожий студент): ${res.skipped}` : ''}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось создать студентов', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const bulkLinkMutation = useMutation({
    mutationFn: () => notionApi.linkAll(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      setConfirmLinkAll(false)
      toast({ title: 'Совпадения привязаны', description: `Привязано: ${res.linked}` })
    },
    onError: (err) => toast({ title: 'Не удалось привязать совпадения', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => notionApi.ignore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      setIgnoreTarget(null)
      toast({ title: 'Запись скрыта' })
    },
    onError: (err) => toast({ title: 'Не удалось скрыть запись', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const items = data?.items ?? []
  const linkableCount = items.filter((item) => item.status === 'new' && item.suggested_student_id).length
  const creatableCount = items.filter((item) => item.status === 'new' && !item.suggested_student_id).length

  return (
    <div className="border border-p-line rounded-[2px]">
      <div className="px-4 py-3 border-b border-p-line flex items-center justify-between gap-3 flex-wrap">
        <p className="label-caps">Notion без привязки · {data?.total ?? 0}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[2px] border border-p-line bg-p-bg p-1">
            {[
              { value: 'new', label: 'Новые' },
              { value: 'ignored', label: 'Скрытые' },
              { value: 'all', label: 'Все' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setView(item.value as typeof view)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-[2px] transition-colors ${
                  view === item.value
                    ? 'bg-white text-black'
                    : 'text-p-muted hover:text-black hover:bg-p-bg'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmLinkAll(true)}
            disabled={bulkLinkMutation.isPending || linkableCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Привязать все{linkableCount ? ` · ${linkableCount}` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmCreateAll(true)}
            disabled={createMissingMutation.isPending || creatableCount === 0}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Создать всех{creatableCount ? ` · ${creatableCount}` : ''}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-p-muted text-sm">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-p-muted text-sm">
          {view === 'ignored' ? 'Скрытых записей нет' : 'Все записи Notion привязаны'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>ФИО в Notion</TableHead>
              <TableHead>Статус выплат</TableHead>
              <TableHead>Intake</TableHead>
              <TableHead>Кандидат</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((snap) => (
              <TableRow key={snap.id} className="border-p-line hover:bg-p-bg">
                <TableCell className="text-sm text-p-text font-medium">
                  {snap.notion_url ? (
                    <a href={snap.notion_url} target="_blank" rel="noreferrer" className="hover:underline">
                      {snap.full_name}
                    </a>
                  ) : (
                    snap.full_name
                  )}
                </TableCell>
                <TableCell className="text-sm text-p-muted">{snap.payment_status ?? '—'}</TableCell>
                <TableCell className="text-sm text-p-muted">{snap.intake ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {snap.suggested_student_name ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {snap.suggested_student_name}
                      {snap.suggested_confidence != null && (
                        <span className="text-p-muted text-xs ml-1">
                          {Math.round(snap.suggested_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-p-muted2">нет</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setLinkTarget(snap)}>
                      Привязать
                    </Button>
                    {snap.status === 'new' && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs"
                          disabled={createMutation.isPending}
                          onClick={() => createMutation.mutate(snap.id)}>
                          Создать
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-p-muted"
                          disabled={ignoreMutation.isPending}
                          onClick={() => setIgnoreTarget(snap)}>
                          <EyeOff className="w-3.5 h-3.5 mr-1" />
                          Скрыть
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={!!ignoreTarget} onOpenChange={(open) => !open && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Скрыть запись Notion?</DialogTitle>
            <DialogDescription>
              Запись {ignoreTarget?.full_name ?? 'выбранного студента'} будет перемещена в скрытые и останется доступной через фильтр.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => ignoreTarget && ignoreMutation.mutate(ignoreTarget.id)}
              disabled={!ignoreTarget || ignoreMutation.isPending}
            >
              Скрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmLinkAll} onOpenChange={(open) => !open && setConfirmLinkAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязать совпадения из Notion?</DialogTitle>
            <DialogDescription>
              Будет привязано до {linkableCount} записей Notion к предложенным студентам. Записи без кандидата не будут затронуты.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Если кандидат выбран неверно, откройте запись и привяжите её вручную.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLinkAll(false)}>Отмена</Button>
            <Button onClick={() => bulkLinkMutation.mutate()} disabled={bulkLinkMutation.isPending}>
              {bulkLinkMutation.isPending ? 'Привязываем…' : `Привязать · ${linkableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCreateAll} onOpenChange={(open) => !open && setConfirmCreateAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Создать студентов из Notion?</DialogTitle>
            <DialogDescription>
              Будет создано {creatableCount} студентов с договором и странами из Notion —
              только записи без кандидата на привязку. Записи с кандидатом останутся на ручное решение.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            С кандидатом на привязку: {linkableCount}. Эти записи останутся в списке для ручной проверки.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreateAll(false)}>Отмена</Button>
            <Button
              onClick={() => createMissingMutation.mutate()}
              disabled={createMissingMutation.isPending}
            >
              {createMissingMutation.isPending ? 'Создаём…' : `Создать · ${creatableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {linkTarget && <NotionLinkDialog snapshot={linkTarget} onClose={() => setLinkTarget(null)} />}
    </div>
  )
}

export const StudentsListPage: React.FC = () => {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { canAccess, hasRole } = useAuth()
  const isManager = hasRole('admin', 'mzk_manager')
  const canRunSync = isManager
  const [searchParams, setSearchParams] = useSearchParams()
  const initialScope = searchParams.get('scope')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [scope, setScope] = useState<'all' | 'mine' | 'assigned' | 'unassigned'>(
    initialScope === 'mine' || initialScope === 'assigned' || initialScope === 'unassigned' ? initialScope : 'all'
  )
  const [mentorFilter, setMentorFilter] = useState('')
  const [leadMentorFilter, setLeadMentorFilter] = useState('')
  const [mzkManagerFilter, setMzkManagerFilter] = useState('')
  const [responsibleRole, setResponsibleRole] = useState<ResponsibleRoleFilter>('any')
  const [intakeYearFilter, setIntakeYearFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [degreeFilter, setDegreeFilter] = useState('')
  const [serviceTypeFilter, setServiceTypeFilter] = useState('')
  const [operationalFilter, setOperationalFilter] = useState<OperationalFilter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [responsibleSearch, setResponsibleSearch] = useState('')
  const showInbox = searchParams.get('inbox') === '1'
  const showNotion = searchParams.get('notion') === '1'

  const { data: mentorUsers = [] } = useQuery({
    queryKey: ['users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: leadMentorUsers = [] } = useQuery({
    queryKey: ['users', 'lead_mentor_as_mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: mzkUsers = [] } = useQuery({
    queryKey: ['users', 'mzk_manager'],
    queryFn: () => usersApi.list({ role: 'mzk_manager' }),
  })

  // Реальные значения из базы со счётчиками — опции фильтров строятся из данных
  const { data: facets } = useQuery({
    queryKey: ['students', 'facets'],
    queryFn: studentsApi.facets,
  })

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 300),
    []
  )

  const setShowInbox = (next: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('inbox', '1')
    else params.delete('inbox')
    setSearchParams(params, { replace: true })
  }

  const setShowNotion = (next: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('notion', '1')
    else params.delete('notion')
    setSearchParams(params, { replace: true })
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    debouncedSetSearch(e.target.value)
  }

  // Список загружается целиком, поиск — на клиенте: терпит пробелы,
  // опечатки и кириллицу↔латиницу (см. fuzzyStudentMatch)
  const { data, isLoading } = useQuery({
    queryKey: [
      'students',
      statusFilter,
      scope,
      mentorFilter,
      leadMentorFilter,
      mzkManagerFilter,
      intakeYearFilter,
      countryFilter,
      degreeFilter,
      serviceTypeFilter,
    ],
    queryFn: () =>
      studentsApi.list({
        pipeline_status: (statusFilter as PipelineStatus) || undefined,
        scope,
        mentor_id: mentorFilter || undefined,
        lead_mentor_id: leadMentorFilter || undefined,
        mzk_manager_id: mzkManagerFilter || undefined,
        intake_year: intakeYearFilter ? Number.parseInt(intakeYearFilter, 10) : undefined,
        country: countryFilter.trim() || undefined,
        degree_level: degreeFilter || undefined,
        service_type: serviceTypeFilter || undefined,
        page: 1,
        size: 2000,
      }),
  })

  const assignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Вы стали ответственным', description: 'Студент появится в фильтре «Мои».' })
    },
    onError: (err) => toast({ title: 'Не удалось стать ответственным', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const unassignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.setSelfActive(studentId, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Вы больше не ответственный', description: 'Студент скрыт из фильтра «Мои».' })
    },
    onError: (err) => toast({ title: 'Не удалось снять ответственность', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const { data: syncStatus } = useQuery({
    queryKey: ['intake', 'status'],
    queryFn: syncApi.status,
    enabled: isManager,
    refetchInterval: 60_000,
  })

  const { data: intakeOverview = {} } = useQuery({
    queryKey: ['intake', 'overview'],
    queryFn: syncApi.overview,
    enabled: isManager,
  })

  const { data: notionStatus } = useQuery({
    queryKey: ['notion', 'status'],
    queryFn: notionApi.status,
    enabled: isManager,
    refetchInterval: 60_000,
  })

  const notionSyncMutation = useMutation({
    mutationFn: notionApi.run,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      const c = res.counters
      toast({
        title: 'Notion синхронизирован',
        description: `Записей: ${c.total} · новых: ${c.created} · автопривязано: ${c.auto_linked}${c.needs_review ? ` · требуют привязки: ${c.needs_review}` : ''}`,
      })
    },
    onError: (err: unknown) => {
      toast({ title: 'Синк Notion не выполнен', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const syncMutation = useMutation({
    mutationFn: syncApi.run,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      const parts = Object.entries(res.counters).map(
        ([src, c]) => `${src === 'package' ? 'Пакет' : 'Кейсы'}: +${c.new}`
      )
      toast({ title: 'Синхронизация завершена', description: parts.join(' · ') })
    },
    onError: (err: unknown) => {
      toast({ title: 'Синк не выполнен', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const allStudents = useMemo(() => data?.items ?? [], [data?.items])
  const students = useMemo(() => {
    const searched = debouncedSearch.trim()
      ? allStudents.filter((s) => fuzzyStudentMatch(debouncedSearch, s.full_name, s.phone))
      : allStudents
    return searched.filter((s) => {
      switch (operationalFilter) {
        case 'no_roadmap':
          return !s.roadmap?.id
        case 'no_meeting':
          return !s.next_meeting
        case 'telegram_unlinked':
          return !s.telegram?.linked
        case 'open_tasks':
          return (s.open_tasks_count ?? 0) > 0
        case 'docs_review':
          return (s.documents_unverified ?? 0) > 0
        default:
          return true
      }
    })
  }, [allStudents, debouncedSearch, operationalFilter])
  const total = students.length
  const newCount = syncStatus?.new_submissions ?? 0
  const activeFiltersCount =
    (scope !== 'all' ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (mentorFilter ? 1 : 0) +
    (leadMentorFilter ? 1 : 0) +
    (mzkManagerFilter ? 1 : 0) +
    (intakeYearFilter ? 1 : 0) +
    (countryFilter.trim() ? 1 : 0) +
    (degreeFilter ? 1 : 0) +
    (serviceTypeFilter ? 1 : 0) +
    (operationalFilter !== 'all' ? 1 : 0)

  const resetFilters = () => {
    setScope('all')
    setMentorFilter('')
    setLeadMentorFilter('')
    setMzkManagerFilter('')
    setResponsibleRole('any')
    setIntakeYearFilter('')
    setCountryFilter('')
    setDegreeFilter('')
    setServiceTypeFilter('')
    setOperationalFilter('all')
    setStatusFilter('')
    setResponsibleSearch('')
  }

  const allUsers = [...mzkUsers, ...leadMentorUsers, ...mentorUsers]
  const responsibleName = (id: string) => allUsers.find((u) => u.id === id)?.name ?? id

  // Чипы активных фильтров — видны без открытия панели, снимаются крестиком
  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = []
  if (scope !== 'all')
    activeFilterChips.push({
      key: 'scope',
      label: scope === 'mine' ? 'Только мои' : scope === 'assigned' ? 'С ответственными' : 'Без ответственного',
      onRemove: () => setScope('all'),
    })
  if (statusFilter)
    activeFilterChips.push({
      key: 'status',
      label: `Статус: ${PIPELINE_STATUS_LABELS[statusFilter as PipelineStatus] ?? statusFilter}`,
      onRemove: () => setStatusFilter(''),
    })
  if (intakeYearFilter)
    activeFilterChips.push({
      key: 'year',
      label: `Год: ${intakeYearFilter}`,
      onRemove: () => setIntakeYearFilter(''),
    })
  if (degreeFilter)
    activeFilterChips.push({
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[degreeFilter as keyof typeof DEGREE_LEVEL_LABELS] ?? degreeFilter}`,
      onRemove: () => setDegreeFilter(''),
    })
  if (serviceTypeFilter)
    activeFilterChips.push({
      key: 'service',
      label: `Программа: ${SERVICE_TYPE_LABELS[serviceTypeFilter as ServiceType] ?? serviceTypeFilter}`,
      onRemove: () => setServiceTypeFilter(''),
    })
  if (countryFilter.trim())
    activeFilterChips.push({
      key: 'country',
      label: `Страна: ${countryFilter}`,
      onRemove: () => setCountryFilter(''),
    })
  const clearResponsible = () => {
    setResponsibleRole('any')
    setMzkManagerFilter('')
    setLeadMentorFilter('')
    setMentorFilter('')
  }
  if (mzkManagerFilter)
    activeFilterChips.push({
      key: 'mzk',
      label: `МЗК: ${responsibleName(mzkManagerFilter)}`,
      onRemove: clearResponsible,
    })
  if (leadMentorFilter)
    activeFilterChips.push({
      key: 'lead',
      label: `Lead: ${responsibleName(leadMentorFilter)}`,
      onRemove: clearResponsible,
    })
  if (mentorFilter)
    activeFilterChips.push({
      key: 'mentor',
      label: `Ментор: ${responsibleName(mentorFilter)}`,
      onRemove: clearResponsible,
    })
  if (operationalFilter !== 'all') {
    const labels: Record<OperationalFilter, string> = {
      all: 'Все',
      no_roadmap: 'Нет roadmap',
      no_meeting: 'Нет встречи',
      telegram_unlinked: 'Нет Telegram',
      open_tasks: 'Есть задачи',
      docs_review: 'Документы на проверке',
    }
    activeFilterChips.push({
      key: 'operational',
      label: labels[operationalFilter],
      onRemove: () => setOperationalFilter('all'),
    })
  }

  const currentResponsibleUsers =
    responsibleRole === 'mzk_manager'
      ? mzkUsers
      : responsibleRole === 'lead_mentor'
        ? leadMentorUsers
        : responsibleRole === 'mentor'
          ? mentorUsers
          : []

  const selectedResponsibleId =
    responsibleRole === 'mzk_manager'
      ? mzkManagerFilter
      : responsibleRole === 'lead_mentor'
        ? leadMentorFilter
        : responsibleRole === 'mentor'
          ? mentorFilter
          : ''

  const setResponsibleFilter = (role: ResponsibleRoleFilter, userId = '') => {
    setResponsibleRole(role)
    setMzkManagerFilter(role === 'mzk_manager' ? userId : '')
    setLeadMentorFilter(role === 'lead_mentor' ? userId : '')
    setMentorFilter(role === 'mentor' ? userId : '')
    setResponsibleSearch('')
  }

  const handleExport = async () => {
    try {
      const blob = await studentsApi.exportAll()
      downloadBlob(blob, 'students.xlsx')
    } catch {
      alert('Ошибка экспорта')
    }
  }

  return (
    <div className="space-y-5">
      <CrmPageHeader
        eyebrow="Студенты"
        title="Общая база"
        description={`Все студенты CRM · всего: ${total}`}
        action={(
        <div className="flex items-center gap-2 flex-wrap">
          {isManager && (
            <>
              {canRunSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  title={syncStatus?.configured === false ? 'Google Sheets не настроен' : 'Забрать новые анкеты из Google Sheets'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  Синхронизировать
                </Button>
              )}
              <Button
                variant={showInbox ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowInbox(!showInbox)}
              >
                <Inbox className="w-3.5 h-3.5 mr-1.5" />
                {showInbox ? 'Все студенты' : 'Входящие'}{newCount > 0 && !showInbox ? ` · ${newCount}` : ''}
              </Button>
              {canRunSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => notionSyncMutation.mutate()}
                  disabled={notionSyncMutation.isPending}
                  title={notionStatus?.configured === false ? 'Notion не настроен' : 'Обновить зеркало Notion'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${notionSyncMutation.isPending ? 'animate-spin' : ''}`} />
                  Синк Notion
                </Button>
              )}
              <Button
                variant={showNotion ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowNotion(!showNotion)}
              >
                Notion{(notionStatus?.needs_review ?? 0) > 0 && !showNotion ? ` · ${notionStatus?.needs_review}` : ''}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Экспорт
          </Button>
          {canAccess('all_students') && (
            <button
              onClick={() => navigate('/students/new')}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold uppercase tracking-caps
                         bg-black text-white rounded-[2px] hover:bg-black/85
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40
                         transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить студента
            </button>
          )}
        </div>
        )}
      />

      {/* Inbox */}
      {isManager && showInbox && <IntakeInbox />}

      {/* Notion без привязки */}
      {isManager && showNotion && <NotionInbox />}

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск студентов..."
            value={search}
            onChange={handleSearchChange}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="relative">
          <Button
            type="button"
            variant={activeFiltersCount > 0 ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setFiltersOpen((next) => !next)}
          >
            <Filter className="w-3.5 h-3.5" />
            Фильтры
            {activeFiltersCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-white/15 text-[11px] font-semibold">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          {filtersOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 max-w-[calc(100vw-2rem)] rounded-[2px] border border-p-line bg-white shadow-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-p-line bg-p-bg">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Фильтры</p>
                <button
                  type="button"
                  className="text-p-muted2 hover:text-p-text"
                  onClick={() => setFiltersOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3 space-y-4">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Видимость</p>
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
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Статус договора</p>
                  <Select
                    value={statusFilter || 'all'}
                    onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все статусы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все статусы</SelectItem>
                      {(facets?.statuses ?? []).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {PIPELINE_STATUS_LABELS[opt.value as PipelineStatus] ?? opt.value} · {opt.count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Контроль работы</p>
                  <Select
                    value={operationalFilter}
                    onValueChange={(v) => setOperationalFilter(v as OperationalFilter)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все сигналы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="no_roadmap">Нет roadmap</SelectItem>
                      <SelectItem value="no_meeting">Нет ближайшей встречи</SelectItem>
                      <SelectItem value="telegram_unlinked">Telegram не привязан</SelectItem>
                      <SelectItem value="open_tasks">Есть открытые задачи</SelectItem>
                      <SelectItem value="docs_review">Документы на проверке</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Год</p>
                    <Select
                      value={intakeYearFilter || 'all'}
                      onValueChange={(v) => setIntakeYearFilter(v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Все годы" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все годы</SelectItem>
                        {(facets?.years ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.value} · {opt.count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Ступень</p>
                    <Select
                      value={degreeFilter || 'all'}
                      onValueChange={(v) => setDegreeFilter(v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Все ступени" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все ступени</SelectItem>
                        {(facets?.degrees ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {DEGREE_LEVEL_LABELS[opt.value as keyof typeof DEGREE_LEVEL_LABELS] ?? opt.value} · {opt.count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Страна поступления</p>
                  <Select
                    value={countryFilter || 'all'}
                    onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все страны" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все страны</SelectItem>
                      {(facets?.countries ?? []).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.value} · {opt.count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Программа / услуга</p>
                  <Select
                    value={serviceTypeFilter || 'all'}
                    onValueChange={(v) => setServiceTypeFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все программы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все программы</SelectItem>
                      {SERVICE_FILTER_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {SERVICE_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Ответственный</p>
                  <Select
                    value={responsibleRole}
                    onValueChange={(v) => setResponsibleFilter(v as ResponsibleRoleFilter)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Любая роль" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Любая роль</SelectItem>
                      <SelectItem value="mzk_manager">MZK</SelectItem>
                      <SelectItem value="lead_mentor">Lead mentor / ментор</SelectItem>
                      <SelectItem value="mentor">Ментор</SelectItem>
                    </SelectContent>
                  </Select>
                  {responsibleRole !== 'any' && (
                    <div className="space-y-2">
                      <Input
                        value={responsibleSearch}
                        onChange={(e) => setResponsibleSearch(e.target.value)}
                        placeholder="Найти по имени..."
                        className="h-9 text-sm"
                      />
                      <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                        <button
                          type="button"
                          onClick={() => setResponsibleFilter(responsibleRole)}
                          className={`w-full text-left px-2 py-1.5 text-sm rounded-[2px] border transition-colors ${
                            selectedResponsibleId === ''
                              ? 'border-black bg-black text-white'
                              : 'border-p-line bg-white hover:bg-p-bg text-p-text'
                          }`}
                        >
                          Все в выбранной роли
                        </button>
                        {currentResponsibleUsers
                          .filter((user) => user.name.toLowerCase().includes(responsibleSearch.trim().toLowerCase()))
                          .map((user) => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => setResponsibleFilter(responsibleRole, user.id)}
                              className={`w-full text-left px-2 py-1.5 text-sm rounded-[2px] border transition-colors ${
                                selectedResponsibleId === user.id
                                  ? 'border-black bg-black text-white'
                                  : 'border-p-line bg-white hover:bg-p-bg text-p-text'
                              }`}
                            >
                              {user.name}
                            </button>
                          ))}
                        {currentResponsibleUsers.length === 0 && (
                          <p className="px-2 py-2 text-sm text-p-muted">Пользователей нет</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-p-muted"
                    onClick={resetFilters}
                  >
                    Сбросить
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Готово
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Активные фильтры — видны без открытия панели */}
      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-[2px] border border-p-line bg-p-bg text-p-text"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="text-p-muted2 hover:text-black transition-colors"
                aria-label={`Убрать фильтр ${chip.label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="text-[12px] text-p-muted hover:text-black underline underline-offset-4 ml-1"
          >
            Сбросить всё
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Студент</TableHead>
              <TableHead>Степень</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Программы</TableHead>
              <TableHead>Ответственные</TableHead>
              {isManager && <TableHead>Анкеты</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={isManager ? 8 : 7} className="text-center py-12 text-p-muted text-sm">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isManager ? 8 : 7} className="text-center py-12 text-p-muted text-sm">
                  Студенты не найдены
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => {
                const intake = intakeOverview[student.id]
                return (
                <TableRow key={student.id} className="border-p-line hover:bg-p-bg transition-colors">
                  <TableCell>
                    <Link
                      to={`/students/${student.id}`}
                      className="font-medium text-p-text hover:text-black hover:underline underline-offset-4 transition-colors text-sm"
                    >
                      {student.full_name}
                    </Link>
                    {student.city && (
                      <p className="text-xs text-p-muted mt-0.5">{student.city}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                      {DEGREE_LEVEL_LABELS[student.degree_level]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
                    ) : (
                      <span className="text-p-muted2 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-p-muted">{student.intake_year}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-wrap gap-1.5">
                      {(student.services_summary?.items ?? []).length > 0 ? (
                        student.services_summary!.items.slice(0, 3).map((service) => (
                          <span
                            key={service.id}
                            title={`${SERVICE_TYPE_LABELS[service.service_type]} · ${SERVICE_STATUS_LABELS[service.status]}${service.assigned_mentor_name ? ` · ${service.assigned_mentor_name}` : ''}`}
                            className={`rounded-[2px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              service.status === 'completed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : service.status === 'in_progress' || service.status === 'scheduled'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-p-line bg-p-bg text-p-muted'
                            }`}
                          >
                            {SERVICE_TYPE_LABELS[service.service_type]}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-p-muted2">—</span>
                      )}
                      {(student.services_summary?.items.length ?? 0) > 3 && (
                        <span className="rounded-[2px] border border-p-line bg-p-bg px-1.5 py-0.5 text-[10px] font-semibold text-p-muted">
                          +{(student.services_summary?.items.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {student.is_mine && (
                        <span className="w-fit text-[10px] px-1.5 py-0.5 rounded-[2px] border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium uppercase tracking-wide">
                          Мой
                        </span>
                      )}
                      <span className="text-xs text-p-muted max-w-[180px] truncate">
                        {student.responsibles?.filter((r) => r.is_active).map((r) => r.name || 'Без имени').join(', ') || '—'}
                      </span>
                    </div>
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span
                          title="Пакет сопровождения (менеджер)"
                          className={`text-[10px] w-5 h-5 flex items-center justify-center rounded-[2px] border font-semibold ${
                            intake?.has_package
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-p-line text-p-muted2'
                          }`}
                        >
                          П
                        </span>
                        <span
                          title="Кейс студента"
                          className={`text-[10px] w-5 h-5 flex items-center justify-center rounded-[2px] border font-semibold ${
                            intake?.has_cases
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-p-line text-p-muted2'
                          }`}
                        >
                          К
                        </span>
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className={`label-caps transition-colors ${
                          student.is_mine ? 'text-emerald-700 hover:text-emerald-800' : 'text-p-muted hover:text-black'
                        }`}
                        disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
                        onClick={() =>
                          student.is_mine
                            ? unassignSelfMutation.mutate(student.id)
                            : assignSelfMutation.mutate(student.id)
                        }
                      >
                        {student.is_mine ? '★ Мой' : '☆ Взять'}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-p-muted">
        {debouncedSearch.trim()
          ? `Найдено: ${students.length} из ${allStudents.length}`
          : `Всего студентов: ${students.length}`}
      </p>
    </div>
  )
}
