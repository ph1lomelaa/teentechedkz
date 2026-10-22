import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'

function Probe() {
  const { theme, toggleTheme } = useTheme()
  return <button onClick={toggleTheme}>{theme}</button>
}

afterEach(() => vi.restoreAllMocks())

describe('theme with restricted browser storage', () => {
  it('renders and switches theme when accessing localStorage is denied', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'dark' }))
    expect(screen.getByRole('button', { name: 'light' })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('keeps rendering when the storage quota is exhausted', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
