import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StudentPipelineStatusBadge } from './StudentPipelineStatusBadge'

describe('StudentPipelineStatusBadge', () => {
  it('uses the live Notion option color when provided', () => {
    render(<StudentPipelineStatusBadge status="Активная работа" notionColor="green" />)
    expect(screen.getByText('Активная работа').closest('span')).toHaveClass('notion-tag--green')
  })

  it.each([
    ['Активная работа', 'active'],
    ['На визе', 'waiting'],
    ['На возврате', 'problem'],
    ['Работа окончена-Поступил', 'complete'],
    ['Работа окончена - Передумали', 'neutral'],
  ])('раскрашивает реальный статус Notion «%s» по смыслу', (status, tone) => {
    render(<StudentPipelineStatusBadge status={status} />)
    expect(screen.getByText(status)).toHaveAttribute('data-tone', tone)
  })
})
