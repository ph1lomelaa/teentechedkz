import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ParticipationPanel } from './ParticipationPanel'
const mocks=vi.hoisted(()=>({ tasks:vi.fn(), mentors:vi.fn(), editPlan:vi.fn(), role:'student', completeTask:vi.fn(), uncompleteTask:vi.fn() }))
vi.mock('@/api/activities',()=>({ activitiesApi:mocks }))
vi.mock('@/api/roadmap',()=>({ roadmapApi:{ completeTask:mocks.completeTask, uncompleteTask:mocks.uncompleteTask, studentTasks:vi.fn() } }))
vi.mock('@/contexts/AuthContext',()=>({ useAuth:()=>({ user:{role:mocks.role},can:()=>false }) }))
vi.mock('@/components/shared/CreateTaskDialog',()=>({ CreateTaskDialog:()=>null }))
const item={id:'p1',student_id:'s1',intake_id:'i1',status:'not_started',decision:'selected',goal:null,activity:{title:'Проект'},intake:{label:'2026'}} as any
function open(it=item){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ParticipationPanel item={it} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>)}
afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks();mocks.role='student';mocks.tasks.mockResolvedValue([]);mocks.mentors.mockResolvedValue([]);mocks.editPlan.mockResolvedValue({});mocks.completeTask.mockResolvedValue({})})
it('ученик сохраняет только свою цель и решение без состояния и назначения',async()=>{
  open();fireEvent.change(screen.getByLabelText('Чего хотите добиться'),{target:{value:'Собрать проект'}})
  fireEvent.click(screen.getByRole('button',{name:'Сохранить цель'}))
  await waitFor(()=>expect(mocks.editPlan).toHaveBeenCalledWith('p1',{goal:'Собрать проект',decision:'selected'},true))
  expect(screen.queryByLabelText('Состояние')).toBeNull()
  expect(mocks.mentors).not.toHaveBeenCalled()
})
it('показывает срок задачи и правки ментора',async()=>{
  mocks.tasks.mockResolvedValue([{id:'t1',title:'Подготовить эссе',status:'in_progress',review_status:'returned',review_comment:'Добавьте пример',due_date:'2026-10-10',expected_result:'Черновик'}])
  open();expect(await screen.findByText('Добавьте пример',{exact:false})).toBeTruthy()
  expect(screen.getByText('Нужны правки')).toBeTruthy()
  expect(screen.getByText(/дедлайн 10 окт/)).toBeTruthy()
})
it('ученик отправляет шаг на проверку и исправленный — повторно',async()=>{
  mocks.tasks.mockResolvedValue([
    {id:'t1',title:'Регистрация',status:'planned',review_status:'none',due_date:null,expected_result:''},
    {id:'t2',title:'Черновик',status:'in_progress',review_status:'returned',review_comment:'Добавьте пример',due_date:null,expected_result:''},
  ])
  open()
  fireEvent.click(await screen.findByRole('button',{name:'Отправить на проверку'}))
  await waitFor(()=>expect(mocks.completeTask).toHaveBeenCalledWith('t1'))
  fireEvent.click(screen.getByRole('button',{name:'Исправлено — отправить снова'}))
  await waitFor(()=>expect(mocks.completeTask).toHaveBeenCalledWith('t2'))
})
it('рекомендация решается кнопками, а сохранение цели не шлёт «suggested»',async()=>{
  open({...item,decision:'suggested'})
  fireEvent.click(screen.getByRole('button',{name:'Сохранить цель'}))
  await waitFor(()=>expect(mocks.editPlan).toHaveBeenCalledWith('p1',{goal:null},true))
  fireEvent.click(screen.getByRole('button',{name:'Участвую'}))
  await waitFor(()=>expect(mocks.editPlan).toHaveBeenCalledWith('p1',{goal:null,decision:'selected'},true))
})
