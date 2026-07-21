import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Map,
  CheckSquare,
  CalendarDays,
  ScrollText,
  StickyNote,
  MessageCircle,
  GraduationCap,
  Globe,
  User,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  FileText,
  ClipboardList,
  Bell,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { notificationsApi } from '@/api'
import { applyThemeInstantly } from '@/lib/theme'

type Theme = 'dark' | 'light'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

interface NavGroup {
  group: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    group: 'МОЙ ПУТЬ',
    items: [
      { label: 'Главная', path: '/portal', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
      { label: 'Мой roadmap', path: '/portal/roadmap', icon: <Map className="w-[18px] h-[18px]" /> },
      { label: 'Задачи', path: '/portal/tasks', icon: <CheckSquare className="w-[18px] h-[18px]" /> },
      { label: 'Встречи', path: '/portal/meetings', icon: <CalendarDays className="w-[18px] h-[18px]" /> },
      { label: 'Анкеты', path: '/portal/questionnaires', icon: <ClipboardList className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    group: 'МАТЕРИАЛЫ',
    items: [
      { label: 'Конспекты', path: '/portal/notes', icon: <ScrollText className="w-[18px] h-[18px]" /> },
      { label: 'Заметки', path: '/portal/important-notes', icon: <StickyNote className="w-[18px] h-[18px]" /> },
      { label: 'Документы', path: '/portal/documents', icon: <FileText className="w-[18px] h-[18px]" /> },
      { label: 'Университеты', path: '/portal/universities', icon: <GraduationCap className="w-[18px] h-[18px]" /> },
      { label: 'Страны', path: '/portal/countries', icon: <Globe className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    group: 'КОММУНИКАЦИЯ',
    items: [
      { label: 'Чат', path: '/portal/chat', icon: <MessageCircle className="w-[18px] h-[18px]" /> },
      { label: 'Уведомления', path: '/portal/notifications', icon: <Bell className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    group: 'АККАУНТ',
    items: [
      { label: 'Профиль', path: '/portal/profile', icon: <User className="w-[18px] h-[18px]" /> },
    ],
  },
]

function isActivePath(current: string, path: string): boolean {
  if (path === '/portal') return current === '/portal'
  return current === path || current.startsWith(path)
}

function initials(name: string | undefined): string {
  if (!name) return 'С'
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

function breadcrumbFor(path: string): string {
  for (const group of navGroups) {
    const found = group.items.find((n) => isActivePath(path, n.path))
    if (found) return found.label
  }
  return 'Кабинет'
}

export const StudentPortalLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('portal-theme') as Theme) || 'dark'
  )

  useEffect(() => {
    localStorage.setItem('portal-theme', theme)
  }, [theme])

  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [mobileOpen])

  const toggleTheme = () => {
    applyThemeInstantly(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'))
  }

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 50 }),
  })
  const unreadCount = notifData?.unread_count ?? 0

  const sidebar = (
    <>
      <div className="flex items-center gap-3 px-2 pt-1.5 pb-5">
        <div className="w-[38px] h-[38px] rounded-[10px] bg-brand grid place-items-center shrink-0">
          <GraduationCap className="w-[22px] h-[22px] text-black" strokeWidth={2.2} />
        </div>
        <div>
          <h1 className="font-display text-white text-[16px] font-black tracking-[0.06em] leading-none">
            TeenTechEd
          </h1>
          <span className="block mt-1 text-[10px] tracking-[0.22em] uppercase text-white/40">
            Кабинет
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto p-1 text-white/50 hover:text-white lg:hidden"
          aria-label="Закрыть меню"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {navGroups.flatMap((group) => group.items).map((item) => {
          const active = isActivePath(location.pathname, item.path)
          const badge = item.path === '/portal/notifications' ? unreadCount : 0
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-[11px] text-[14px] font-semibold transition-colors',
                active ? 'bg-brand text-black' : 'text-white/55 hover:bg-white/[0.06] hover:text-white'
              )}
            >
              <span className={active ? 'text-black' : 'text-white/45'}>{item.icon}</span>
              {item.label}
              {badge > 0 && (
                <span
                  className={cn(
                    'ml-auto min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-black',
                    active ? 'bg-black/20 text-black' : 'bg-brand text-black'
                  )}
                >
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-3">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[12.5px] font-medium text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
        <div className="flex items-center gap-2.5 px-2 py-2 mt-1">
          <div className="w-8 h-8 rounded-full grid place-items-center text-[12px] font-extrabold text-black shrink-0 bg-gradient-to-br from-brand to-[#8a7400]">
            {initials(user?.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-[12.5px] font-semibold truncate">{user?.name}</div>
            <div className="text-white/40 text-[10.5px]">Студент</div>
          </div>
          <button onClick={() => logout()} className="text-white/40 hover:text-white p-1" aria-label="Выйти" title="Выйти">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="portal min-h-[100dvh] relative" data-theme={theme}>
      {/* Yellow radial blur glow background */}
      <div className="pointer-events-none absolute left-1/2 top-20 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-brand/[0.05] blur-3xl" />

      <div className="lg:grid lg:grid-cols-[248px_1fr] min-h-[100dvh] relative z-10">
        {/* mobile backdrop */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
        )}

        {/* sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] bg-black border-r border-[#2A2A2A] px-4 py-5 flex flex-col',
            'transform transition-transform duration-200 lg:transform-none',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
            'lg:sticky lg:top-0 lg:h-[100dvh] lg:w-auto'
          )}
        >
          {sidebar}
        </aside>

        {/* main */}
        <div className="flex flex-col min-w-0 bg-p-bg text-p-text">
          <header className="sticky top-0 z-20 flex items-center gap-4 px-5 md:px-8 py-3.5 border-b border-p-line bg-p-bg/80 backdrop-blur-md">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1.5 -ml-1.5 text-p-muted hover:text-p-text lg:hidden"
              aria-label="Открыть меню"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-[12px] text-p-muted2 tracking-[0.04em] min-w-0 truncate">
              TeenTechEd <span className="text-p-muted2/60">/</span>{' '}
              <b className="text-p-text font-semibold">{breadcrumbFor(location.pathname)}</b>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <NotificationsBell variant="portal" />
              <button
                onClick={toggleTheme}
                className="w-[38px] h-[38px] rounded-[11px] bg-p-panel border border-p-line grid place-items-center text-p-text hover:border-brand-dim transition-colors"
                aria-label="Сменить тему"
              >
                {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
              </button>
            </div>
          </header>

          <main className="flex-1 px-5 md:px-8 py-7 md:py-8">
            <React.Suspense
              fallback={(
                <div className="flex min-h-[50vh] items-center justify-center text-sm text-p-muted">
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
    </div>
  )
}
