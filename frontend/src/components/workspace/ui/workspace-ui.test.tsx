import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceButton } from './WorkspaceButton'
import { WorkspaceInput } from './WorkspaceInput'
import { WorkspaceProgressBar } from './WorkspaceProgressBar'
import { WorkspaceSegmentedTabs } from './WorkspaceSegmentedTabs'
import { WorkspaceSelect } from './WorkspaceSelect'

describe('workspace UI accessibility contracts', () => {
  it('exposes segmented controls as an accessible tab list', () => {
    const onChange = vi.fn()
    render(
      <WorkspaceSegmentedTabs
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: 'Все' },
          { value: 'telegram', label: 'Telegram' },
        ]}
      />,
    )

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Все' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Telegram' }))
    expect(onChange).toHaveBeenCalledWith('telegram')
  })

  it('clamps and announces roadmap progress', () => {
    render(<WorkspaceProgressBar value={140} />)
    const progress = screen.getByRole('progressbar', { name: 'Прогресс roadmap' })
    expect(progress).toHaveAttribute('aria-valuenow', '100')
    expect(progress.firstElementChild).toHaveStyle({ width: '100%' })
  })

  it('provides fallback accessible names for form controls', () => {
    render(
      <>
        <WorkspaceInput placeholder="Найти студента" />
        <WorkspaceSelect><option>Все студенты</option></WorkspaceSelect>
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'Найти студента' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Выбор значения' })).toBeInTheDocument()
  })

  it('uses a non-submitting button type by default', () => {
    render(<WorkspaceButton>Сохранить</WorkspaceButton>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'button')
  })
})
