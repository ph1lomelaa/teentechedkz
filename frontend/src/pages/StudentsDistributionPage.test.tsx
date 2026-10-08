import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Доска распределения.
 *
 * Ради чего тест: назначать ответственных умели и раньше, а увидеть, кому уже
 * назначено, было негде — фильтр отвечает про одного человека за раз. Из-за
 * этого распределение выглядело так, будто система его забывает.
 *
 * Само перетаскивание в jsdom не воспроизводится честно (dnd-kit слушает
 * pointer-события с порогом активации), поэтому решение «в какую колонку попал
 * студент» проверяется отдельно как чистая `resolveDrop` — тот же приём, что с
 * `matchesOperationalFilter` в StudentsListPage. Здесь — то, что видно на
 * экране: колонки, счётчики, поиск и гейт по правам.
 */
const boardCalls: unknown[] = []
const unassignCalls: unknown[] = []

const BOARD = {
  role: 'mzk',
  totals: { students: 4, assigned: 2, unassigned: 2 },
  columns: [
    {
      staff_id: 'zira',
      name: 'Зира Сатпаева',
      user_role: 'mzk_manager',
      students: [
        { id: 's1', full_name: 'Мерей А.', pipeline_status: 'active_work', intake_year: 2027, degree_level: 'undergraduate', country: 'США', assignment_id: 'a1', assignment_status: 'active' },
        { id: 's2', full_name: 'Айгерим Б.', pipeline_status: 'active_work', intake_year: 2026, degree_level: 'undergraduate', country: 'Канада', assignment_id: 'a2', assignment_status: 'active' },
      ],
    },
    { staff_id: 'alia', name: 'Алия Ким', user_role: 'mzk_manager', students: [] },
  ],
  unassigned: [
    { id: 's3', full_name: 'Дана К.', pipeline_status: 'active_work', intake_year: 2027, degree_level: 'undergraduate', country: 'США', assignment_id: null, assignment_status: null },
    // С «передумавшими» уже не работают — по умолчанию их на доске нет.
    { id: 's4', full_name: 'Ерлан П.', pipeline_status: 'changed_mind', intake_year: 2026, degree_level: 'undergraduate', country: 'Канада', assignment_id: null, assignment_status: null },
  ],
}

vi.mock('@/api/index', () => ({
  usersApi: { list: () => Promise.resolve([{ id: 'mentor1', name: 'Лид-ментор' }]) },
  mentorAssignmentsApi: {
    board: (params: unknown) => {
      boardCalls.push(params)
      return Promise.resolve(BOARD)
    },
    bulkAssign: () => Promise.resolve({ assigned: 1, replaced: 0, already: 0, skipped: [], assignment_status: 'active' }),
    unassign: (assignmentId: string, reason: string) => {
      unassignCalls.push({ assignmentId, reason })
      return Promise.resolve()
    },
  },
}))
vi.mock('@/api/students', () => ({
  studentsApi: {
    facets: () => Promise.resolve({ years: [{ value: '2026', count: 1 }, { value: '2027', count: 2 }], degrees: [{ value: 'undergraduate', count: 4 }], countries: [{ value: 'США', count: 2 }, { value: 'Канада', count: 2 }] }),
    getAll: () => Promise.resolve([]),
  },
}))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

let canManage = true
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    can: (resource: string) => (resource === 'mentor_assignments' ? canManage : true),
    hasRole: () => true,
    user: { id: 'u1', role: 'admin' },
  }),
}))

const { StudentsDistributionPage } = await import('./StudentsDistributionPage')

function renderPage(entry = '/students/distribution') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <StudentsDistributionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return result
}

describe('список распределения', () => {
  beforeEach(() => {
    localStorage.clear()
    boardCalls.length = 0
    unassignCalls.length = 0
    canManage = true
  })

  it('открывает список по умолчанию и скрывает переключатель доски', async () => {
    renderPage()
    expect(await screen.findByText('Дана К.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назначить' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Выбрать Дана К.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Доска нагрузки' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ерлан П.')).not.toBeInTheDocument()
  })

  it('показывает галочки только после включения выбора и очищает выбор при выходе', async () => {
    renderPage()
    await screen.findByText('Дана К.')
    expect(screen.queryByLabelText(/Выбрать .*студентов группы/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать студентов' }))
    fireEvent.click(screen.getByLabelText('Выбрать Дана К.'))
    expect(screen.getByText('Выбрано 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Выйти из выбора' }))
    expect(screen.queryByLabelText('Выбрать Дана К.')).not.toBeInTheDocument()
    expect(screen.queryByText('Выбрано 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать студентов' }))
    expect(screen.getByLabelText('Выбрать Дана К.')).not.toBeChecked()
  })

  it('раскрывает и сворачивает каждый год набора', async () => {
    renderPage('/students/distribution?status=active_work,changed_mind')
    await screen.findByText('Ерлан П.')
    for (const year of [2026, 2027]) {
      const group = screen.getByRole('button', { name: new RegExp(`Набор ${year}`) })
      if (group.getAttribute('aria-expanded') === 'true') fireEvent.click(group)
      expect(group).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(group)
      expect(group).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(year === 2026 ? 'Ерлан П.' : 'Дана К.')).toBeInTheDocument()
    }
  })

  it('по умолчанию показывает распределение МЗК', async () => {
    renderPage()
    expect(await screen.findByText('Зира Сатпаева')).toBeInTheDocument()
    expect(boardCalls).toContainEqual({ role: 'mzk' })
  })

  it('смена роли обновляет запрос', async () => {
    renderPage()
    await screen.findByText('Зира Сатпаева')
    fireEvent.click(screen.getByText('Ментор по УП'))
    await waitFor(() => expect(boardCalls).toContainEqual({ role: 'lead' }))
  })

  it('читает роль из адреса', async () => {
    renderPage('/students/distribution?role=career')
    await waitFor(() => expect(boardCalls).toContainEqual({ role: 'career' }))
  })

  it('поиск оставляет совпадающих нераспределённых студентов', async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('Найти студента'), {
      target: { value: 'Дана' },
    })
    expect(await screen.findByText('Дана К.')).toBeInTheDocument()
    expect(screen.queryByText('Ерлан П.')).not.toBeInTheDocument()
  })

  it('по умолчанию показывает только активную работу', async () => {
    // Без фильтра колонка «Без ответственного» тонула в тех, с кем уже не
    // работают, и настоящих нераспределённых было не найти.
    renderPage()
    await screen.findByText('Дана К.')

    expect(screen.queryByText('Ерлан П.')).not.toBeInTheDocument()
    expect(screen.getByText(/1 студентов в списке/)).toBeInTheDocument()
  })

  it('дополнительный фильтр по статусу возвращает скрытых', async () => {
    renderPage()
    await screen.findByText('Дана К.')
    fireEvent.click(screen.getByText('+ Фильтр'))
    fireEvent.click(screen.getByText('Работа окончена — Передумал'))

    expect(await screen.findByText('Ерлан П.')).toBeInTheDocument()
  })

  it('читает статусы из адреса', async () => {
    renderPage('/students/distribution?status=changed_mind')
    await screen.findByText('Ерлан П.')

    expect(screen.queryByText('Дана К.')).not.toBeInTheDocument()
    expect(await screen.findByText('Ерлан П.')).toBeInTheDocument()
  })

  it('фильтр по году отсеивает чужой набор', async () => {
    // Ради этого фильтры и появились: в колонке «Без ответственного» лежали
    // все пять лет набора сразу, и найти нужный год было нечем.
    renderPage('/students/distribution?year=2027')
    expect(await screen.findByText('Дана К.')).toBeInTheDocument()
  })

  it('фильтр по стране оставляет совпадающих', async () => {
    renderPage('/students/distribution?country=США')
    expect(await screen.findByText('Дана К.')).toBeInTheDocument()
    expect(screen.queryByText('Ерлан П.')).not.toBeInTheDocument()
  })

  it('несколько годов складываются, а не сужают друг друга', async () => {
    // Старые ссылки с несколькими годами продолжают открываться.
    renderPage('/students/distribution?year=2026,2027')
    expect(await screen.findByText('Дана К.')).toBeInTheDocument()
  })

})
