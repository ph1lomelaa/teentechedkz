import React, { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Banknote,
  Bell,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileText,
  Gauge,
  ShieldAlert,
  GraduationCap,
  Globe,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LogOut,
  Map,
  Menu,
  MessageCircle,
  MessageSquareWarning,
  ScrollText,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { usersApi, notificationsApi } from '@/api/index'
import { workspaceApi } from '@/api/workspace'
import { useWsEvent } from '@/lib/ws'
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

function getNavGroups(
  studentsNavLabel: string,
  canReturnToCrm: boolean,
  isAdminOrMzk: boolean,
  isMentor: boolean,
): NavGroup[] {
  const baseGroups: NavGroup[] = [
    {
      group: 'МОИ ДАННЫЕ',
      items: [
        { label: 'Мой день', path: '/workspace/my-day', icon: <Sun className="h-4 w-4" /> },
        { label: 'Главная', path: '/workspace', icon: <LayoutDashboard className="h-4 w-4" /> },
        { label: studentsNavLabel, path: '/workspace/students', icon: <Users className="h-4 w-4" /> },
      ],
    },
    {
      group: 'ПЛАНИРОВАНИЕ',
      items: [
        { label: 'Roadmap', path: '/workspace/roadmap', icon: <Map className="h-4 w-4" /> },
        { label: 'Задачи', path: '/workspace/tasks', icon: <CheckSquare className="h-4 w-4" /> },
        { label: 'Мои задачи', path: '/workspace/my-tasks', icon: <ListTodo className="h-4 w-4" /> },
        { label: 'Проверка', path: '/workspace/review', icon: <ClipboardCheck className="h-4 w-4" /> },
        { label: 'Встречи', path: '/workspace/meetings', icon: <CalendarDays className="h-4 w-4" /> },
        { label: 'Анкеты', path: '/workspace/questionnaires', icon: <ClipboardList className="h-4 w-4" /> },
        { label: 'Статус', path: '/workspace/status', icon: <ListChecks className="h-4 w-4" /> },
      ],
    },
    {
      group: 'МАТЕРИАЛЫ',
      items: [
        { label: 'Документы', path: '/workspace/documents', icon: <FileText className="h-4 w-4" /> },
        { label: 'Университеты', path: '/workspace/universities', icon: <GraduationCap className="h-4 w-4" /> },
        { label: 'Страны', path: '/workspace/countries', icon: <Globe className="h-4 w-4" /> },
        { label: 'Регламенты', path: '/workspace/agreements', icon: <ScrollText className="h-4 w-4" /> },
      ],
    },
    {
      group: 'КОММУНИКАЦИЯ',
      items: [
        { label: 'Чат', path: '/workspace/chat', icon: <MessageCircle className="h-4 w-4" /> },
        { label: 'Обращения', path: '/workspace/complaints', icon: <MessageSquareWarning className="h-4 w-4" /> },
        { label: 'Уведомления', path: '/workspace/notifications', icon: <Bell className="h-4 w-4" /> },
      ],
    },
  ]

  if (isAdminOrMzk) {
    baseGroups.push({
      group: 'МОТИВАЦИЯ',
      items: [
        { label: 'Возвратные кейсы', path: '/workspace/refund-cases', icon: <Banknote className="h-4 w-4" /> },
        { label: 'Инциденты безопасности', path: '/workspace/security-incidents', icon: <ShieldAlert className="h-4 w-4" /> },
        { label: 'Задачи менторов', path: '/workspace/mentor-tasks', icon: <ListTodo className="h-4 w-4" /> },
        { label: 'Чекины', path: '/workspace/checkins', icon: <CalendarCheck className="h-4 w-4" /> },
        { label: 'ОКК МЗК', path: '/workspace/mzk-quality', icon: <Gauge className="h-4 w-4" /> },
        { label: 'Вознаграждение менторов', path: '/workspace/mentor-rewards', icon: <Coins className="h-4 w-4" /> },
      ],
    })
  }

  // Ментор видит только свои этапы и штрафы — и может возразить (п.6.8).
  // Раньше право возражать было лишь в API, а сами санкции ментору не показывали.
  if (isMentor) {
    baseGroups.push({
      group: 'МОТИВАЦИЯ',
      items: [
        { label: 'Моё вознаграждение', path: '/workspace/my-rewards', icon: <Coins className="h-4 w-4" /> },
      ],
    })
  }

  if (canReturnToCrm) {
    baseGroups.push({
      group: 'СИСТЕМА',
      items: [
        { label: 'Вернуться в CRM', path: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
      ],
    })
  }

  return baseGroups
}

export const WorkspaceLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { theme } = useTheme()
  const mentorId = searchParams.get('mentor_id') || ''
  // Browsing a specific mentor's workspace (mentor_id filter + preview banner)
  // is an admin/mzk-only capability — only they can look at *someone else's* cabinet.
  const canPreviewMentor = user?.role === 'admin' || user?.role === 'mzk_manager'
  // Getting back to the CRM shell, on the other hand, is available to everyone
  // who has CRM access at all (admin, mzk_manager, and now mentor) — otherwise
  // a mentor who opens their own workspace cabinet has no way back.
  const canReturnToCrm = canPreviewMentor || user?.role === 'mentor'
  const isPreview = Boolean(mentorId)
  const studentsNavLabel = isPreview ? 'Студенты ментора' : 'Мои студенты'

  const isAdminOrMzk = user?.role === 'admin' || user?.role === 'mzk_manager'
  const navGroups = getNavGroups(studentsNavLabel, canReturnToCrm, isAdminOrMzk, user?.role === 'mentor')

  const findActiveNavItem = () => {
    for (const group of navGroups) {
      const item = group.items.find((i) =>
        i.path === '/workspace'
          ? location.pathname === i.path
          : location.pathname.startsWith(i.path)
      )
      if (item) return item
    }
    return null
  }

  const activeNavItem = findActiveNavItem()
  const crumb = activeNavItem?.path === '/workspace/students' ? studentsNavLabel : activeNavItem?.label || 'TeenTechEd'
  const { data: mentors = [] } = useQuery({
    queryKey: ['workspace', 'mentor-filter', 'users'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
    enabled: canPreviewMentor,
  })
  const selectedMentor = mentors.find((mentor) => mentor.id === mentorId)
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 50 }),
  })
  const unreadCount = notifData?.unread_count ?? 0

  // Лёгкий счётчик заявок студентов «на проверке» для бейджа в навигации:
  // поллинг раз в минуту + live-инвалидация по WS-событию заявки.
  const queryClient = useQueryClient()
  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['workspace', 'review-count'],
    queryFn: async () => (await workspaceApi.roadmapTasks({ review_status: 'pending' })).total,
    refetchInterval: 60_000,
  })
  useWsEvent('task.review_requested', () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', 'review-count'] })
  )

  const workspaceTo = (path: string) => `${path}${location.search}`
  const brandDestination = canReturnToCrm ? '/dashboard' : '/workspace'

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileNavOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileNavOpen])

  const setMentorFilter = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set('mentor_id', value)
    } else {
      next.delete('mentor_id')
    }
    setSearchParams(next, { replace: true })
  }

  const sidebar = (
    <aside aria-label="Навигация кабинета ментора" className="flex h-full w-[248px] max-w-[85vw] shrink-0 flex-col gap-1.5 border-r border-w-line bg-black px-4 py-5">
      <div className="relative flex h-full min-h-0 flex-col px-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <Link
          to={brandDestination}
          className="flex items-center gap-2.5 rounded-ctl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-w-accent"
          title={canReturnToCrm ? 'Вернуться в CRM' : 'На главную кабинета'}
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-w-accent">
            <GraduationCap className="h-[22px] w-[22px] text-black" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-display text-base font-black uppercase tracking-wider text-white">TEENTECHED</span>
            </span>
            <span className="mt-px block text-[10px] uppercase tracking-[0.22em] text-white/50">
              Education Hub
            </span>
          </div>
        </Link>

        <div className="mt-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">КАБИНЕТ</div>
        <nav aria-label="Разделы кабинета" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {navGroups.flatMap((group) => group.items).map((item) => {
            const active =
              location.pathname === item.path ||
              (item.path !== '/workspace' && location.pathname.startsWith(item.path))
            const badge =
              item.path === '/workspace/notifications'
                ? unreadCount
                : item.path === '/workspace/review'
                  ? reviewCount
                  : 0
            return (
              <Link
                key={item.path}
                to={workspaceTo(item.path)}
                className={cn(
                  'relative flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-semibold transition',
                  active
                    ? 'bg-w-accent text-black'
                    : 'text-white/65 hover:bg-[#141414] hover:text-white'
                )}
              >
                {item.icon}
                {item.label}
                {badge > 0 && (
                  <span
                    className={cn(
                      'ml-auto min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-2xs font-black',
                      active ? 'bg-black/20 text-black' : 'bg-w-accent text-black'
                    )}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-white/10 pt-3.5">
          <Link
            to="/change-password"
            className="mb-1 flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-left text-sm font-semibold text-white/65 transition hover:bg-[#141414] hover:text-white"
          >
            <KeyRound className="h-4 w-4" />
            Сменить пароль
          </Link>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-left text-sm font-semibold text-white/50 transition hover:bg-[#141414] hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="portal workspace-shell grid min-h-[100dvh] min-w-0 overflow-x-hidden bg-w-bg text-w-ink lg:grid-cols-[248px_1fr]" data-theme={theme}>
      <a href="#workspace-main" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-w-accent px-4 py-2 font-bold text-black transition focus:translate-y-0">
        Перейти к содержимому
      </a>
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>
      {mobileNavOpen && (
        <>
          <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileNavOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            {sidebar}
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-ctl border border-white/10 bg-black text-white"
              aria-label="Закрыть меню"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-w-line bg-w-bg/85 px-3 py-2.5 backdrop-blur-md sm:gap-3 sm:px-5 md:px-8 md:py-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-ctl border border-w-line bg-w-panel text-w-ink lg:hidden"
            aria-label="Открыть меню"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 truncate text-xs tracking-wide text-w-muted2">
            TeenTechEd / <b className="text-w-ink">{crumb}</b>
            <div className="mt-1 truncate text-[11.5px] text-w-muted">
              {user?.name || user?.email} · {user?.role}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ThemeToggle variant="portal" />
            <NotificationsBell variant="portal" />
            <div className="hidden items-center gap-2 rounded-full border border-w-line bg-w-panel px-2 py-1.5 sm:flex">
              <span className="max-w-[180px] truncate text-[11px] font-semibold text-w-muted">
                {(user?.role || 'mentor')} · {user?.name || user?.email || 'Пользователь'}
              </span>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-w-accent text-[11px] font-black text-black">
                {(user?.name || 'M').trim().charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        <main id="workspace-main" tabIndex={-1} className="mx-auto w-full max-w-[1180px] min-w-0 flex-1 overflow-x-hidden px-3 py-5 sm:px-5 sm:py-6 md:px-8 md:py-7">
          {isPreview && canPreviewMentor && (
            <div className="mb-5 rounded-card border border-w-accentDim/40 bg-w-accent/10 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-display text-[11px] font-black uppercase tracking-[0.22em] text-w-accentText">
                    Preview mode
                  </div>
                  <div className="mt-1 text-sm font-bold text-w-ink">
                    Вы смотрите кабинет ментора: {selectedMentor?.name || 'выбранный ментор'}
                  </div>
                  <div className="mt-1 max-w-3xl text-xs leading-5 text-w-muted">
                    Данные отфильтрованы по этому ментору. Изменения в задачах, встречах и документах выполняются от вашего аккаунта и сохраняются в общей базе. Чат выбранного ментора открыт только для просмотра, если backend помечает диалог как read-only.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMentorFilter('')}
                  className="w-fit rounded-ctl border border-w-line px-3 py-2 text-xs font-bold text-w-muted transition hover:border-w-accentDim hover:text-w-accentText"
                >
                  Сбросить preview
                </button>
              </div>
            </div>
          )}
          <React.Suspense
            fallback={(
              <div className="flex min-h-[50vh] items-center justify-center text-sm text-w-muted">
                <span className="mr-3 h-2.5 w-2.5 animate-pulse rounded-full bg-w-accent" />
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
