import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudentResponsibilities } from '@/api/responsibilities'

/**
 * Секция «Кто за что отвечает» в карточке ученика.
 *
 * Ради чего тест: раздел существует, чтобы человек с одного взгляда понимал,
 * чей это участок и какие участки ничьи. Два свойства легко потерять при любой
 * правке вёрстки:
 *
 * 1. Свой участок помечен **словом**, а не только цветом. Цвет в одиночку не
 *    читается при дальтонизме и в чёрно-белой печати.
 * 2. Пустая зона видна как пустая. Если ничьи участки визуально сливаются с
 *    занятыми, раздел не отвечает на вопрос, ради которого заведён.
 */
const ME = 'user-me'

const payload: StudentResponsibilities = {
  student_id: 'stu-1',
  areas: [
    { area: 'meetings', user_id: ME, user_name: 'Данияр', user_role: 'mentor', assigned_at: null, note: null },
    { area: 'telegram', user_id: 'user-other', user_name: 'Айгерим', user_role: 'mzk_manager', assigned_at: null, note: null },
    { area: 'notes', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'tasks', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'roadmap', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'documents', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'portfolio', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'applications', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'questionnaires', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
    { area: 'finance', user_id: null, user_name: null, user_role: null, assigned_at: null, note: null },
  ],
  coverage: {
    total: 10,
    covered: 2,
    covered_areas: ['meetings', 'telegram'],
    missing_areas: ['notes', 'tasks', 'roadmap', 'documents', 'portfolio', 'applications', 'questionnaires', 'finance'],
    is_complete: false,
  },
}

const can = vi.fn()

vi.mock('@/api/responsibilities', async () => {
  const actual = await vi.importActual<typeof import('@/api/responsibilities')>('@/api/responsibilities')
  return {
    ...actual,
    responsibilitiesApi: {
      forStudent: vi.fn(async () => payload),
      assign: vi.fn(),
      clear: vi.fn(),
      mine: vi.fn(),
      overview: vi.fn(),
    },
  }
})
vi.mock('@/api/index', () => ({ usersApi: { list: vi.fn(async () => []) } }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can, user: { id: ME } }),
}))

const { StudentResponsibilitiesSection } = await import('./StudentResponsibilitiesSection')

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StudentResponsibilitiesSection studentId="stu-1" />
    </QueryClientProvider>,
  )
}

describe('кто за что отвечает', () => {
  beforeEach(() => can.mockReset())

  it('показывает покрытие числом, а не только цветом', async () => {
    can.mockReturnValue(false)
    renderSection()
    expect(await screen.findByText('Закрыто 2 из 10')).toBeInTheDocument()
  })

  it('помечает свой участок словом, а не только подсветкой', async () => {
    can.mockReturnValue(false)
    renderSection()
    expect(await screen.findByText('Ваш участок')).toBeInTheDocument()
  })

  it('чужой участок показывает именем и ролью', async () => {
    can.mockReturnValue(false)
    renderSection()
    expect(await screen.findByText('Айгерим')).toBeInTheDocument()
    expect(screen.getByText('МЗК')).toBeInTheDocument()
  })

  it('пустые зоны видны как пустые', async () => {
    can.mockReturnValue(false)
    renderSection()
    // Восемь незакрытых зон из десяти — именно они и есть ответ на вопрос
    // «кто ведёт заметки», который до этого раздела задать было негде.
    expect(await screen.findAllByText('не назначен')).toHaveLength(8)
  })

  it('без права раздачи не даёт менять — только читать', async () => {
    can.mockReturnValue(false)
    renderSection()
    await screen.findByText('Ваш участок')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('с правом раздачи даёт выбрать ответственного для каждой зоны', async () => {
    can.mockReturnValue(true)
    renderSection()
    expect(await screen.findAllByRole('combobox')).toHaveLength(10)
  })
})
