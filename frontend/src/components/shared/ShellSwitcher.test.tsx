import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

/**
 * Переключатель оболочек и то, как он ведёт себя во флексе.
 *
 * Ради чего тест: у корня стоял жёсткий `flex-1`. В шапке CRM это верно —
 * там строка, и он занимает ширину рядом с кнопкой закрытия. Но в боковом
 * меню кабинета контейнер колоночный, и тот же класс растягивал его по
 * ВЫСОТЕ: меню уезжало вниз, нижние пункты обрезались, появлялась полоса
 * прокрутки. Симптом выглядел как «сломалась вёрстка меню», а причина была
 * в общем компоненте, который навязывал поведение обоим родителям сразу.
 *
 * Ошибку легко вернуть одной «безобидной» правкой класса, поэтому она
 * закреплена здесь.
 */
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Админ', role: 'admin' } }),
}))

const { ShellSwitcher } = await import('./ShellSwitcher')

function renderSwitcher(props: { className?: string } = {}) {
  const { container } = render(
    <MemoryRouter>
      <ShellSwitcher current="workspace" {...props} />
    </MemoryRouter>,
  )
  return container.firstElementChild as HTMLElement
}

describe('ShellSwitcher', () => {
  it('сам по себе не растягивается — это решает родитель', () => {
    const root = renderSwitcher()
    expect(root.className).not.toMatch(/\bflex-1\b/)
  })

  it('принимает поведение от места вызова', () => {
    // Так его монтирует шапка CRM: там растягивание по ширине нужно.
    const root = renderSwitcher({ className: 'flex-1' })
    expect(root.className).toMatch(/\bflex-1\b/)
  })

  it('рисует текущую оболочку', () => {
    renderSwitcher()
    expect(screen.getByText('Мой кабинет')).toBeInTheDocument()
  })
})
