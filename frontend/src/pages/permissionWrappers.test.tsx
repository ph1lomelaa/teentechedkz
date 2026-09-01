import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Страницы-обёртки над общими менеджерами.
 *
 * Ради чего тест: общий менеджер рисуется в двух оболочках, а право читает не
 * он, а обёртка. Забытый `canManage` не ломает ни сборку, ни типы — страница
 * открывается, кнопки на месте, и заметен изъян только по 403 после нажатия.
 * Так и случилось: `MentorRewardsPage` показывал ментору «Добавить этап»,
 * потому что дефолт менеджера — `canManage = true`.
 *
 * Поэтому проверяется не разметка, а единственное, что обёртка обязана
 * сделать: спросить право и передать ответ вниз. Дефолты у компонентов разные
 * (true и false), и ошибка в любую сторону одинаково незаметна — у одного
 * лишние кнопки, у другого пропавшая правка.
 */
const can = vi.fn()

const mentorRewardsProps = vi.fn()
const universityDetailProps = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can }) }))
vi.mock('@/components/admin/MentorRewardsManager', () => ({
  MentorRewardsManager: (props: Record<string, unknown>) => {
    mentorRewardsProps(props)
    return null
  },
}))
vi.mock('@/components/portal/UniversityDetail', () => ({
  UniversityDetail: (props: Record<string, unknown>) => {
    universityDetailProps(props)
    return null
  },
}))

const { MentorRewardsPage } = await import('./MentorRewardsPage')
const { WorkspaceMentorRewardsPage } = await import('./workspace/WorkspaceMentorRewardsPage')
const { UniversityDetailPage } = await import('./UniversityDetailPage')
const { WorkspaceUniversityDetailPage } = await import('./workspace/WorkspaceUniversityDetailPage')

describe('обёртки передают право вниз', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    can.mockReturnValue(false)
  })

  // Обе оболочки спрашивают одно и то же право: разойдись они, ментор получил
  // бы разный набор кнопок на двух адресах одной и той же страницы.
  it.each([
    ['CRM', MentorRewardsPage],
    ['кабинет', WorkspaceMentorRewardsPage],
  ])('вознаграждения (%s): без права manage кнопки скрыты', (_shell, Page) => {
    render(<Page />)
    expect(can).toHaveBeenCalledWith('mentor_rewards', 'manage')
    expect(mentorRewardsProps.mock.calls[0][0].canManage).toBe(false)
  })

  it.each([
    ['CRM', MentorRewardsPage],
    ['кабинет', WorkspaceMentorRewardsPage],
  ])('вознаграждения (%s): с правом manage кнопки открыты', (_shell, Page) => {
    can.mockReturnValue(true)
    render(<Page />)
    expect(mentorRewardsProps.mock.calls[0][0].canManage).toBe(true)
  })

  // Здесь дефолт компонента обратный (false), поэтому забытая передача не
  // открывает лишнего, а отнимает правку у того, кому она полагается.
  it.each([
    ['CRM', UniversityDetailPage],
    ['кабинет', WorkspaceUniversityDetailPage],
  ])('университеты (%s): право manage доходит до карточки', (_shell, Page) => {
    can.mockReturnValue(true)
    render(<Page />)
    expect(can).toHaveBeenCalledWith('universities', 'manage')
    expect(universityDetailProps.mock.calls[0][0].canManage).toBe(true)
  })

  it.each([
    ['CRM', UniversityDetailPage],
    ['кабинет', WorkspaceUniversityDetailPage],
  ])('университеты (%s): без права manage правка скрыта', (_shell, Page) => {
    render(<Page />)
    expect(universityDetailProps.mock.calls[0][0].canManage).toBe(false)
  })
})
