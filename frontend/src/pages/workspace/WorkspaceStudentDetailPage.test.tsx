import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn(), can: false }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => mocks.can }) }))
vi.mock('@/api/students', () => ({ studentsApi: { get: mocks.get } }))
vi.mock('@/api/roadmap', () => ({ roadmapApi: { studentRoadmaps: async () => [], listTemplates: async () => [] } }))
vi.mock('@/api/meetings', () => ({ meetingsApi: { studentMeetings: async () => [] } }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { studentSummary: async () => ({}) } }))
vi.mock('@/api/telegram', () => ({ telegramApi: { getForStudent: async () => null } }))
vi.mock('@/hooks/useStartNotes', () => ({ useStartNotes: () => ({ isPending: false, mutate: vi.fn() }) }))

vi.mock('@/api/sync', () => ({ syncApi: { studentIntake: async () => ({ comparison: [] }) } }))
vi.mock('@/api/notion', () => ({ notionApi: { studentNotion: async () => ({ snapshot: null, comparison: [] }) } }))
vi.mock('@/api/documents', () => ({ documentsApi: { upload: mocks.upload } }))
vi.mock('@/components/workspace/WorkspaceNotesPanel', () => ({ WorkspaceNotesPanel: () => <p>Закрытые заметки</p> }))
vi.mock('@/components/notes/StudentMeetingNotes', () => ({ StudentMeetingNotes: () => <p>Конспекты встреч</p> }))
vi.mock('@/components/students/StudentProcessEditor', () => ({ StudentProcessEditor: () => <p>Редактор профиля</p> }))
vi.mock('@/components/portal/ApplicationsSection', () => ({ ApplicationsSection: () => <p>Список заявок</p> }))
vi.mock('@/components/portal/ShortlistSection', () => ({ ShortlistSection: () => <p>Рассматриваемые вузы</p> }))
vi.mock('@/components/portal/PortalCredentialsSection', () => ({ PortalCredentialsSection: () => <p>Admission-пароли</p> }))

const { WorkspaceStudentDetailPage } = await import('./WorkspaceStudentDetailPage')

it('a failed card request offers retry and does not stay on an endless loader', async () => {
  mocks.get.mockRejectedValue({ response: { status: 503, data: { detail: 'Сервер временно недоступен' } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/workspace/students/s1']}>
    <nav>Кабинет</nav><Routes><Route path="/workspace/students/:studentId" element={<WorkspaceStudentDetailPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен')
  expect(screen.queryByText('Загрузка карточки...')).not.toBeInTheDocument()
  expect(screen.getByText('Кабинет')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Повторить'))
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
})

// Вкладки, сохранение выбранного файла и алиасы ссылок проверяются в
// components/students/detail/StudentDetailSections.test.tsx: страница кабинета
// теперь та же StudentCardPage.
