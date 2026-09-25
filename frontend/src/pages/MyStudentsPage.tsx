import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import { studentsApi } from '@/api/students'
import {
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  SERVICE_TYPE_LABELS,
  PipelineStatus,
  ServiceType,
} from '@/types'
import { FilterChips, FilterField, FilterPopover, type FilterChip } from '@/components/shared/FilterPopover'
// Те же фильтры, что в общей базе: обе страницы отбирают один список.
import {
  matchesOperationalFilter,
  OPERATIONAL_FILTER_LABELS,
  type OperationalFilter,
} from '@/lib/studentFilters'
import { useLocalState } from '@/lib/use-local-state'
import { Input } from '@/components/ui/primitives/input'
import { Button } from '@/components/ui/primitives/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { debounce } from '@/lib/utils'
import { PageHeader } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'

/** Те же программы, что в фильтре общей базы. */
const SERVICE_FILTER_OPTIONS: ServiceType[] = [
  'proforientation',
  'ielts_mock',
  'ielts_prep',
  'sat_prep',
  'portfolio_improvement',
  'english_general',
]

export const MyStudentsPage: React.FC = () => {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Выбор переживает переход в карточку и обратно — как в общей базе. Разбор
  // списка идёт студент за студентом, и слетающий на каждом возврате фильтр
  // означал бы заново выставлять его десятки раз.
  const [statusFilter, setStatusFilter] = useLocalState('my-students:status', '')
  const [intakeYearFilter, setIntakeYearFilter] = useLocalState('my-students:year', '')
  const [degreeFilter, setDegreeFilter] = useLocalState('my-students:degree', '')
  const [countryFilter, setCountryFilter] = useLocalState('my-students:country', '')
  const [countryPrimaryOnly, setCountryPrimaryOnly] = useLocalState('my-students:countryPrimary', false)
  const [serviceTypeFilter, setServiceTypeFilter] = useLocalState('my-students:service', '')
  const [operationalFilter, setOperationalFilter] = useLocalState<OperationalFilter>(
    'my-students:operational',
    'all',
  )

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 300),
    []
  )

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    debouncedSetSearch(e.target.value)
  }

  // Грузим разом, без постраничности: у сотрудника десятки студентов, и
  // пагинация по 20 не окупалась, зато мешала — «Контроль работы» считается по
  // данным карточки, и на одной странице он отбирал бы из двадцати вместо всех.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      'my-students',
      debouncedSearch,
      statusFilter,
      intakeYearFilter,
      degreeFilter,
      countryFilter,
      countryPrimaryOnly,
      serviceTypeFilter,
    ],
    queryFn: () =>
      studentsApi.list({
        search: debouncedSearch || undefined,
        pipeline_status: (statusFilter as PipelineStatus) || undefined,
        intake_year: intakeYearFilter ? Number.parseInt(intakeYearFilter, 10) : undefined,
        degree_level: degreeFilter || undefined,
        country: countryFilter.trim() || undefined,
        country_primary_only: countryFilter.trim() ? countryPrimaryOnly : undefined,
        service_type: serviceTypeFilter || undefined,
        scope: 'mine',
        page: 1,
        size: 2000,
      }),
  })

  // Опции фильтров — только то, что есть в данных, со счётчиками.
  const { data: facets } = useQuery({
    queryKey: ['students', 'facets'],
    queryFn: studentsApi.facets,
    staleTime: 60_000,
  })

  // «Контроль работы» считается по полям карточки, которых нет в запросе —
  // поэтому он клиентский, как и в общей базе.
  const students = useMemo(
    () => (data?.items ?? []).filter((s) => matchesOperationalFilter(s, operationalFilter)),
    [data, operationalFilter],
  )
  const total = students.length

  const activeFilterCount =
    (statusFilter ? 1 : 0) +
    (intakeYearFilter ? 1 : 0) +
    (degreeFilter ? 1 : 0) +
    (countryFilter ? 1 : 0) +
    (serviceTypeFilter ? 1 : 0) +
    (operationalFilter !== 'all' ? 1 : 0)

  // Активные фильтры видно без открытия панели, и каждый снимается крестиком:
  // иначе «студентов нет» читается как пустой список, а не как выбранный год.
  const filterChips: FilterChip[] = []
  if (statusFilter) {
    filterChips.push({
      key: 'status',
      label: `Статус: ${PIPELINE_STATUS_LABELS[statusFilter as PipelineStatus] ?? statusFilter}`,
      onRemove: () => setStatusFilter(''),
    })
  }
  if (operationalFilter !== 'all') {
    filterChips.push({
      key: 'operational',
      label: OPERATIONAL_FILTER_LABELS[operationalFilter],
      onRemove: () => setOperationalFilter('all'),
    })
  }
  if (intakeYearFilter) {
    filterChips.push({
      key: 'year',
      label: `Год: ${intakeYearFilter}`,
      onRemove: () => setIntakeYearFilter(''),
    })
  }
  if (degreeFilter) {
    filterChips.push({
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[degreeFilter as keyof typeof DEGREE_LEVEL_LABELS] ?? degreeFilter}`,
      onRemove: () => setDegreeFilter(''),
    })
  }
  if (countryFilter) {
    filterChips.push({
      key: 'country',
      label: `Страна: ${countryFilter}${countryPrimaryOnly ? ' (основная)' : ''}`,
      onRemove: () => {
        setCountryFilter('')
        setCountryPrimaryOnly(false)
      },
    })
  }
  if (serviceTypeFilter) {
    filterChips.push({
      key: 'service',
      label: SERVICE_TYPE_LABELS[serviceTypeFilter as ServiceType] ?? serviceTypeFilter,
      onRemove: () => setServiceTypeFilter(''),
    })
  }

  const resetFilters = () => {
    setStatusFilter('')
    setIntakeYearFilter('')
    setDegreeFilter('')
    setCountryFilter('')
    setCountryPrimaryOnly(false)
    setServiceTypeFilter('')
    setOperationalFilter('all')
  }

  return (
    <div>
      <PageHeader
        eyebrow="Студенты"
        title="Мои студенты"
        description="Студенты с активным назначением в CRM. Эти же студенты будут открываться в личном кабинете ментора."
        action={(
          <div className="flex items-center gap-3">
          <span className="label-caps">Всего: {total}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/students?scope=unassigned">
              <Users className="w-4 h-4 mr-2" />
              Назначить студентов
            </Link>
          </Button>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-4 h-4" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>

        <FilterPopover activeCount={activeFilterCount} onReset={resetFilters}>
          <FilterField label="Статус">
            <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(PIPELINE_STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Контроль работы">
            <Select
              value={operationalFilter}
              onValueChange={(v) => setOperationalFilter(v as OperationalFilter)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Все сигналы" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OPERATIONAL_FILTER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Год набора">
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
          </FilterField>

          <FilterField label="Ступень">
            <Select value={degreeFilter || 'all'} onValueChange={(v) => setDegreeFilter(v === 'all' ? '' : v)}>
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
          </FilterField>

          <FilterField label="Страна поступления">
            <Select value={countryFilter || 'all'} onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}>
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
            {/* Ученик подаётся в несколько стран: «основная» отвечает на вопрос
                «куда он едет», «любая» — «куда вообще подавался». */}
            {countryFilter.trim() && (
              <div className="flex rounded-full border border-p-line bg-p-bg p-0.5 text-2xs">
                <button
                  type="button"
                  onClick={() => setCountryPrimaryOnly(false)}
                  className={`flex-1 rounded-full px-2 py-1 font-semibold transition-colors ${!countryPrimaryOnly ? 'bg-white text-p-text shadow-sm' : 'text-p-muted'}`}
                >
                  Любая
                </button>
                <button
                  type="button"
                  onClick={() => setCountryPrimaryOnly(true)}
                  className={`flex-1 rounded-full px-2 py-1 font-semibold transition-colors ${countryPrimaryOnly ? 'bg-white text-p-text shadow-sm' : 'text-p-muted'}`}
                >
                  Основная
                </button>
              </div>
            )}
          </FilterField>

          <FilterField label="Программа / услуга">
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
                  <SelectItem key={type} value={type}>{SERVICE_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </FilterPopover>
      </div>

      {filterChips.length > 0 && (
        <div className="mb-4">
          <FilterChips chips={filterChips} onResetAll={resetFilters} />
        </div>
      )}

      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Имя</TableHead>
              <TableHead>Степень</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Дней в работе</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              /* Строкой, а не карточкой: карточка внутри tbody сломала бы таблицу. */
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center" role="alert">
                  <p className="text-sm font-bold text-p-text">Не удалось загрузить</p>
                  <p className="mt-1 text-sm text-p-muted">
                    {getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.')}
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                    Повторить
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-p-muted">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-p-muted">
                  У вас пока нет студентов. Откройте общий список и назначьте себя или нужного ментора ответственным.
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => (
                <TableRow key={student.id} className="border-p-line hover:bg-p-bg">
                  <TableCell className="font-medium">
                    <Link
                      to={`/students/${student.id}`}
                      className="text-p-text hover:text-black hover:underline underline-offset-4"
                    >
                      {student.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                      {DEGREE_LEVEL_LABELS[student.degree_level]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
                    ) : (
                      <span className="text-p-muted2 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-p-muted">{student.intake_year}</TableCell>
                  <TableCell className="text-p-muted">{student.days_in_work ?? '—'}</TableCell>
                  <TableCell>
                    <Link
                      to={`/students/${student.id}`}
                      className="label-caps text-p-muted hover:text-black transition-colors"
                    >
                      Открыть →
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && students.length === 0 && (
        <div className="mt-4 rounded-card border border-p-line bg-p-bg px-4 py-3 text-sm text-p-muted">
          У вас нет активных ответственных назначений. В CRM откройте студента и назначьте ментора в блоке «Ответственные»
          или нажмите «Взять» в общем списке.
        </div>
      )}

    </div>
  )
}
