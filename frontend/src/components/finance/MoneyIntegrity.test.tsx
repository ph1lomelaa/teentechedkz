import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { PayDialog } from './dialogs'
import { moneyTotals, formatAmountInput, parseAmountInput } from './format'
import type { ScheduleItem } from '@/api/finance'
const pay=vi.hoisted(()=>vi.fn())
vi.mock('@/api/finance',()=>({financeApi:{pay},financeKeys:{all:['finance']}}))
vi.mock('@/hooks/use-toast',()=>({toast:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
const item={id:'schedule',student_name:'Demo',amount:'300',left:'200',currency:'USD',due_date:'2026-11-01'} as ScheduleItem
it('explains that the mark stays inside the finance desk',()=>{
 render(<QueryClientProvider client={new QueryClient()}><PayDialog item={item} onClose={vi.fn()}/></QueryClientProvider>)
 expect(screen.getByText(/Notion не меняются, ученику ничего не отправляется/)).toBeTruthy()
})
it('prevents payment above the open schedule amount',()=>{
 render(<QueryClientProvider client={new QueryClient()}><PayDialog item={item} onClose={vi.fn()}/></QueryClientProvider>)
 fireEvent.change(screen.getByLabelText(/Сумма, USD/),{target:{value:'250'}})
 expect(screen.getByRole('button',{name:'Отметить'})).toBeDisabled()
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
