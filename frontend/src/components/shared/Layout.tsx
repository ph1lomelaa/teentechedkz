import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Settings,
  BookOpen,
  BookText,
  AlertTriangle,
  MessageCircle,
  Route,
  GraduationCap,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Globe,
  BarChart3,
  BookMarked,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

interface NavGroup {
  group: string
  items: NavItem[]
}

const adminNavGroups: NavGroup[] = [
  {
    group: 'МОИ ДАННЫЕ',
    items: [
      { label: 'Обзор', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
    ],
  },
  {
    group: 'БАЗА ДАННЫХ',
    items: [
      { label: 'Общая база', path: '/students', icon: <Users className="w-4 h-4" /> },
      { label: 'Риски', path: '/at-risk', icon: <AlertTriangle className="w-4 h-4" /> },
    ],
  },
  {
    group: 'РАБОТА',
    items: [
      { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
      { label: 'Чаты', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
    ],
  },
  {
    group: 'СПРАВОЧНИКИ',
    items: [
      { label: 'Университеты', path: '/universities', icon: <GraduationCap className="w-4 h-4" /> },
      { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
      { label: 'База знаний', path: '/knowledge-base', icon: <BookMarked className="w-4 h-4" /> },
    ],
  },
  {
    group: 'АДМИНИСТРАЦИЯ',
    items: [
      { label: 'Статистика', path: '/statistics', icon: <BarChart3 className="w-4 h-4" /> },
      { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
      { label: 'Roadmap', path: '/roadmap-templates', icon: <Route className="w-4 h-4" /> },
      { label: 'Настройки', path: '/settings/users', icon: <Settings className="w-4 h-4" /> },
    ],
  },
]

const mzkManagerNavGroups: NavGroup[] = [
  {
    group: 'МОИ ДАННЫЕ',
    items: [
      { label: 'Обзор', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
    ],
  },
  {
    group: 'БАЗА ДАННЫХ',
    items: [
      { label: 'Общая база', path: '/students', icon: <Users className="w-4 h-4" /> },
      { label: 'Риски', path: '/at-risk', icon: <AlertTriangle className="w-4 h-4" /> },
    ],
  },
  {
    group: 'РАБОТА',
    items: [
      { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
      { label: 'Чаты', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
    ],
  },
  {
    group: 'СПРАВОЧНИКИ',
    items: [
      { label: 'Университеты', path: '/universities', icon: <GraduationCap className="w-4 h-4" /> },
      { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
      { label: 'База знаний', path: '/knowledge-base', icon: <BookMarked className="w-4 h-4" /> },
    ],
  },
  {
    group: 'АДМИНИСТРАЦИЯ',
    items: [
      { label: 'Статистика', path: '/statistics', icon: <BarChart3 className="w-4 h-4" /> },
      { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
      { label: 'Roadmap', path: '/roadmap-templates', icon: <Route className="w-4 h-4" /> },
      { label: 'Настройки', path: '/settings/users', icon: <Settings className="w-4 h-4" /> },
    ],
  },
]

const mentorNavGroups: NavGroup[] = [
  {
    group: 'МОИ ДАННЫЕ',
    items: [
      { label: 'Обзор', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
    ],
  },
  {
    group: 'БАЗА ДАННЫХ',
    items: [
      { label: 'Общая база', path: '/students', icon: <Users className="w-4 h-4" /> },
    ],
  },
  {
    group: 'РАБОТА',
    items: [
      { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
      { label: 'Чаты', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
    ],
  },
  {
    group: 'СПРАВОЧНИКИ',
    items: [
      { label: 'База знаний', path: '/knowledge-base', icon: <BookMarked className="w-4 h-4" /> },
    ],
  },
]

function getNavGroups(role: string): NavGroup[] {
  switch (role) {
    case 'admin': return adminNavGroups
    case 'mzk_manager': return mzkManagerNavGroups
    case 'mentor': return mentorNavGroups
    default: return []
  }
}

function getBreadcrumb(pathname: string): string {
  const map: Record<string, string> = {
    '/dashboard': 'Обзор',
    '/students': 'Общая база студентов',
    '/students/new': 'Новый студент',
    '/my-students': 'Мои студенты',
    '/notes': 'Конспекты',
    '/countries': 'Справочник стран',
    '/statistics': 'Статистика',
    '/finances': 'Финансы',
    '/settings/users': 'Пользователи',
    '/roadmap-templates': 'Roadmap-шаблоны',
    '/knowledge-base': 'База знаний',
    '/universities': 'Университеты',
    '/at-risk': 'Зона риска',
    '/migration-conflicts': 'Зона риска',
    '/telegram-inbox': 'Чаты',
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
  const [modeOpen, setModeOpen] = useState(false)
  const { theme } = useTheme()

  const navGroups = user ? getNavGroups(user.role) : []
  const breadcrumb = getBreadcrumb(location.pathname)

  // Закрываем мобильное меню при переходе на другую страницу
  useEffect(() => {
    setMobileOpen(false)
    setModeOpen(false)
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
    <div data-theme={theme} className="crm-shell flex h-[100dvh] overflow-hidden">
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
          'lg:static lg:z-auto lg:w-[248px] lg:min-w-[248px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:transition-none'
        )}
      >
        {/* Logo / mode switcher */}
        <div className="relative flex items-center justify-between px-4 py-5 border-b border-white/10">
          <button
            type="button"
            onClick={() => setModeOpen((v) => !v)}
            className="group flex items-center gap-2.5 text-left flex-1 min-w-0 rounded-ctl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-expanded={modeOpen}
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-brand">
              <GraduationCap className="w-[22px] h-[22px] text-black" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-white font-display text-sm font-black uppercase tracking-wider block leading-none">
                TEENTECHED
              </span>
              <span className="block mt-1 text-[9px] uppercase tracking-[0.22em] text-white/50">
                CRM
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-white/45 transition group-hover:text-white/70 shrink-0" />
          </button>
          {modeOpen && (
            <div className="absolute left-4 right-4 top-[68px] z-20 overflow-hidden rounded-ctl border border-white/10 bg-[#1C1C1C] shadow-xl">
              <Link
                to="/dashboard"
                onClick={() => setModeOpen(false)}
                className="block border-b border-white/10 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-white/[0.06]"
              >
                Общие данные / CRM
              </Link>
              <Link
                to="/workspace"
                onClick={() => setModeOpen(false)}
                className="block px-3 py-2.5 text-xs font-bold text-brand transition hover:bg-white/[0.06]"
              >
                Кабинет ментора
              </Link>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1 -mr-1 text-white/60 hover:text-white lg:hidden ml-2"
            aria-label="Закрыть меню"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto py-4">
          {navGroups.flatMap((group) => group.items).map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-2.5 mx-3 px-3 py-2.5 rounded-ctl text-[14px] font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-brand text-black'
                    : 'text-white/65 hover:bg-white/[0.06] hover:text-white/85'
                )}
              >
                <span className={isActive ? 'text-black' : 'text-white/50'}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-white/10 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1">
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-left text-sm font-medium text-white/50 transition hover:bg-white/[0.06] hover:text-white/85"
          >
            <LogOut className="w-4 h-4" />
            Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="crm-content flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="crm-header flex items-center gap-3 border-b px-4 py-4 shrink-0 md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="crm-muted p-1.5 -ml-1.5 hover:text-brand lg:hidden"
            aria-label="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-caps min-w-0">
            <span className="crm-muted-secondary hidden sm:inline">TeenTechEd</span>
            {breadcrumb && (
              <>
                <span className="crm-muted-secondary hidden sm:inline">/</span>
                <span className="font-medium truncate">{breadcrumb}</span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationsBell />
          </div>
        </header>

        {/* Content */}
        <main className="app-main flex-1 overflow-y-auto p-4 md:p-6">
          <React.Suspense
            fallback={(
              <div className="flex min-h-[50vh] items-center justify-center text-sm crm-muted">
                <span className="mr-3 h-2.5 w-2.5 animate-pulse rounded-full bg-brand" />
                Загрузка…
              </div>
            )}
          >
            {children}
          </React.Suspense>
        </main>
      </div>
    </div>
  )
}
