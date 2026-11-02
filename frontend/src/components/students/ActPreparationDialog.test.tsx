import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { actsApi, type ContractInspection } from '@/api/acts'
import { ActPreparationDialog } from './ActPreparationDialog'
import { actToday, inferTemplate } from './actTemplates'
vi.mock('@/api/acts', async original => ({ ...await original<typeof import('@/api/acts')>(), actsApi:{ inspect:vi.fn(),preview:vi.fn(),create:vi.fn(),update:vi.fn(),generate:vi.fn(),saveProfile:vi.fn(),addServiceQuote:vi.fn() } }))
const services = [{id:'career-source',name:'Профориентация',category:'career',text:'Представление о возможных карьерных перспективах',page:19,reference:'Приложение №1, стр. 19',excerpt:'Представление о возможных карьерных перспективах',confirmed_price:{amount:'50000',currency:'KZT' as const}},
 {id:'ielts-source',name:'Подготовка IELTS',category:'ielts',text:'проведение учебных занятий и подготовку к Listening',page:2,reference:'Договор, п. 1.5 стр. 2',excerpt:'проведение учебных занятий и подготовку к Listening'}]
const inspection: ContractInspection = { status:3,fingerprint:'hash',services,company_signature_available:true,fields:{student_name:'Тест Студент',customer_name:'Тест Родитель',executor_name:'ТОО ТинТэкЭд',executor_representative:'директора Жұман Б.Б.',executor_basis:'Устава',contract_number:'671',contract_date:'2026-07-28',city:'Алматы'},sources:{},conflicts:{},missing:[],service_hints:{},pages:[],suggested_contract_number:'671',signers:[],applications:[] }
function show(extra: Partial<ContractInspection> = {}) { vi.mocked(actsApi.inspect).mockResolvedValue({ ...structuredClone(inspection), ...extra }); render(<QueryClientProvider client={new QueryClient()}><ActPreparationDialog studentId="student" studentName="Тест Студент" contract={{id:'link',name:'Договор',number:'474',status:3,short_url:'testlink',signers:[]}} initial={null} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>) }
beforeEach(() => {vi.resetAllMocks();vi.mocked(actsApi.inspect).mockResolvedValue(structuredClone(inspection));vi.mocked(actsApi.create).mockResolvedValue({id:'draft'} as Awaited<ReturnType<typeof actsApi.create>>);vi.mocked(actsApi.preview).mockResolvedValue(new Blob(['pdf']))})
it('combines contract-backed services and derives the act kind from them', async () => {
 show()
 fireEvent.click(await screen.findByRole('checkbox',{name:/^Профориентация/}))
 fireEvent.click(screen.getByRole('checkbox',{name:/^Подготовка IELTS/}))
 fireEvent.click(screen.getByRole('button',{name:'Далее'}))
 expect(screen.queryByLabelText('Вид акта')).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText(/^С$/),{target:{value:'2026-08-01'}})
 fireEvent.change(screen.getByLabelText(/^По$/),{target:{value:'2026-08-31'}})
 expect(screen.getByRole('checkbox',{name:/Подпись и печать/})).toBeChecked()
 fireEvent.click(screen.getByRole('checkbox',{name:/Проверено/}))
 fireEvent.click(screen.getByRole('button',{name:'Создать акт'}))
 await waitFor(() => expect(actsApi.create).toHaveBeenCalledWith('student',expect.objectContaining({template:'stages',company_signature:true,lines:[expect.objectContaining({result:services[0].text,contract_service_id:'career-source',source_fingerprint:'hash'}),expect.objectContaining({result:services[1].text,contract_service_id:'ielts-source'})]})))
 expect(actsApi.generate).toHaveBeenCalledWith('draft')
})
it('infers the act kind from service categories', () => {
 expect(inferTemplate(['ielts'],false)).toBe('ielts')
 expect(inferTemplate(['portfolio','ielts'],false)).toBe('stages')
 expect(inferTemplate(['essays','applications'],false)).toBe('applications')
 expect(inferTemplate(['portfolio','offer'],false)).toBe('offer')
 expect(inferTemplate(['ielts'],true)).toBe('admission')
})
it('defaults the period end and act date to today and explains a wrong date under the field', async () => {
 show()
 fireEvent.click(await screen.findByRole('checkbox',{name:/^Подготовка IELTS/}))
 fireEvent.click(screen.getByRole('button',{name:'Далее'}))
 expect(screen.getByLabelText(/^С$/)).toHaveValue('')
 expect(screen.getByLabelText(/^По$/)).toHaveValue(actToday())
 expect(screen.getByLabelText(/^Дата акта/)).toHaveValue(actToday())
 fireEvent.change(screen.getByLabelText(/^С$/),{target:{value:'2026-08-01'}})
 fireEvent.change(screen.getByLabelText(/^По$/),{target:{value:'2099-01-01'}})
 expect(screen.getByText('Дата акта не может быть раньше окончания периода')).toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Создать акт'})).toBeDisabled()
})
it('does not invent a price for a partial act and prefills the finance total for the whole contract', async () => {
 show({ contract_amount:'1800000', contract_currency:'KZT' })
 fireEvent.click(await screen.findByRole('checkbox',{name:/^Подготовка IELTS/}))
 fireEvent.click(screen.getByRole('button',{name:'Далее'}))
 expect(screen.getByRole('checkbox',{name:/Указать стоимость/})).not.toBeChecked()
 fireEvent.click(screen.getByRole('button',{name:'Изменить услуги'}))
 fireEvent.click(screen.getByRole('checkbox',{name:/^Профориентация/}))
 fireEvent.click(screen.getByRole('button',{name:'Далее'}))
 expect(screen.getByRole('checkbox',{name:/Указать стоимость/})).toBeChecked()
 expect(screen.getByLabelText(/Общая стоимость/)).toHaveValue('1800000')
 expect(screen.getByText(/из раздела «Финансы»/)).toBeInTheDocument()
})
it('requires an existing admission result for a final act', async () => {
 show();fireEvent.click(await screen.findByRole('checkbox',{name:/^Профориентация/}));fireEvent.click(screen.getByRole('button',{name:'Далее'}))
 fireEvent.click(screen.getByRole('checkbox',{name:/Итоговый акт/}))
 expect(screen.getByText(/Сначала зафиксируйте зачисление/)).toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Создать акт'})).toBeDisabled()
})

it('opens with selection only and preserves the chosen services when going back', async () => {
 show()
 const next = screen.getByRole('button',{name:'Далее'})
 expect(next).toBeDisabled()
 expect(screen.queryByRole('button',{name:'Создать акт'})).not.toBeInTheDocument()
 expect(screen.queryByTitle('Предпросмотр акта PDF')).not.toBeInTheDocument()
 fireEvent.click(await screen.findByRole('checkbox',{name:/^Профориентация/}))
 fireEvent.click(next)
 expect(screen.getByText('Выбранные услуги · 1')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Изменить услуги'}))
 expect(screen.getByRole('checkbox',{name:/^Профориентация/})).toBeChecked()
 expect(screen.queryByLabelText(/^С$/)).not.toBeInTheDocument()
})

it('marks services already covered by a ready act instead of offering them again', async () => {
 const ready = { id:'ready-1', status:'ready', supersedes_id:null, snapshot:{ contract_link_id:'link', act_date:'2026-10-01', lines:[{ contract_service_id:'career-source' }] } } as unknown as import('@/api/acts').ActRecord
 render(<QueryClientProvider client={new QueryClient()}><ActPreparationDialog studentId="student" studentName="Тест Студент" contract={{id:'link',name:'Договор',number:'474',status:3,short_url:'testlink',signers:[]}} initial={null} previousActs={[ready]} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>)
 expect(await screen.findByText('Уже оформлено: акт от 01.10.2026')).toBeInTheDocument()
 expect(screen.queryByRole('checkbox',{name:/^Профориентация/})).not.toBeInTheDocument()
 expect(screen.getByRole('checkbox',{name:/^Подготовка IELTS/})).toBeEnabled()
})
