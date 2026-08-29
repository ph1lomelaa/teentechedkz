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
  Globe,
  BarChart3,
  BookMarked,
  MessageSquareWarning,
  ListChecks,
  Banknote,
  CalendarCheck,
  ListTodo,
  ScrollText,
  Gauge,
  Award,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { ShellSwitcher } from '@/components/shared/ShellSwitcher'
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

// Admin, mzk_manager and mentor all see the same CRM surface — the only
// exceptions (Статистика, Настройки, and the import/sync actions living
// inside individual pages) stay admin-only, appended below for admin alone.
const baseNavGroups: NavGroup[] = [
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
      { label: 'Мои задачи', path: '/my-tasks', icon: <ListTodo className="w-4 h-4" /> },
      { label: 'Конспекты', path: '/notes', icon: <BookText className="w-4 h-4" /> },
      { label: 'Чаты', path: '/telegram-inbox', icon: <MessageCircle className="w-4 h-4" /> },
      { label: 'Статусы', path: '/status-inbox', icon: <ListChecks className="w-4 h-4" /> },
      { label: 'Обращения', path: '/complaints', icon: <MessageSquareWarning className="w-4 h-4" /> },
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
      { label: 'Финансы', path: '/finances', icon: <DollarSign className="w-4 h-4" /> },
      { label: 'Roadmap', path: '/roadmap-templates', icon: <Route className="w-4 h-4" /> },
    ],
  },
]

const ADMIN_ONLY_ITEMS: NavItem[] = [
  // Все write-эндпоинты регламентов — AdminOnly, поэтому и пункт админский.
  { label: 'Регламенты', path: '/agreements', icon: <ScrollText className="w-4 h-4" /> },
  { label: 'Статистика', path: '/statistics', icon: <BarChart3 className="w-4 h-4" /> },
  { label: 'Настройки', path: '/settings/users', icon: <Settings className="w-4 h-4" /> },
]

// Refund-case endpoints are admin/mzk only, so the nav entry must be too —
// a mentor following it would land on a page that 403s immediately.
// То же и у двух разделов ниже: ОКК показывает МЗК только его собственный балл,
// вознаграждения ведут админ и МЗК.
// Подписи двух разделов зависят от роли: «Чекины» — это сводка по команде, а не
// своя отметка (личный чекин живёт баннером в кабинете), а «ОКК МЗК» для админа
// раздел управления, для самого МЗК-менеджера — его собственный балл.
function staffOnlyItems(role: string): NavItem[] {
  return [
    { label: 'Задачи менторов', path: '/mentor-tasks', icon: <ListTodo className="w-4 h-4" /> },
    { label: 'Чекины команды', path: '/checkins', icon: <CalendarCheck className="w-4 h-4" /> },
    { label: 'Возвраты', path: '/refund-cases', icon: <Banknote className="w-4 h-4" /> },
    {
      label: role === 'admin' ? 'ОКК МЗК' : 'Моя оценка ОКК',
      path: '/mzk-quality',
      icon: <Gauge className="w-4 h-4" />,
    },
    { label: 'Вознаграждения менторов', path: '/mentor-rewards', icon: <Award className="w-4 h-4" /> },
  ]
}

function getNavGroups(role: string): NavGroup[] {
  if (role !== 'admin' && role !== 'mzk_manager' && role !== 'mentor') return []
  const isStaff = role === 'admin' || role === 'mzk_manager'
  return baseNavGroups.map((group) => {
    if (group.group !== 'АДМИНИСТРАЦИЯ') return group
    return {
      ...group,
      items: [
        ...group.items,
        ...(isStaff ? staffOnlyItems(role) : []),
        ...(role === 'admin' ? ADMIN_ONLY_ITEMS : []),
      ],
    }
  })
}

// Роль нужна ровно затем, чтобы крошка и пункт меню назывались одинаково:
// у «ОКК МЗК» подпись зависит от того, кто смотрит.
function getBreadcrumb(pathname: string, role: string): string {
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
    '/status-inbox': 'Статусы студентов',
    '/complaints': 'Обращения',
    '/mentor-tasks': 'Задачи менторов',
    '/checkins': 'Чекины команды',
    '/my-tasks': 'Мои задачи',
    '/refund-cases': 'Возвратные кейсы',
    '/agreements': 'Регламенты',
    '/mzk-quality': role === 'admin' ? 'ОКК МЗК' : 'Моя оценка ОКК',
    '/mentor-rewards': 'Вознаграждения менторов',
  }
  if (pathname.match(/^\/universities\/[^/]+$/)) return 'Университет'
  if (pathname.match(/^\/countries\/[^/]+$/)) return 'Страна'
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
  const { theme } = useTheme()

  const navGroups = user ? getNavGroups(user.role) : []
  const breadcrumb = getBreadcrumb(location.pathname, user?.role ?? '')

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
    <div data-theme={theme} className="crm-shell flex h-[100dvh] min-w-0 overflow-hidden">
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
        {/* Логотип + переключатель оболочек (общий с кабинетом) */}
        <div className="relative flex items-center justify-between px-4 py-5 border-b border-white/10">
          <ShellSwitcher current="crm" accentClass="bg-brand" />
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
        <nav className="flex-1 overflow-y-auto py-4">
          {navGroups.map((group, groupIndex) => (
            <div key={group.group}>
              <div
                className={cn(
                  'mx-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35',
                  groupIndex > 0 && 'pt-4'
                )}
              >
                {group.group}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
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
              </div>
            </div>
          ))}
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
        <header className="crm-header flex min-h-14 items-center gap-2 border-b px-3 py-3 shrink-0 sm:gap-3 sm:px-4 md:px-6 md:py-4">
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
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <NotificationsBell />
          </div>
        </header>

        {/* Content */}
        <main className="app-main flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1180px]">
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
          </div>
        </main>
      </div>
    </div>
  )
}
