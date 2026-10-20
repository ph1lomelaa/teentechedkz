import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceRoadmapPage } from './WorkspaceRoadmapPage'
const mocks = vi.hoisted(() => ({ fullRoadmaps: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'mentor', role: 'mentor' } }) }))
vi.mock('@/api/workspace', () => ({ workspaceApi: { fullRoadmaps: mocks.fullRoadmaps } }))
vi.mock('@/components/workspace/WorkspaceRoadmapEditor', () => ({ WorkspaceRoadmapEditor: () => <div>Редактор roadmap</div> }))
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><WorkspaceRoadmapPage /></MemoryRouter></QueryClientProvider>) }
beforeEach(() => { vi.clearAllMocks(); mocks.fullRoadmaps.mockResolvedValue({ items: [{ student: { id: 's1', full_name: 'Анна' }, roadmap: null }, { student: { id: 's2', full_name: 'Борис' }, roadmap: null }, ...['Вера', 'Глеб'].map((name, i) => ({ student: { id: `s${i+3}`, full_name: name }, roadmap: { id: `r${i}`, name: 'Поступление', stages: [{ id: `stage${i}`, name: 'Подготовка', status: 'in_progress', tasks: [{ id: `t${i}`, status: 'planned', due_date: null, subtasks: [] }] }] } }))] }) })
afterEach(cleanup)
it('сразу показывает прежние полные редакторы; карточки без roadmap идут после заполненных', async () => { open(); await screen.findByText('Анна'); expect(screen.getAllByText('Редактор roadmap')).toHaveLength(2); expect(screen.queryByRole('button', { name: 'Открыть roadmap' })).toBeNull(); expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Вера', 'Глеб', 'Анна', 'Борис']) })
it('выбор студента фильтрует карточки и счётчик отсутствующих roadmap', async () => { open(); await screen.findByText('Анна'); fireEvent.focus(screen.getByPlaceholderText('Найти студента')); fireEvent.click(screen.getByRole('button', { name: /Анна Roadmap не назначен/ })); expect(screen.getByText('Без roadmap: 1')).toBeTruthy(); expect(screen.queryByText('Борис')).toBeNull(); expect(screen.queryByText('Редактор roadmap')).toBeNull() })
it('ошибка загрузки не маскируется отсутствием студентов', async () => { mocks.fullRoadmaps.mockRejectedValue(new Error('Нет связи')); open(); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText('Студентов нет')).toBeNull() })
