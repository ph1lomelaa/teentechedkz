import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScrollFadeNav } from './ScrollFadeNav'

function mount(metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  const { container } = render(<ScrollFadeNav aria-label="Меню"><a href="/">пункт</a></ScrollFadeNav>)
  const nav = container.querySelector('nav') as HTMLElement
  Object.defineProperty(nav, 'scrollTop', { value: metrics.scrollTop, configurable: true })
  Object.defineProperty(nav, 'clientHeight', { value: metrics.clientHeight, configurable: true })
  Object.defineProperty(nav, 'scrollHeight', { value: metrics.scrollHeight, configurable: true })
  act(() => {
    nav.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  return nav
}

describe('ScrollFadeNav', () => {
  it('всё помещается — затухания нет, пункты чёткие', () => {
    const nav = mount({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })
    expect(nav).not.toHaveAttribute('data-fade-top')
    expect(nav).not.toHaveAttribute('data-fade-bottom')
  })

  it('есть что прокручивать вниз — затухает нижний край', () => {
    const nav = mount({ scrollTop: 0, clientHeight: 400, scrollHeight: 800 })
    expect(nav).toHaveAttribute('data-fade-bottom')
    expect(nav).not.toHaveAttribute('data-fade-top')
  })

  it('дошли до конца — нижнего затухания нет, верхнее есть', () => {
    const nav = mount({ scrollTop: 400, clientHeight: 400, scrollHeight: 800 })
    expect(nav).not.toHaveAttribute('data-fade-bottom')
    expect(nav).toHaveAttribute('data-fade-top')
  })
})
