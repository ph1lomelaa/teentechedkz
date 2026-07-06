import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Globe,
  Settings,
  BookOpen,
  BookText,
  AlertTriangle,
  MessageCircle,
  ClipboardList,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

const adminNavItems: NavItem[] = [
  { label: 'Обзор', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Все студенты', path: '/students', icon: <Users className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Telegram', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Статус', path: '/status-inbox', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Риски', path: '/at-risk', icon: <AlertTriangle className="w-4 h-4" /> },
  { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
  { label: 'Настройки', path: '/settings/users', icon: <Settings className="w-4 h-4" /> },
]

const mzkManagerNavItems: NavItem[] = [
  { label: 'Обзор', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Все студенты', path: '/students', icon: <Users className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Telegram', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Статус', path: '/status-inbox', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Риски', path: '/at-risk', icon: <AlertTriangle className="w-4 h-4" /> },
  { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
]

const leadMentorNavItems: NavItem[] = [
  { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
]

const mentorNavItems: NavItem[] = [
  { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
  { label: 'Все студенты', path: '/students', icon: <Users className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Telegram', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Статус', path: '/status-inbox', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
]

function getNavItems(role: string): NavItem[] {
  switch (role) {
    case 'admin': return adminNavItems
    case 'mzk_manager': return mzkManagerNavItems
    case 'lead_mentor': return leadMentorNavItems
    case 'mentor': return mentorNavItems
    default: return []
  }
}

function getBreadcrumb(pathname: string): string {
  const map: Record<string, string> = {
    '/dashboard': 'Обзор',
    '/students': 'Все студенты',
    '/students/new': 'Новый студент',
    '/my-students': 'Мои студенты',
    '/notes': 'Конспекты',
    '/countries': 'Справочник стран',
    '/finances': 'Финансы',
    '/settings/users': 'Пользователи',
    '/at-risk': 'Зона риска',
    '/migration-conflicts': 'Зона риска',
    '/telegram-inbox': 'Telegram',
    '/status-inbox': 'Статус',
  }
  if (pathname.match(/^\/students\/[^/]+$/)) return 'Карточка студента'
  if (pathname.match(/^\/notes\/session\/[^/]+$/)) return 'Сессия конспекта'
  if (pathname.match(/^\/notes\/[^/]+$/)) return 'Конспект'
  if (pathname.match(/^\/telegram-inbox\/[^/]+$/)) return 'Чат'
  return map[pathname] || ''
}

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navItems = user ? getNavItems(user.role) : []
  const breadcrumb = getBreadcrumb(location.pathname)

  // Закрываем мобильное меню при переходе на другую страницу
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Блокируем прокрутку фона, пока открыт drawer
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [mobileOpen])

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-white text-black">
      {/* Backdrop для мобильного меню */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: drawer на мобильных/планшете-портрете, статичный от lg */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 max-w-[85vw] bg-sidebar border-r border-white/10',
          'transform transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:w-56 lg:min-w-[224px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:transition-none'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-6">
          <Link to="/" className="block">
            <span className="text-white font-black text-[15px] uppercase tracking-[0.22em]">
              TeenTechEd
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1 -mr-1 text-white/60 hover:text-white lg:hidden"
            aria-label="Закрыть меню"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-2.5 px-5 py-3 lg:py-2.5 text-[15px] font-medium transition-colors duration-150 border-l-2',
                  isActive
                    ? 'text-white border-white/80'
                    : 'text-white/65 border-transparent hover:text-white/80'
                )}
              >
                <span className={isActive ? 'text-white' : 'text-white/50'}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2.5 text-left text-[13px] font-medium text-white/60 hover:text-white/85 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-white text-black">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 md:px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-1.5 -ml-1.5 text-gray-600 hover:text-black lg:hidden"
            aria-label="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-caps min-w-0">
            <span className="text-gray-400 hidden sm:inline">TeenTechEd</span>
            {breadcrumb && (
              <>
                <span className="text-gray-300 hidden sm:inline">/</span>
                <span className="text-gray-900 font-medium truncate">{breadcrumb}</span>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="app-main flex-1 overflow-y-auto bg-white p-4 md:p-6 text-black">{children}</main>
      </div>
    </div>
  )
}
