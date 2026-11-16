import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { PayDialog } from './dialogs'
import { moneyTotals, formatAmountInput, parseAmountInput } from './format'
import type { ScheduleItem } from '@/api/finance'
const api=vi.hoisted(()=>({pay:vi.fn(),previewPayment:vi.fn(),addPayment:vi.fn(),uploadReceipt:vi.fn()}))
vi.mock('@/api/finance',()=>({financeApi:api,financeKeys:{all:['finance']},PAYER_LABELS:{student:'Ученик',parent:'Родитель',other:'Другое'}}))
vi.mock('@/hooks/use-toast',()=>({toast:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const item={id:'schedule',contract_id:'c1',student_name:'Demo',kind:'main',label:'1 из 3',amount:'300',left:'200',currency:'KZT',due_date:'2026-11-01'} as ScheduleItem
const mount=()=>render(<QueryClientProvider client={new QueryClient()}><PayDialog item={item} onClose={vi.fn()}/></QueryClientProvider>)
it('says that the Notion balance is kept by the manager',()=>{
 api.previewPayment.mockResolvedValue({parts:[],advance:'0'})
 mount()
 expect(screen.getByText('Остаток в Notion обновляет менеджер.')).toBeTruthy()
})
it('allows paying more than the row and shows the advance before saving',async()=>{
 api.previewPayment.mockResolvedValue({parts:[{schedule_item_id:'schedule',kind:'main',label:'1 из 3',due_date:'2026-11-01',amount:'200',after_offer:false,closes:true,left_after:'0'}],advance:'50'})
 mount()
 fireEvent.change(screen.getByLabelText(/Сумма, KZT/),{target:{value:'250'}})
 expect(screen.getByRole('button',{name:'Сохранить оплату'})).not.toBeDisabled()
 expect(await screen.findByText(/станет авансом клиента/)).toBeTruthy()
 expect(screen.getByText(/Закроет: Основной платёж · 1 из 3|Закроет: .*1 из 3/)).toBeTruthy()
})
it('asks before saving a probable duplicate',async()=>{
 api.previewPayment.mockResolvedValue({parts:[],advance:'0'})
 api.pay.mockRejectedValueOnce({response:{status:409,data:{detail:'дубль'},headers:{'x-error-code':'DUPLICATE_PAYMENT'}}}).mockResolvedValueOnce({payment_id:'p1',advance:'0',student_name:'Demo'})
 mount()
 fireEvent.click(screen.getByRole('button',{name:'Сохранить оплату'}))
 expect(await screen.findByText(/Похоже, эта оплата уже внесена/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Всё равно добавить'}))
 await waitFor(()=>expect(api.pay).toHaveBeenLastCalledWith('schedule',expect.objectContaining({confirm_duplicate:true})))
})
it('keeps KZT and USD as separate totals',()=>{
 const text=moneyTotals([{currency:'KZT',amount:'100',left:'80'},{currency:'USD',amount:'20',left:'10'}])
 expect(text).toContain('80\u00a0₸')
 expect(text).toContain('10\u00a0USD')
 expect(text).not.toContain('90')
})

it('preserves fractional currency amounts in payment input',()=>{
 expect(parseAmountInput(formatAmountInput('1000.50'))).toBe(1000.5)
 expect(parseAmountInput('0,50')).toBe(0.5)
})
