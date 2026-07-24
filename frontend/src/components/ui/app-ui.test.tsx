import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppButton } from './AppButton'
import { AppInput } from './AppInput'
import { AppSelect } from './AppSelect'
import { ProgressBar } from './ProgressBar'
import { SegmentedTabs } from './SegmentedTabs'

describe('shared UI accessibility contracts', () => {
  it('exposes segmented controls as an accessible tab list', () => {
    const onChange = vi.fn()
    render(
      <SegmentedTabs
        value="all"
        onChange={onChange}
        tabs={[
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

  it('clamps and announces progress', () => {
    render(<ProgressBar value={140} label="Прогресс roadmap" showLabel={false} />)
    const progress = screen.getByRole('progressbar', { name: 'Прогресс roadmap' })
    expect(progress).toHaveAttribute('aria-valuenow', '100')
    expect(progress.firstElementChild).toHaveStyle({ width: '100%' })
  })

  it('provides fallback accessible names for form controls', () => {
    render(
      <>
        <AppInput placeholder="Найти студента" />
        <AppSelect><option>Все студенты</option></AppSelect>
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'Найти студента' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Выбор значения' })).toBeInTheDocument()
  })

  it('uses a non-submitting button type by default', () => {
    render(<AppButton>Сохранить</AppButton>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'button')
  })
})
