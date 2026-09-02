import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, CalendarDays, CheckSquare, Clock, FileText, GraduationCap,
  LayoutDashboard, LogOut, Map, MessageCircle, Pencil, RefreshCw, Send, User,
} from 'lucide-react'
import { accessRequestsApi } from '@/api/accessRequests'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

/** Как часто сами проверяем, не открыли ли доступ. */
const POLL_MS = 15_000

/**
 * Разделы кабинета — те же, что в StudentPortalLayout, но неактивные.
 *
 * Показываем их специально: человек должен видеть, куда он попал и что его
 * ждёт, а не запертую дверь. Ссылками они не становятся — за ними всё равно
 * 403 от гейта (core/deps.py), и клик в никуда читался бы как поломка.
 */
const PREVIEW_SECTIONS = [
  { label: 'Главная', icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { label: 'Мой roadmap', icon: <Map className="h-[18px] w-[18px]" /> },
  { label: 'Мои заявки', icon: <Send className="h-[18px] w-[18px]" /> },
  { label: 'Задачи', icon: <CheckSquare className="h-[18px] w-[18px]" /> },
  { label: 'Встречи', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
  { label: 'Документы', icon: <FileText className="h-[18px] w-[18px]" /> },
  { label: 'Университеты', icon: <GraduationCap className="h-[18px] w-[18px]" /> },
  { label: 'Чат', icon: <MessageCircle className="h-[18px] w-[18px]" /> },
  { label: 'Уведомления', icon: <Bell className="h-[18px] w-[18px]" /> },
  { label: 'Профиль', icon: <User className="h-[18px] w-[18px]" /> },
]

function initials(name?: string | null): string {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Аккаунт заведён, но ещё не привязан к карточке.
 *
 * Почему это оболочка кабинета, а не отдельная страница
 * ----------------------------------------------------
 * Раньше здесь была тупиковая страница на чёрном фоне: человек проходил
 * регистрацию и упирался в экран, который выглядел как отказ. Разница между
 * «вас не пустили» и «вы внутри, идёт проверка» — вся в оформлении, и она
 * решает, напишет ли человек куратору в панике.
 *
 * Данных здесь по-прежнему нет и быть не может: карточки у него ещё нет, а
 * значит нет ни roadmap, ни задач, ни ментора. Показываем разделы неактивными —
 * это честно: они появятся, когда админ привяжет карточку.
 *
 * Гейт на бэкенде не ослаблен: сюда доходят только `/auth/me`, выход и своя
 * заявка (`_PENDING_APPROVAL_ALLOWED_PATHS` в core/deps.py). Чужих данных на
 * этом экране нет ни одной строки.
 */
export const PendingApprovalPage: React.FC = () => {
  const { user, logout, refreshUser } = useAuth()
  const { theme } = useTheme()
  const [checking, setChecking] = useState(false)

  const { data: request } = useQuery({
    queryKey: ['access-request', 'mine'],
    queryFn: accessRequestsApi.mine,
    retry: false,
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      await refreshUser()
    } finally {
      setChecking(false)
    }
  }

  // Доступ открывают пачкой, и человек в этот момент смотрит на экран. Без
  // опроса он сидит здесь, пока сам не догадается перезагрузить страницу.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshUser()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refreshUser])

  const isStudent = request?.requested_role !== 'mentor'

  return (
    <div className="portal relative min-h-[100dvh] min-w-0 overflow-x-hidden" data-theme={theme}>
      <div className="pointer-events-none absolute left-1/2 top-20 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-p-accent/[0.05] blur-3xl" />

      <div className="relative z-10 min-h-[100dvh] lg:grid lg:grid-cols-[248px_1fr]">
        <aside className="hidden flex-col border-r border-[#2A2A2A] bg-black px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-[100dvh]">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-ctl bg-p-accent text-[15px] font-black text-black">
              T
            </span>
            <div>
              <h1 className="font-display text-[16px] font-black leading-none tracking-[0.06em] text-white">
                TeenTechEd
              </h1>
              <span className="mt-1 block text-[10px] uppercase tracking-[0.22em] text-white/40">
                Кабинет
              </span>
            </div>
          </div>

          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
            {isStudent ? 'Меню студента' : 'Меню'}
          </div>
          <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto" aria-hidden>
            {PREVIEW_SECTIONS.map((item) => (
              <span
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-ctl px-3 py-2.5 text-[14px] font-semibold text-white/20"
                title="Появится после подтверждения"
              >
                <span className="text-white/15">{item.icon}</span>
                {item.label}
              </span>
            ))}
          </nav>

          <div className="mt-auto border-t border-white/10 pt-3">
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-3 rounded-ctl px-3 py-2.5 text-left text-sm font-semibold text-white/55 transition hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col bg-p-bg text-p-text">
          <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-p-line bg-p-bg/80 px-3 py-2.5 backdrop-blur-md sm:gap-3 sm:px-5 md:px-8 md:py-3.5">
            <div className="min-w-0 truncate text-[12px] tracking-[0.04em] text-p-muted2">
              TeenTechEd <span className="text-p-muted2/60">/</span>{' '}
              <b className="font-semibold text-p-text">Подтверждение доступа</b>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-p-line bg-p-panel px-2 py-1.5 sm:flex">
                <span className="max-w-[160px] truncate text-[11px] font-semibold text-p-muted">
                  {user?.name || 'Пользователь'}
                </span>
                <span className="grid h-6 w-6 place-items-center rounded-full bg-p-accent text-[11px] font-black text-black">
                  {initials(user?.name) || '?'}
                </span>
              </div>
              <button
                onClick={() => logout()}
                className="rounded-ctl px-2 py-1.5 text-[12px] font-semibold text-p-muted hover:text-p-text lg:hidden"
              >
                Выйти
              </button>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-3 py-5 sm:px-5 sm:py-7 md:px-8 md:py-8">
            <div className="mx-auto max-w-2xl space-y-5">
              <section className="rounded-card border border-p-accent/25 bg-p-accent/[0.07] p-5">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-5 w-5 shrink-0 text-p-accent" aria-hidden />
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-p-text">Вы в системе, идёт проверка</h2>
                    <p className="mt-1.5 text-sm leading-6 text-p-muted">
                      {isStudent
                        ? 'Мы не нашли вас в базе по телефону — куратор сверит данные вручную и откроет кабинет. Обычно это занимает до одного рабочего дня.'
                        : 'Заявка отправлена. Администратор проверит её и откроет доступ — обычно в течение рабочего дня.'}
                      {' '}Разделы слева включатся сами, страницу перезагружать не нужно.
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-card border border-p-line bg-p-panel p-5">
                <h3 className="text-[11px] font-black uppercase tracking-[0.14em] text-p-muted2">
                  Что вы о себе указали
                </h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <Row label="Имя" value={request?.full_name || user?.name} />
                  <Row label="Почта" value={user?.email} />
                  <Row label="Телефон" value={request?.phone} />
                  {request?.city && <Row label="Город" value={request.city} />}
                  {request?.direction && <Row label="Направление" value={request.direction} />}
                  <Row
                    label="Кто вы"
                    value={request ? (isStudent ? 'Ученик' : 'Ментор') : undefined}
                  />
                </dl>

                {isStudent && (
                  <p className="mt-4 text-xs leading-5 text-p-muted2">
                    Если телефон здесь отличается от того, что вы оставляли при записи, —
                    исправьте его, и доступ откроется автоматически.
                  </p>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleCheck}
                    disabled={checking}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-ctl bg-p-accent px-4 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} aria-hidden />
                    {checking ? 'Проверяем…' : 'Проверить сейчас'}
                  </button>
                  {request && (
                    <Link
                      to="/join"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-ctl border border-p-line px-4 text-sm font-semibold text-p-text transition-colors hover:bg-p-bg"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                      Изменить данные
                    </Link>
                  )}
                </div>
              </section>

              <p className="text-xs leading-5 text-p-muted2">
                Если ждёте дольше рабочего дня — напишите своему куратору и назовите почту,
                на которую регистрировались: {user?.email}
              </p>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-p-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-p-text">{value || '—'}</dd>
    </div>
  )
}
