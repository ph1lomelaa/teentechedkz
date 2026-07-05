import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Globe,
  Settings,
  BookOpen,
  BookText,
  CheckSquare,
  AlertTriangle,
  MessageCircle,
  ClipboardList,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

const adminNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Все студенты', path: '/students', icon: <Users className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Задачи', path: '/tasks', icon: <CheckSquare className="w-4 h-4" /> },
  { label: 'Telegram', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Статус', path: '/status-inbox', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Конфликты', path: '/migration-conflicts', icon: <AlertTriangle className="w-4 h-4" /> },
  { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
  { label: 'Настройки', path: '/settings/users', icon: <Settings className="w-4 h-4" /> },
]

const mzkManagerNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Все студенты', path: '/students', icon: <Users className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Задачи', path: '/tasks', icon: <CheckSquare className="w-4 h-4" /> },
  { label: 'Telegram', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Статус', path: '/status-inbox', icon: <ClipboardList className="w-4 h-4" /> },
  { label: 'Конфликты', path: '/migration-conflicts', icon: <AlertTriangle className="w-4 h-4" /> },
  { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
]

const leadMentorNavItems: NavItem[] = [
  { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
  { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
  { label: 'Задачи', path: '/tasks', icon: <CheckSquare className="w-4 h-4" /> },
  { label: 'Страны', path: '/countries', icon: <Globe className="w-4 h-4" /> },
]

const mentorNavItems: NavItem[] = [
  { label: 'Мои студенты', path: '/my-students', icon: <BookOpen className="w-4 h-4" /> },
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
    '/dashboard': 'Dashboard',
    '/students': 'Все студенты',
    '/students/new': 'Новый студент',
    '/my-students': 'Мои студенты',
    '/notes': 'Конспекты',
    '/countries': 'Справочник стран',
    '/finances': 'Финансы',
    '/settings/users': 'Пользователи',
    '/tasks': 'Задачи',
    '/migration-conflicts': 'Конфликты миграции',
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
  const { user } = useAuth()
  const location = useLocation()

  const navItems = user ? getNavItems(user.role) : []
  const breadcrumb = getBreadcrumb(location.pathname)

  return (
    <div className="flex h-screen overflow-hidden bg-white text-black">
      {/* Sidebar */}
      <aside className="flex flex-col w-56 min-w-[224px] shrink-0 bg-sidebar border-r border-white/10">
        {/* Logo */}
        <div className="px-5 py-6">
          <Link to="/" className="block">
            <span className="text-white font-black text-[15px] uppercase tracking-[0.22em]">
              TeenTechEd
            </span>
          </Link>
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
                  'flex items-center gap-2.5 px-5 py-2.5 text-[15px] font-medium transition-colors duration-150 border-l-2',
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

        <div className="border-t border-white/10 px-5 py-4" />
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden bg-white text-black">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-caps">
            <span className="text-gray-400">TeenTechEd</span>
            {breadcrumb && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-900 font-medium">{breadcrumb}</span>
              </>
            )}
          </div>

          <div />
        </header>

        {/* Content */}
        <main className="app-main flex-1 overflow-y-auto bg-white p-6 text-black">{children}</main>
      </div>
    </div>
  )
}
