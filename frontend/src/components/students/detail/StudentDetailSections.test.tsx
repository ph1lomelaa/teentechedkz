// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { StudentDetailSections, AccordionItem, AccordionTrigger, AccordionContent } from './StudentDetailSections'

afterEach(cleanup)
function Address() { const loc = useLocation(); return <output data-testid="address">{loc.search}{loc.hash}</output> }
function Card({ available = ['roadmap', 'tasks', 'notes', 'documents', 'profile', 'team', 'checks'] }: { available?: string[] }) {
  return <><Address /><StudentDetailSections available={available}>
    <AccordionItem value="roadmap"><AccordionTrigger>Моя карта</AccordionTrigger><AccordionContent>Этапы карты</AccordionContent></AccordionItem>
    <AccordionItem value="tasks"><AccordionTrigger>Работа</AccordionTrigger><AccordionContent><input aria-label="Черновик задачи" defaultValue="" /></AccordionContent></AccordionItem>
    <AccordionItem value="documents"><AccordionTrigger>Файлы ученика</AccordionTrigger><AccordionContent><input aria-label="Файл ученика" type="file" /></AccordionContent></AccordionItem>
    <AccordionItem value="notes"><AccordionTrigger>Конспекты ученика</AccordionTrigger><AccordionContent>Записи встреч</AccordionContent></AccordionItem>
    <AccordionItem value="profile"><AccordionTrigger>Профиль ученика</AccordionTrigger><AccordionContent>Контакты</AccordionContent></AccordionItem>
    <AccordionItem value="notion"><AccordionTrigger>Notion</AccordionTrigger><AccordionContent>Сравнение</AccordionContent></AccordionItem>
    <AccordionItem value="responsibles"><AccordionTrigger>Специалисты</AccordionTrigger><AccordionContent>Менторы</AccordionContent></AccordionItem>
    <AccordionItem value="services"><AccordionTrigger>Услуги</AccordionTrigger><AccordionContent>Программы</AccordionContent></AccordionItem>
  </StudentDetailSections></>
}
function mount(url = '/students/s1', available?: string[]) { render(<MemoryRouter initialEntries={[url]}><Card available={available} /></MemoryRouter>) }
describe('student detail navigation', () => {
  it('opens Roadmap first and keeps profile secondary', () => {
    mount()
    expect(screen.getByRole('tab', { name: 'Roadmap' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Контакты')).toBeNull()
    expect(screen.getAllByRole('tab').at(-1)?.textContent).toBe('О студенте')
  })
  it('preserves an unsaved task when changing tabs and keeps unrelated query state', () => {
    mount('/students/s1?roadmap=r2&origin=base#tasks')
    fireEvent.change(screen.getByLabelText('Черновик задачи'), { target: { value: 'Подготовить эссе' } })
    fireEvent.click(screen.getByRole('tab', { name: 'О студенте' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Задачи и записи' }))
    expect((screen.getByLabelText('Черновик задачи') as HTMLInputElement).value).toBe('Подготовить эссе')
    expect(screen.getByTestId('address').textContent).toBe('?roadmap=r2&origin=base#tasks')
  })
  it('resolves the old Notion anchor directly into checks', () => {
    mount('/students/s1#notion-sync')
    expect(screen.getByRole('tab', { name: 'О студенте' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Сравнение')).toBeTruthy()
  })
  it('groups team, responsibility and service panels into one subsection', () => {
    mount('/students/s1#responsibles')
    expect(screen.getByText('Менторы')).toBeTruthy()
    expect(screen.getByText('Программы')).toBeTruthy()
  })
  it('makes documents directly accessible from the top row and keeps the selected file across tabs', () => {
    mount('/students/s1?origin=base#documents')
    expect(screen.getByRole('tab', { name: 'Документы' })).toHaveAttribute('aria-selected', 'true')
    const file = new File(['test'], 'transcript.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Файл ученика'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('tab', { name: 'Roadmap' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect((screen.getByLabelText('Файл ученика') as HTMLInputElement).files?.[0]).toBe(file)
    expect(screen.getByTestId('address')).toHaveTextContent('?origin=base#documents')
  })
  it('exposes notes separately from documents and tasks', () => {
    mount('/students/s1?origin=base#notes')
    expect(screen.getByRole('tab', { name: 'Конспекты' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Документы' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Задачи и записи' })).toBeVisible()
    expect(screen.getByText('Записи встреч')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Документы' }))
    expect(screen.getByText('Записи встреч')).not.toBeVisible()
    expect(screen.getByTestId('address')).toHaveTextContent('?origin=base#documents')
  })
  it('supports keyboard navigation and hides unavailable sections', () => {
    mount('/students/s1#notion', ['roadmap', 'tasks'])
    expect(screen.queryByRole('tab', { name: 'О студенте' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Roadmap' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Задачи и записи' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Черновик задачи')).toBeTruthy()
  })
})
