import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Мой день» — экран, который по регламенту открывают в 10:00.
 *
 * Ради чего тест: при упавшем запросе data === undefined, а isLoading уже
 * false — и экран уверенно писал «Просроченных задач нет», «Нет обращений с
 * горящим сроком ответа», «Встреч на сегодня нет». То есть в день, когда связь
 * оборвалась, система сообщала ментору, что у него всё чисто. Это дороже любой
 * поломки вёрстки: человек не идёт проверять то, за что его штрафуют.
 *
 * Проверяется различие между «пусто» и «не знаю» — именно оно и терялось.
 */
// Ответ подменяется через обычное замыкание, а не через vi.fn(): спай хранит
// возвращённые значения, и отклонённый промис оседает в mock.results без
// обработчика — тест падал бы с unhandled rejection вместо проверки экрана.
let respond: () => Promise<unknown> = () => Promise.resolve(EMPTY_DAY)

vi.mock('@/api/workspace', () => ({ workspaceApi: { myDay: () => respond() } }))
vi.mock('@/api/responsibilities', () => ({
  AREA_LABELS: {},
  responsibilitiesApi: { mine: () => Promise.resolve({ areas: [], total_students: 0 }) },
}))
vi.mock('@/components/workspace/CheckinBanner', () => ({ CheckinBanner: () => null }))

const EMPTY_DAY = {
  tasks: { yellow: [], orange: [], red: [], critical: [] },
  burning_complaints: [],
  today_meetings: [],
  unsigned_agreements: [],
}

const { WorkspaceMyDayPage } = await import('./WorkspaceMyDayPage')

const failing = () => Promise.reject(new Error('Network Error'))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceMyDayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('«Мой день» при упавшем запросе', () => {
  beforeEach(() => { respond = () => Promise.resolve(EMPTY_DAY) })

  it('говорит, что не загрузилось, и даёт повторить', async () => {
    respond = failing
    renderPage()

    expect(await screen.findByText('Не удалось загрузить')).toBeInTheDocument()
    expect(screen.getByText('Повторить')).toBeInTheDocument()
  })

  it('не сообщает, что просроченных задач нет', async () => {
    respond = failing
    renderPage()
    await screen.findByText('Не удалось загрузить')

    // Ровно та фраза, которой экран врал: её не должно быть, когда данных нет.
    expect(screen.queryByText(/Просроченных задач нет/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Встреч на сегодня нет/)).not.toBeInTheDocument()
    expect(screen.queryByText('Всё чисто')).not.toBeInTheDocument()
  })

  it('«Всё чисто» остаётся, когда данные пришли и правда пусты', async () => {
    // Обратная сторона: испугавшись лжи, легко убрать и честное пустое
    // состояние — а оно здесь и есть главный полезный ответ.
    respond = () => Promise.resolve(EMPTY_DAY)
    renderPage()

    expect(await screen.findByText('Всё чисто')).toBeInTheDocument()
  })
})
