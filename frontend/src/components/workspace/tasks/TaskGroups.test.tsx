import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskGroups } from './TaskGroups'
import { fromDelegated } from './workItems'
const items = Array.from({ length: 5 }, (_, i) => fromDelegated({ id: `t${i}`, student_id: `s${i}`, student_name: `Студент ${i}`, task_text: `Задача ${i}`, status: 'open', created_by: 'mentor', created_at: '2026-10-01', due_date: null }))
const focus = vi.fn(), create = vi.fn()
const actions = { busyKey: null, onToggleRoadmap: vi.fn(), onApproveRoadmap: vi.fn(), onReview: vi.fn(), onDelegatedStatus: vi.fn(), onEvidence: vi.fn(), onQuestionnaire: vi.fn(), onOpen: vi.fn() }
function open(canCreate = true) { render(<MemoryRouter><TaskGroups items={items} actions={actions} sortKey="title" sortDir="asc" onSort={vi.fn()} canCreate={canCreate} onCreate={create} onFocusStudent={focus} /></MemoryRouter>) }
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('сворачивает, раскрывает все и передаёт выбранного студента в действия', () => { open(); expect(screen.getByRole('button', { name: 'Развернуть: Студент 4' })).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(screen.getByRole('button', { name: 'Развернуть все' })); expect(screen.getByRole('button', { name: 'Свернуть: Студент 4' })).toHaveAttribute('aria-expanded', 'true'); fireEvent.click(screen.getAllByRole('button', { name: 'Отдельно' })[4]); expect(focus).toHaveBeenCalledWith('s4'); fireEvent.click(screen.getAllByRole('button', { name: 'Задача' })[4]); expect(create).toHaveBeenCalledWith({ id: 's4', name: 'Студент 4' }); expect(screen.getAllByRole('link', { name: 'Карточка' })[4]).toHaveAttribute('href', '/workspace/students/s4#roadmap') })
it('не предлагает создание без права на создание', () => { open(false); expect(screen.queryByRole('button', { name: 'Задача' })).toBeNull() })
it('ближайший срок не зависит от сортировки задач', () => { const dated = [{ ...items[0], due: '2026-11-30' }, { ...items[0], id: 'later', key: 'delegated:later', due: '2026-11-01' }]; render(<MemoryRouter><TaskGroups items={dated} actions={actions} sortKey="title" sortDir="asc" onSort={vi.fn()} canCreate={false} onCreate={create} onFocusStudent={focus} /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Свернуть: Студент 0' })); expect(screen.getByText(/ближайший срок/)).toHaveTextContent('1 нояб') })
