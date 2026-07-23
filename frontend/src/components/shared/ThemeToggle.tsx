import React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

export const ThemeToggle: React.FC<{ variant?: 'crm' | 'portal' }> = ({ variant = 'crm' }) => {
  const { theme, toggleTheme } = useTheme()
  const portal = variant === 'portal'
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        'w-9 h-9 grid place-items-center border',
        portal
          ? 'border-w-line rounded-[11px] bg-w-panel text-w-muted hover:text-w-accentText'
          : 'border-gray-200 rounded-[5px] text-gray-500 hover:text-black'
      )}
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </button>
  )
}
