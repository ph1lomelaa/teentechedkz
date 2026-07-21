import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, Search } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import {
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DegreeLevel,
} from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'
import { FilterPopover, FilterField, FilterChips, ResponsiblePicker } from '@/components/shared/FilterPopover'
import { useStudentDirectory, matchesDirectoryFilters, EMPTY_DIRECTORY_FILTERS, StudentDirectoryFilters } from '@/hooks/useStudentDirectory'

type DuplicatePair = {
  reason: 'phone' | 'name'
  a: { id: string; full_name: string; phone?: string; intake_year: number }
  b: { id: string; full_name: string; phone?: string; intake_year: number }
}

export const AtRiskStudentsPage: React.FC = () => {
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const isManager = hasRole('admin', 'mzk_manager')
  const isAdmin = hasRole('admin')
  const qc = useQueryClient()

  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null)
  const [mainSide, setMainSide] = useState<'a' | 'b'>('a')
  const [search, setSearch] = useState('')
  const [directoryFilters, setDirectoryFilters] = useState<StudentDirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const directory = useStudentDirectory()

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const { data: duplicates } = useQuery({
    queryKey: ['students', 'duplicates'],
    queryFn: studentsApi.duplicates,
    enabled: isManager,
  })

  const mergeMutation = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      studentsApi.merge(sourceId, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['students', 'duplicates'] })
      const main = mergePair?.[mainSide]
      const duplicate = mergePair?.[mainSide === 'a' ? 'b' : 'a']
      setMergePair(null)
      toast({
        title: 'Студенты соединены',
        description: main && duplicate
          ? `Главной осталась ${main.full_name}. ${duplicate.full_name} архивирован и не потерян.`
          : 'Карточки соединены, архивный профиль сохранён.',
      })
    },
    onError: (err) => toast({ title: 'Не удалось соединить студентов', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const q = search.trim().toLowerCase()
  const atRiskStudents = useMemo(
    () =>
      students
        .filter((s) => {
          const status = s.pipeline_status
          return status === 'on_visa' || status === 'suspended' || status === 'transferred_pipeline'
        })
        .filter((s) => !q || s.full_name.toLowerCase().includes(q))
        .filter((s) => matchesDirectoryFilters(s, directoryFilters))
        .sort((a, b) => (b.days_in_work ?? 0) - (a.days_in_work ?? 0)),
    [students, q, directoryFilters],
  )

  const activeFiltersCount =
    (directoryFilters.year ? 1 : 0) +
    (directoryFilters.country ? 1 : 0) +
    (directoryFilters.degree ? 1 : 0) +
    (directoryFilters.responsibleId ? 1 : 0)
  const responsibleName = (id: string) => directory.responsibleUsers.find((u) => u.id === id)?.name ?? id
  const resetDirectoryFilters = () => setDirectoryFilters(EMPTY_DIRECTORY_FILTERS)
  const filterChips = [
    directoryFilters.year && { key: 'year', label: `Год: ${directoryFilters.year}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, year: '' })) },
    directoryFilters.country && { key: 'country', label: `Страна: ${directoryFilters.country}`, onRemove: () => setDirectoryFilters((f) => ({ ...f, country: '' })) },
    directoryFilters.degree && {
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[directoryFilters.degree as DegreeLevel] ?? directoryFilters.degree}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, degree: '' })),
    },
    directoryFilters.responsibleId && {
      key: 'responsible',
      label: `Ответственный: ${responsibleName(directoryFilters.responsibleId)}`,
      onRemove: () => setDirectoryFilters((f) => ({ ...f, responsibleId: '' })),
    },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const openMergeDialog = (pair: DuplicatePair) => {
    setMergePair(pair)
    setMainSide('a')
  }

  const selectedMain = mainSide === 'a' ? mergePair?.a : mergePair?.b
  const selectedDuplicate = mainSide === 'a' ? mergePair?.b : mergePair?.a

  return (
    <div>
      <CrmPageHeader
        eyebrow="Контроль"
        title="Зона риска"
        description="Студенты, чей процесс требует дополнительного внимания."
      />

      <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-[2px] text-sm text-orange-800">
        Студенты, за процессом которых стоит следить внимательнее: виза в работе,
        процесс подвешен или студента перевели. Статусы: «На визе», «Подвешено», «Перевели».
        Отсортировано по дням в работе — сверху дольше всего висящие случаи.
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск по имени..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <FilterPopover activeCount={activeFiltersCount} onReset={resetDirectoryFilters}>
          <div className="grid grid-cols-2 gap-2">
            <FilterField label="Год">
              <Select
                value={directoryFilters.year || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, year: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все годы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все годы</SelectItem>
                  {directory.years.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ступень">
              <Select
                value={directoryFilters.degree || 'all'}
                onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, degree: v === 'all' ? '' : v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Все ступени" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все ступени</SelectItem>
                  {directory.degrees.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {DEGREE_LEVEL_LABELS[opt.value as DegreeLevel] ?? opt.value} · {opt.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          <FilterField label="Страна поступления">
            <Select
              value={directoryFilters.country || 'all'}
              onValueChange={(v) => setDirectoryFilters((f) => ({ ...f, country: v === 'all' ? '' : v }))}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все страны" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все страны</SelectItem>
                {directory.countries.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value} · {opt.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          {directory.canFilterByResponsible && (
            <FilterField label="Ответственный (ментор/МЗК)">
              <ResponsiblePicker
                users={directory.responsibleUsers}
                value={directoryFilters.responsibleId}
                onChange={(id) => setDirectoryFilters((f) => ({ ...f, responsibleId: id }))}
              />
            </FilterField>
          )}
        </FilterPopover>
      </div>

      <div className="mb-4">
        <FilterChips chips={filterChips} onResetAll={resetDirectoryFilters} />
      </div>

      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Студент</TableHead>
              <TableHead>Степень</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Дней в работе</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-p-muted">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : atRiskStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-p-muted">
                  В зоне риска никого нет
                </TableCell>
              </TableRow>
            ) : (
                atRiskStudents.map((student) => (
                  <TableRow
                    key={student.id}
                    className="border-p-line hover:bg-p-bg cursor-pointer"
                    tabIndex={0}
                    role="link"
                    onClick={() => navigate(`/students/${student.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate(`/students/${student.id}`)
                      }
                    }}
                  >
                    <TableCell className="font-medium text-p-text">{student.full_name}</TableCell>
                    <TableCell>
                      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                        {DEGREE_LEVEL_LABELS[student.degree_level]}
                      </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-p-muted">{student.intake_year}</TableCell>
                  <TableCell className="text-p-muted">{student.days_in_work ?? '—'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/students/${student.id}`}
                        className="label-caps text-p-muted hover:text-black transition-colors"
                      >
                        Открыть →
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {isManager && duplicates && (
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <Copy className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-p-text tracking-tight">
              Возможные дубли · {duplicates.total}
            </h2>
          </div>
          {duplicates.total === 0 ? (
            <p className="text-sm text-p-muted">Дублей не найдено — все студенты уникальны.</p>
          ) : (
            <>
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-[2px] text-sm text-red-800">
                Пары студентов с одинаковым телефоном или совпадающим именем (включая
                написание на разных языках). Проверь каждую пару: можно соединить карточки
                в одну. Архивный профиль не удаляется и останется доступен администратору.
              </div>
              <div className="border-y border-p-line">
                <Table>
                  <TableHeader>
                    <TableRow className="border-p-line hover:bg-transparent">
                      <TableHead>Студент А</TableHead>
                      <TableHead>Студент Б</TableHead>
                      <TableHead>Совпадение</TableHead>
                      <TableHead>Телефоны</TableHead>
                      {isAdmin && <TableHead className="text-right">Действие</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {duplicates.pairs.map((pair, i) => (
                      <TableRow key={i} className="border-p-line hover:bg-p-bg">
                        <TableCell>
                          <Link to={`/students/${pair.a.id}`} className="font-medium text-p-text hover:underline">
                            {pair.a.full_name}
                          </Link>
                          <span className="text-p-muted2 text-xs ml-2">{pair.a.intake_year}</span>
                        </TableCell>
                        <TableCell>
                          <Link to={`/students/${pair.b.id}`} className="font-medium text-p-text hover:underline">
                            {pair.b.full_name}
                          </Link>
                          <span className="text-p-muted2 text-xs ml-2">{pair.b.intake_year}</span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${
                            pair.reason === 'phone'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {pair.reason === 'phone' ? 'Телефон' : 'Имя'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-p-muted">
                          {pair.a.phone || '—'} · {pair.b.phone || '—'}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5" onClick={() => openMergeDialog(pair)}>
                              <Link2 className="w-3.5 h-3.5" />
                              Соединить
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={!!mergePair} onOpenChange={(open) => !open && setMergePair(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Соединить студентов?</DialogTitle>
            <DialogDescription>
              Выберите, какая карточка останется главной. Дублирующая карточка будет архивирована,
              но останется доступной администратору по прямой ссылке.
            </DialogDescription>
          </DialogHeader>
          {mergePair && selectedMain && selectedDuplicate && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setMainSide('a')}
                  className={`rounded-[2px] border p-3 text-left transition-colors ${
                    mainSide === 'a' ? 'border-black bg-black text-white' : 'border-p-line bg-white hover:bg-p-bg'
                  }`}
                >
                  <div className="text-xs uppercase tracking-[0.18em] opacity-70">Главная карточка</div>
                  <div className="mt-1 font-semibold">{mergePair.a.full_name}</div>
                  <div className="text-xs opacity-70">{mergePair.a.intake_year}{mergePair.a.phone ? ` · ${mergePair.a.phone}` : ''}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMainSide('b')}
                  className={`rounded-[2px] border p-3 text-left transition-colors ${
                    mainSide === 'b' ? 'border-black bg-black text-white' : 'border-p-line bg-white hover:bg-p-bg'
                  }`}
                >
                  <div className="text-xs uppercase tracking-[0.18em] opacity-70">Главная карточка</div>
                  <div className="mt-1 font-semibold">{mergePair.b.full_name}</div>
                  <div className="text-xs opacity-70">{mergePair.b.intake_year}{mergePair.b.phone ? ` · ${mergePair.b.phone}` : ''}</div>
                </button>
              </div>
              <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {selectedMain.full_name} останется активной карточкой. {selectedDuplicate.full_name} будет архивирована,
                а связанные документы, конспекты и задачи переедут в главную карточку.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergePair(null)}>
              Отмена
            </Button>
            <Button
              disabled={!mergePair || mergeMutation.isPending}
              onClick={() => {
                if (!mergePair) return
                const sourceId = mainSide === 'a' ? mergePair.b.id : mergePair.a.id
                const targetId = mainSide === 'a' ? mergePair.a.id : mergePair.b.id
                mergeMutation.mutate({ sourceId, targetId })
              }}
            >
              {mergeMutation.isPending ? 'Соединяем…' : 'Соединить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
