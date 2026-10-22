import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentPeekPanel } from './StudentPeekPanel'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), notion: vi.fn(), roadmaps: vi.fn() }))
vi.mock('@/api/students', () => ({ studentsApi: { get: mocks.profile } }))
vi.mock('@/api/notion', () => ({ notionApi: { studentNotion: mocks.notion } }))
vi.mock('@/api/roadmap', () => ({ roadmapApi: { studentRoadmaps: mocks.roadmaps } }))

function openPeek() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<MemoryRouter><QueryClientProvider client={client}><StudentPeekPanel studentId="student-1" onClose={vi.fn()} /></QueryClientProvider></MemoryRouter>)
}

describe('roadmap в быстром просмотре', () => {
  beforeEach(() => {
    // Student profile intentionally contains no roadmap field.
    mocks.profile.mockResolvedValue({ full_name: 'Студент', degree_level: 'undergraduate', mentor_assignments: [] })
    mocks.notion.mockResolvedValue(null)
  })

  it('показывает реальную карту и прогресс, когда профиль не содержит roadmap', async () => {
    mocks.roadmaps.mockResolvedValue([{ name: 'Корея UG', stages: [{ tasks: [{ status: 'done' }, { status: 'planned' }] }] }])
    openPeek()
    expect(await screen.findByText('Корея UG · 50%')).toBeInTheDocument()
    expect(screen.queryByText('Не назначен')).not.toBeInTheDocument()
  })

  it('говорит «Не назначен» только после успешного пустого ответа', async () => {
    mocks.roadmaps.mockResolvedValue([])
    openPeek()
    expect(await screen.findByText('Не назначен')).toBeInTheDocument()
  })

  it('не выдаёт ошибку загрузки за отсутствие карты', async () => {
    mocks.roadmaps.mockRejectedValue(new Error('network unavailable'))
    openPeek()
    expect(await screen.findByText('Не удалось загрузить')).toBeInTheDocument()
    expect(screen.queryByText('Не назначен')).not.toBeInTheDocument()
  })
})
