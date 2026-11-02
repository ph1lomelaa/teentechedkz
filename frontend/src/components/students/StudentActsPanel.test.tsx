// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentActsPanel } from './StudentActsPanel'
import { downloadBlob } from '@/lib/utils'
import { trustmeApi } from '@/api/trustme'
import { actsApi, type ActContext, type ActRecord } from '@/api/acts'

vi.mock('@/lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/utils')>(), downloadBlob: vi.fn() }))

const access = vi.hoisted(() => ({ manage: true }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can: (_: string, action: string) => action === 'view' || access.manage }) }))
vi.mock('@/api/acts', async importOriginal => ({ ...await importOriginal<typeof import('@/api/acts')>(), actsApi: {
  financialContext: vi.fn(), contractPdf: vi.fn(), context: vi.fn(), update: vi.fn(), create: vi.fn(), generate: vi.fn(), share: vi.fn(), checkContract: vi.fn(), saveProfile: vi.fn(), preview: vi.fn(), pdf: vi.fn(), inspect: vi.fn(),
} }))
vi.mock('@/api/trustme', () => ({ trustmeApi: { assignFinancial: vi.fn(), autoLink: vi.fn() } }))
vi.mock('./StudentTrustMePanel', () => ({ StudentTrustMePanel: () => <div>Поиск TrustMe</div> }))

const draft: ActRecord = {
  id: 'act-1', status: 'draft', file_name: null, student_name: 'Тест Әлия', template: 'ielts', act_date: '2026-11-01', created_at: '2026-11-01', shared: false, supersedes_id: null, mail: [],
  snapshot: { contract_link_id: 'link-1', supersedes_id: null, template: 'ielts', student_name: 'Тест Әлия', customer_name: 'Тест Заказчик',
    customer_id: '', student_id_number: '', executor_name: 'Тест Компания', executor_representative: 'Тест Директор', executor_basis: 'Устава', executor_requisites: '',
    contract_number: '671', contract_date: '2026-07-28', act_date: '2026-11-01', city: 'Алматы', period_start: '2026-10-01', period_end: '2026-10-31',
    calls_count: null, include_amount: false, currency: 'KZT', verified: true, full_completion_confirmed: false,
    lines: [{ contract_service_id:'source-1',source_fingerprint:'fingerprint', name: 'Подготовка IELTS', result: 'Занятия проведены', evidence: 'Материалы уроков', contract_source: 'Договор, п. 1.5 стр. 2', quantity: '1', unit: 'услуга', unit_price: null }] },
}
const sourceService = { id:'source-1',name:'Подготовка IELTS',category:'ielts',text:'Занятия проведены',page:2,reference:'Договор, п. 1.5 стр. 2',excerpt:'Занятия проведены' }
const context: ActContext = { student_name: 'Тест Әлия', completed_meetings: null, mail_configured: false, recipient_suggestions: [],
  contracts: [{ id: 'link-1', name: 'Договор Тест', number: '474', status: 3, short_url: '4Kuowd19', signers: [] }], acts: [draft] }
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudentActsPanel studentId="student-1" /></QueryClientProvider>) }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(trustmeApi.autoLink).mockResolvedValue({ state: 'complete', linked_ids: [], review: [] }); access.manage = true; vi.mocked(actsApi.context).mockResolvedValue(structuredClone(context)); vi.mocked(actsApi.update).mockResolvedValue(draft); vi.mocked(actsApi.generate).mockResolvedValue({ ...draft, status: 'ready' }); vi.mocked(actsApi.checkContract).mockResolvedValue({ status: 3, checked_at: '2026-11-01' }); vi.mocked(actsApi.saveProfile).mockResolvedValue({ saved: true }); vi.mocked(actsApi.inspect).mockResolvedValue({ status: 3, fingerprint:'fingerprint',services:[sourceService], fields: {}, sources: {}, conflicts: {}, missing: [], service_hints: {}, pages: [], suggested_contract_number: null, signers: [] }) })
afterEach(cleanup)

describe('Act preparation and access', () => {
  it('shows only contract linking until a contract is selected, even with existing act history', async () => {
    vi.mocked(actsApi.context).mockResolvedValue({ ...context, contracts: [] })
    mount()
    expect(await screen.findByRole('button', { name: 'Добавить вручную' })).toBeInTheDocument()
    expect(screen.queryByText('История актов')).not.toBeInTheDocument()
    expect(screen.queryByText('Создать акт по шаблону')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Продолжить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Создать акт:/ })).not.toBeInTheDocument()
  })

  it('offers mentors viewing without creation or corporate search', async () => {
    access.manage = false; mount()
    expect(await screen.findByRole('button', { name: 'Открыть PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать акт' })).not.toBeInTheDocument()
    expect(screen.queryByText('Поиск TrustMe')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Продолжить' })).not.toBeInTheDocument()
  })

  it('requires a fresh verification and updates the existing draft before generation', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }))
    await waitFor(() => expect(actsApi.inspect).toHaveBeenCalled());
    const generate = screen.getByRole('button', { name: 'Создать акт' })
    expect(generate).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать акт' })).toBeDisabled());
    fireEvent.click(screen.getByRole('checkbox', { name: /Проверено/ }))
    expect(generate).not.toBeDisabled()
    fireEvent.click(generate)
    await waitFor(() => expect(actsApi.generate).toHaveBeenCalledWith('act-1'))
    expect(actsApi.update).toHaveBeenCalledWith('act-1', expect.objectContaining({ verified: true }))
    expect(actsApi.create).not.toHaveBeenCalled()
  })

  it('blocks generation when the contract source cannot be read', async () => {
    vi.mocked(actsApi.inspect).mockRejectedValue(new Error('PDF extraction unavailable'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }))
    await screen.findByRole('button', { name: 'Повторить чтение договора' })
    fireEvent.click(screen.getByRole('checkbox', { name: /Проверено/ }))
    expect(screen.getByRole('button', { name: 'Создать акт' })).toBeDisabled()
  })

  it('resets verification after editing and leaves optional calls empty', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать акт' })).toBeDisabled());
    fireEvent.click(screen.getByRole('checkbox', { name: /Проверено/ }))
    fireEvent.click(screen.getByText(/Реквизиты из договора/));
    fireEvent.change(screen.getByLabelText(/Фамилия и имя студента по договору/), { target: { value: 'Тест Нұрай' } })
    expect(screen.getByRole('checkbox', { name: /Проверено/ })).not.toBeChecked()
    expect(screen.queryByLabelText('Количество звонков / встреч, необязательно')).not.toBeInTheDocument()
  })

  it('downloads a ready PDF under a chosen name without changing the shared record', async () => {
    vi.mocked(actsApi.context).mockResolvedValue({ ...context, acts: [{ ...draft, status: 'ready', file_name: 'Исходное имя.pdf' }] })
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    vi.mocked(actsApi.pdf).mockResolvedValue(blob)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Скачать как…' }))
    fireEvent.change(screen.getByLabelText('Название файла'), { target: { value: 'Акт IELTS — октябрь' } })
    fireEvent.click(screen.getByRole('button', { name: /^Скачать$/ }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'Акт IELTS — октябрь.pdf'))
    expect(screen.getByText('Исходное имя.pdf')).toBeInTheDocument()
    expect(actsApi.update).not.toHaveBeenCalled()
  })

  it('disables email until corporate SMTP is configured and retains the saved PDF', async () => {
    vi.mocked(actsApi.context).mockResolvedValue({ ...context, acts: [{ ...draft, status: 'ready', file_name: 'Тест Әлия - Акт.pdf' }] })
    mount()
    expect(await screen.findByRole('button', { name: 'Скачать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Открыть студенту' })).toBeInTheDocument()
  })

  it('offers one create button instead of a template catalog and previews a ready act', async () => {
    vi.mocked(actsApi.context).mockResolvedValue({ ...context, acts: [{ ...draft, status: 'ready', file_name: 'Тест Әлия - Акт.pdf' }] })
    vi.mocked(actsApi.pdf).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    URL.createObjectURL = vi.fn(() => 'blob:act'); URL.revokeObjectURL = vi.fn()
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать акт' })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: /Создать акт:/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть' }))
    expect(await screen.findByTitle('Тест Әлия - Акт.pdf')).toHaveAttribute('src', 'blob:act')
  })
})


describe('Financial document integration', () => {
  function financialMount() {
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudentActsPanel studentId="student-1" financialContractId="financial-1" /></QueryClientProvider>)
  }
  it('loads the exact contract and exposes unassigned documents read only to finance', async () => {
    access.manage = false
    vi.mocked(actsApi.financialContext).mockResolvedValue({ ...context, contracts: [], acts: [], unassigned_contracts: context.contracts })
    financialMount()
    fireEvent.click(await screen.findByText(/Нужно сопоставить с финансовым договором/))
    expect(actsApi.financialContext).toHaveBeenCalledWith('financial-1')
    expect(actsApi.context).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Финансовый договор')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Просмотреть PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать акт' })).not.toBeInTheDocument()
  })
  it('allows management to assign a document explicitly without corporate search', async () => {
    vi.mocked(actsApi.financialContext).mockResolvedValue({ ...context, contracts: [], acts: [], unassigned_contracts: context.contracts,
      financial_contracts: [{ id: 'financial-1', label: 'Договор 1' }, { id: 'financial-2', label: 'Договор 2' }] })
    financialMount()
    fireEvent.click(await screen.findByText(/Нужно сопоставить с финансовым договором/));
    vi.mocked(trustmeApi.assignFinancial).mockResolvedValue({ ...context.contracts[0], created_at: null, linked_at: '2026-11-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Сопоставить с этим договором' }))
    await waitFor(() => expect(trustmeApi.assignFinancial).toHaveBeenCalledWith('student-1', 'link-1', 'financial-1'))
    expect(screen.queryByText('Поиск TrustMe')).not.toBeInTheDocument()
  })
})
