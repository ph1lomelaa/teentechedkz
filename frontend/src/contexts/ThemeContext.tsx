import React, { createContext, useContext, useEffect, useState } from 'react'
import { applyThemeInstantly } from '@/lib/theme'

export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'teenteched-theme'
const LEGACY_THEME_KEYS = ['crm-theme', 'workspace-theme', 'portal-theme']

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored

  // One-time migration: CRM/Workspace/Portal used to keep independent theme
  // state, so pick up whichever legacy key was set instead of resetting
  // returning users to dark.
  let migrated: Theme = 'dark'
  for (const key of LEGACY_THEME_KEYS) {
    if (window.localStorage.getItem(key) === 'light') {
      migrated = 'light'
      break
    }
  }
  LEGACY_THEME_KEYS.forEach((key) => window.localStorage.removeItem(key))
  return migrated
}

function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  // Radix menus/dialogs render through a portal outside the themed shell div,
  // so index.css also keys off this attribute on <html>.
  root.dataset.crmTheme = theme
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    applyThemeToDocument(theme)
  }, [theme])

  const toggleTheme = () => {
    applyThemeInstantly(() => setTheme((current) => (current === 'dark' ? 'light' : 'dark')))
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
