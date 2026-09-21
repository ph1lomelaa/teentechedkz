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

const BOARD = {
  role: 'mzk',
  totals: { students: 4, assigned: 2, unassigned: 2 },
  columns: [
    {
      staff_id: 'zira',
      name: 'Зира Сатпаева',
      user_role: 'mzk_manager',
      students: [
        { id: 's1', full_name: 'Мерей А.', pipeline_status: 'active_work', assignment_id: 'a1', assignment_status: 'active' },
        { id: 's2', full_name: 'Айгерим Б.', pipeline_status: 'active_work', assignment_id: 'a2', assignment_status: 'active' },
      ],
    },
    { staff_id: 'alia', name: 'Алия Ким', user_role: 'mzk_manager', students: [] },
  ],
  unassigned: [
    { id: 's3', full_name: 'Дана К.', pipeline_status: 'active_work', assignment_id: null, assignment_status: null },
    // С «передумавшими» уже не работают — по умолчанию их на доске нет.
    { id: 's4', full_name: 'Ерлан П.', pipeline_status: 'changed_mind', assignment_id: null, assignment_status: null },
  ],
}

vi.mock('@/api/index', () => ({
  mentorAssignmentsApi: {
    board: (params: unknown) => {
      boardCalls.push(params)
      return Promise.resolve(BOARD)
    },
    bulkAssign: () => Promise.resolve({ assigned: 1, replaced: 0, already: 0, skipped: [], assignment_status: 'active' }),
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <StudentsDistributionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('доска распределения', () => {
  beforeEach(() => {
    localStorage.clear()
    boardCalls.length = 0
    canManage = true
  })

  it('показывает колонку на каждого сотрудника и студентов в ней', async () => {
    renderPage()

    expect(await screen.findByText('Зира Сатпаева')).toBeInTheDocument()
    expect(screen.getByText('Мерей А.')).toBeInTheDocument()
    expect(screen.getByText('Айгерим Б.')).toBeInTheDocument()
  })

  it('оставляет колонку сотрудника без студентов', async () => {
    // Пустая колонка — не мусор: это и «кто свободен», и место, куда
    // перетащить карточку. Схлопнуть её означало бы спрятать свободных.
    renderPage()

    expect(await screen.findByText('Алия Ким')).toBeInTheDocument()
    expect(screen.getByText('Никого не ведёт. Перетащите сюда студента')).toBeInTheDocument()
  })

  it('показывает забытых студентов отдельной колонкой', async () => {
    // Ради этой колонки доску и открывают: у кого сколько — второй вопрос.
    renderPage()

    expect(await screen.findByText('Без ответственного')).toBeInTheDocument()
    expect(screen.getByText('Дана К.')).toBeInTheDocument()
  })

  it('по умолчанию показывает распределение МЗК', async () => {
    renderPage()

    await screen.findByText('Зира Сатпаева')
    expect(boardCalls).toContainEqual({ role: 'mzk' })
  })

  it('смена роли уезжает в запрос', async () => {
    // Роль — часть запроса, а не фильтр поверх ответа: у студента
    // ответственных несколько, и доска показывает ровно одну роль.
    renderPage()
    await screen.findByText('Зира Сатпаева')

    fireEvent.click(screen.getByText('Ментор по УП'))

    await waitFor(() => expect(boardCalls).toContainEqual({ role: 'lead' }))
  })

  it('читает роль из адреса — на доску можно дать ссылку', async () => {
    renderPage('/students/distribution?role=career')

    await waitFor(() => expect(boardCalls).toContainEqual({ role: 'career' }))
  })

  it('поиск прячет карточки, но счётчик колонки остаётся честным', async () => {
    renderPage()
    await screen.findByText('Мерей А.')

    fireEvent.change(screen.getByPlaceholderText('Поиск студента...'), {
      target: { value: 'Айгерим' },
    })

    expect(screen.queryByText('Мерей А.')).not.toBeInTheDocument()
    expect(screen.getByText('Айгерим Б.')).toBeInTheDocument()
    // Иначе кажется, что студенты из колонки пропали.
    expect(screen.getByText('1 из 2')).toBeInTheDocument()
  })

  it('колонка ведёт в общую базу с фильтром по человеку и роли', async () => {
    renderPage()
    await screen.findByText('Зира Сатпаева')

    const links = screen.getAllByText('Показать в базе').map((el) => el.closest('a'))
    const hrefs = links.map((a) => a?.getAttribute('href'))

    expect(hrefs).toContain('/students?mentor_id=zira&assignment_role=mzk')
    expect(hrefs).toContain('/students?missing_role=mzk')
  })

  it('без права назначать доска только для чтения', async () => {
    // Смотреть распределение может управление, а передавать студентов — тот,
    // кто и так может назначать: это два разных права.
    canManage = false
    renderPage()

    await screen.findByText('Зира Сатпаева')
    expect(screen.getByText('Никого не ведёт')).toBeInTheDocument()
    expect(screen.queryByText('Никого не ведёт. Перетащите сюда студента')).not.toBeInTheDocument()
  })

  it('по умолчанию показывает только активную работу', async () => {
    // Без фильтра колонка «Без ответственного» тонула в тех, с кем уже не
    // работают, и настоящих нераспределённых было не найти.
    renderPage()
    await screen.findByText('Дана К.')

    expect(screen.queryByText('Ерлан П.')).not.toBeInTheDocument()
    expect(screen.getByText('1 из 2')).toBeInTheDocument()
    // Сводка считает видимых, а не всех.
    expect(screen.getByText(/3 студентов/)).toBeInTheDocument()
  })

  it('фильтр по статусу возвращает скрытых', async () => {
    renderPage()
    await screen.findByText('Дана К.')

    fireEvent.click(screen.getByText('Фильтры'))
    fireEvent.click(screen.getByText('Передумали'))

    expect(await screen.findByText('Ерлан П.')).toBeInTheDocument()
  })

  it('читает статусы из адреса', async () => {
    renderPage('/students/distribution?status=changed_mind')
    await screen.findByText('Ерлан П.')

    expect(screen.queryByText('Дана К.')).not.toBeInTheDocument()
    expect(screen.getAllByText('Нет студентов с выбранным статусом').length).toBeGreaterThan(0)
  })
})
