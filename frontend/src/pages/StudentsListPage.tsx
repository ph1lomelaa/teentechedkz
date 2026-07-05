import React, { useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, Search, RefreshCw, Inbox, EyeOff, Eye, CheckCheck } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { mentorAssignmentsApi } from '@/api/index'
import { syncApi, IntakeSubmission } from '@/api/sync'
import { useAuth } from '@/contexts/AuthContext'
import {
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
} from '@/types'
import { Button } from '@/components/ui/button'
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
import { toast } from '@/hooks/use-toast'

const SOURCE_LABELS: Record<string, string> = {
  package: 'Пакет (менеджер)',
  cases: 'Кейс (студент)',
}

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
    const q = query.trim().toLowerCase()
    if (!q) return allStudents.slice(0, 30)
    return allStudents.filter((s) => s.full_name.toLowerCase().includes(q)).slice(0, 30)
  }, [allStudents, query])

  const linkMutation = useMutation({
    mutationFn: () => syncApi.link(submission.id, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      toast({ title: 'Анкета привязана' })
      onClose()
    },
    onError: () => toast({ title: 'Ошибка привязки', variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать анкету</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {SOURCE_LABELS[submission.source]} · <span className="text-gray-900">{submission.full_name}</span>
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
          <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-[2px] divide-y divide-gray-100">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-black text-white'
                    : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-gray-500 text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-gray-500">Не найдено</p>
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
  const navigate = useNavigate()
  const [linkTarget, setLinkTarget] = useState<IntakeSubmission | null>(null)
  const [ignoreTarget, setIgnoreTarget] = useState<IntakeSubmission | null>(null)
  const [intakeView, setIntakeView] = useState<'new' | 'hidden' | 'all'>('new')

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
      toast({
        title: 'Совпадения привязаны',
        description: `Привязано: ${res.linked}${res.skipped ? ` · пропущено: ${res.skipped}` : ''}`,
      })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось привязать все совпадения', variant: 'destructive' }),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => syncApi.ignore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      setIgnoreTarget(null)
      toast({ title: 'Анкета скрыта' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось скрыть анкету', variant: 'destructive' }),
  })

  const createMutation = useMutation({
    mutationFn: (id: string) => syncApi.createStudent(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Студент создан из анкеты' })
      navigate(`/students/${res.student_id}`)
    },
    onError: () => toast({ title: 'Ошибка создания', variant: 'destructive' }),
  })

  const items = data?.items ?? []
  const linkableCount = items.filter((item) => item.status === 'new' && item.suggested_student_id).length

  return (
    <div className="border border-gray-200 rounded-[2px]">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <p className="label-caps">Входящие анкеты · {data?.total ?? 0}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[2px] border border-gray-200 bg-gray-50 p-1">
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
                    : 'text-gray-600 hover:text-black hover:bg-gray-50'
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
            onClick={() => bulkLinkMutation.mutate()}
            disabled={bulkLinkMutation.isPending || linkableCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Привязать все{linkableCount ? ` · ${linkableCount}` : ''}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-gray-500 text-sm">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-gray-500 text-sm">
          {intakeView === 'hidden' ? 'Скрытых анкет нет' : 'Все анкеты обработаны'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
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
              <TableRow key={sub.id} className="border-gray-100 hover:bg-gray-50">
                <TableCell>
                  <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${
                    sub.source === 'package'
                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                      : 'bg-violet-50 text-violet-700 border border-violet-200'
                  }`}>
                    {sub.source === 'package' ? 'Пакет' : 'Кейс'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-gray-900 font-medium">{sub.full_name}</TableCell>
                <TableCell className="text-sm text-gray-600">{sub.manager_name ?? '—'}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('ru-RU') : '—'}
                </TableCell>
                <TableCell className="text-sm">
                  {sub.suggested_student_name ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {sub.suggested_student_name}
                      {sub.suggested_confidence != null && (
                        <span className="text-gray-500 text-xs ml-1">
                          {Math.round(sub.suggested_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">нет</span>
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
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500"
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
      {linkTarget && <LinkDialog submission={linkTarget} onClose={() => setLinkTarget(null)} />}
    </div>
  )
}

export const StudentsListPage: React.FC = () => {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { canAccess, hasRole } = useAuth()
  const isManager = hasRole('admin', 'mzk_manager')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [scope, setScope] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [page, setPage] = useState(1)
  const [searchParams, setSearchParams] = useSearchParams()
  const showInbox = searchParams.get('inbox') === '1'

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    debouncedSetSearch(e.target.value)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['students', debouncedSearch, statusFilter, scope, page],
    queryFn: () =>
      studentsApi.list({
        search: debouncedSearch || undefined,
        pipeline_status: (statusFilter as PipelineStatus) || undefined,
        scope,
        page,
        size: 20,
      }),
  })

  const assignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  const unassignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.setSelfActive(studentId, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент снят с ваших' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось снять студента', variant: 'destructive' }),
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
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Синк не выполнен', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const students = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.pages ?? 1
  const newCount = syncStatus?.new_submissions ?? 0

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
      {/* Header */}
      <div className="flex items-end justify-between pb-5 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Все студенты</h1>
          <p className="label-caps mt-1.5">Всего: {total}</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <>
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
              <Button
                variant={showInbox ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowInbox(!showInbox)}
              >
                <Inbox className="w-3.5 h-3.5 mr-1.5" />
                {showInbox ? 'Все студенты' : 'Входящие'}{newCount > 0 && !showInbox ? ` · ${newCount}` : ''}
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
      </div>

      {/* Inbox */}
      {isManager && showInbox && <IntakeInbox />}

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-[2px] border border-gray-200 bg-gray-50 p-1">
          {[
            { value: 'all', label: 'Все' },
            { value: 'mine', label: 'Мои' },
            { value: 'unassigned', label: 'Без ответственного' },
          ].map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setScope(item.value as typeof scope)
                setPage(1)
              }}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-[2px] transition-colors ${
                scope === item.value
                  ? 'bg-white text-black shadow-sm'
                  : 'text-gray-600 hover:text-black hover:bg-gray-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск студентов..."
            value={search}
            onChange={handleSearchChange}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}
        >
          <SelectTrigger className="w-48 h-9 text-sm">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(PIPELINE_STATUS_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border-y border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead>Студент</TableHead>
              <TableHead>Программа</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Ответственные</TableHead>
              {isManager && <TableHead>Анкеты</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={isManager ? 7 : 6} className="text-center py-12 text-gray-500 text-sm">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isManager ? 7 : 6} className="text-center py-12 text-gray-500 text-sm">
                  Студенты не найдены
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => {
                const intake = intakeOverview[student.id]
                return (
                <TableRow key={student.id} className="border-gray-100 hover:bg-gray-50 transition-colors">
                  <TableCell>
                    <Link
                      to={`/students/${student.id}`}
                      className="font-medium text-gray-900 hover:text-black hover:underline underline-offset-4 transition-colors text-sm"
                    >
                      {student.full_name}
                    </Link>
                    {student.city && (
                      <p className="text-xs text-gray-500 mt-0.5">{student.city}</p>
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
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">{student.intake_year}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {student.is_mine && (
                        <span className="w-fit text-[10px] px-1.5 py-0.5 rounded-[2px] border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium uppercase tracking-wide">
                          Мой
                        </span>
                      )}
                      <span className="text-xs text-gray-500 max-w-[180px] truncate">
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
                              : 'border-gray-200 text-gray-400'
                          }`}
                        >
                          П
                        </span>
                        <span
                          title="Кейс студента"
                          className={`text-[10px] w-5 h-5 flex items-center justify-center rounded-[2px] border font-semibold ${
                            intake?.has_cases
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-gray-200 text-gray-400'
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
                          student.is_mine ? 'text-emerald-700 hover:text-emerald-800' : 'text-gray-500 hover:text-black'
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
                      <Link
                        to={`/students/${student.id}`}
                        className="label-caps text-gray-500 hover:text-black transition-colors"
                      >
                        Открыть →
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {students.length} из {total} студентов
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="h-7 text-xs">
              Назад
            </Button>
            <span className="px-2 text-sm text-gray-600 font-medium">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="h-7 text-xs">
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
