import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ResponsibilityArea, StudentResponsibilities } from '@/api/responsibilities'

/**
 * Метка «чей это участок» в заголовке раздела.
 *
 * Ради чего тест: у метки три состояния, и самое ценное — третье. «Ваш
 * участок» и «Ведёт: Данияр» приятны, но вопрос, ради которого всё затевалось,
 * звучал иначе: «кто ведёт встречи?» — и чаще всего ответа не было вовсе.
 * Пустая зона обязана быть видна как пустая, иначе раздел молча делает вид,
 * что всё в порядке.
 *
 * Плюс: каждое состояние подписано словом. Цвет в одиночку не читается при
 * дальтонизме и в чёрно-белой печати.
 */
const ME = 'user-me'

function payload(area: ResponsibilityArea, cell: Partial<StudentResponsibilities['areas'][0]>): StudentResponsibilities {
  return {
    student_id: 'stu-1',
    areas: [{ area, user_id: null, user_name: null, user_role: null, assigned_at: null, note: null, ...cell }],
    coverage: { total: 1, covered: 0, covered_areas: [], missing_areas: [area], is_complete: false },
  }
}

const forStudent = vi.fn()
const can = vi.fn(() => true)

vi.mock('@/api/responsibilities', async () => {
  const actual = await vi.importActual<typeof import('@/api/responsibilities')>('@/api/responsibilities')
  return { ...actual, responsibilitiesApi: { forStudent: (...args: unknown[]) => forStudent(...args) } }
})
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can, user: { id: ME } }) }))

const { ResponsibilityBadge } = await import('./ResponsibilityBadge')

function renderBadge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ResponsibilityBadge studentId="stu-1" area="meetings" />
    </QueryClientProvider>,
  )
}

describe('метка участка', () => {
  it('называет пустую зону пустой', async () => {
    forStudent.mockResolvedValue(payload('meetings', {}))
    renderBadge()
    expect(await screen.findByText('Без ответственного')).toBeInTheDocument()
  })

  it('свой участок подписан словом, а не только подсветкой', async () => {
    forStudent.mockResolvedValue(payload('meetings', { user_id: ME, user_name: 'Я' }))
    renderBadge()
    expect(await screen.findByText('Ваш участок')).toBeInTheDocument()
  })

  it('чужой участок называет имя, к кому идти', async () => {
    forStudent.mockResolvedValue(payload('meetings', { user_id: 'other', user_name: 'Данияр' }))
    renderBadge()
    expect(await screen.findByText(/Ведёт: Данияр/)).toBeInTheDocument()
  })

  it('без права видеть расклад не запрашивает его и ничего не рисует', async () => {
    can.mockReturnValueOnce(false)
    forStudent.mockClear()
    const { container } = renderBadge()
    expect(container).toBeEmptyDOMElement()
    expect(forStudent).not.toHaveBeenCalled()
  })
})
