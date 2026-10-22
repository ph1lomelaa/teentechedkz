import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { University } from '@/api/universities'
import { UniversitiesCatalog } from './UniversitiesCatalog'
import { UniversityPicker } from './UniversityPicker'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), getById: vi.fn() }))
vi.mock('@/api/universities', () => ({ universitiesApi: mocks }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: (resource: string, action: string) => resource === 'universities' && action === 'create' }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
const university = (id: string, name: string): University => ({ id, name, country_name: 'USA', country_ref_id: null, city: '', description: '', website: '', world_ranking: null, tuition_range: '', has_grants: false })

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.list.mockResolvedValue([]) })

describe('mentor university creation', () => {
  it('catalog create button works without management or import rights and clears stale filters', async () => {
    localStorage.setItem('teenteched_portal:portal:universities:country', JSON.stringify('Italy'))
    const saved = university('new', 'Missing University')
    mocks.create.mockImplementation(async () => { mocks.list.mockResolvedValue([saved]); return saved })
    mount(<UniversitiesCatalog canCreate canManage={false} canImport={false} />)
    expect(screen.getByText('Добавить университет')).toBeInTheDocument()
    expect(screen.queryByText('Импортировать каталог')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Поиск по названию, городу, стране или специальности…'), { target: { value: 'Missing University' } })
    fireEvent.click(await screen.findByText('Нет нужного вуза? Добавить в каталог'))
    expect(screen.getByLabelText('Название')).toHaveValue('Missing University')
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Missing University' })))
    await waitFor(() => expect(localStorage.getItem('teenteched_portal:portal:universities:country')).toBe(JSON.stringify('all')))
    expect(await screen.findByText('Missing University')).toBeInTheDocument()
  })

  it('student picker creates the missing university and immediately selects it', async () => {
    const onPick = vi.fn()
    mocks.create.mockResolvedValue(university('new', 'Missing College'))
    mount(<UniversityPicker open onOpenChange={vi.fn()} onPick={onPick} />)
    fireEvent.change(screen.getByPlaceholderText('Название, город, страна или специальность…'), { target: { value: 'Missing College' } })
    fireEvent.click(screen.getByText('Нет нужного вуза? Добавить в каталог'))
    expect(screen.getByLabelText('Название')).toHaveValue('Missing College')
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('new'))
  })

  it('duplicate suggestion selects the existing university instead of creating another', async () => {
    const onPick = vi.fn()
    mocks.create.mockRejectedValue({ response: { data: { detail: { message: 'Already exists', matches: [{ id: 'old', name: 'Existing College', country: 'USA' }] } } } })
    mocks.getById.mockResolvedValue(university('old', 'Existing College'))
    mount(<UniversityPicker open onOpenChange={vi.fn()} onPick={onPick} />)
    fireEvent.click(screen.getByText('Нет нужного вуза? Добавить в каталог'))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Existing College' } })
    fireEvent.click(screen.getByText('Сохранить'))
    fireEvent.click(await screen.findByText('Existing College · USA · Выбрать'))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('old'))
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('a failed catalog request is shown as an error rather than no search matches', async () => {
    mocks.list.mockRejectedValue({ response: { status: 503, data: { detail: 'Сервер временно недоступен' } } })
    mount(<UniversityPicker open onOpenChange={vi.fn()} onPick={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен')
    expect(screen.queryByText('Ничего не найдено.')).not.toBeInTheDocument()
  })

  it('shows every matching result, including universities past the old 60-row limit', async () => {
    const onPick=vi.fn()
    mocks.list.mockResolvedValue(Array.from({ length: 65 }, (_, index) => university(String(index), `College ${String(index).padStart(2,'0')}`)))
    mount(<UniversityPicker open onOpenChange={vi.fn()} onPick={onPick} />)
    fireEvent.click(await screen.findByText('College 64'))
    expect(onPick).toHaveBeenCalledWith('64')
  })
})
