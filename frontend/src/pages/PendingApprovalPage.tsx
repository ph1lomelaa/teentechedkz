import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, LogOut, Pencil, RefreshCw } from 'lucide-react'
import { accessRequestsApi } from '@/api/accessRequests'
import { useAuth } from '@/contexts/AuthContext'
import { AuthShell } from '@/components/auth/AuthShell'

/** Как часто сами проверяем, не открыли ли доступ. */
const POLL_MS = 15_000

/**
 * Экран для аккаунта, который заведён, но ещё не открыт администратором.
 *
 * Раньше такой человек получал 401 прямо на входе и видел только ошибку — ни
 * статуса, ни объяснения, ни возможности что-то сделать. Теперь он входит и
 * попадает сюда; дальше его не пускает гейт на бэкенде (core/deps.py).
 *
 * Экран намеренно тупиковый: ни навигации, ни ссылок вглубь. Единственные
 * действия — проверить статус ещё раз и выйти. «Ворота» без выхода — это
 * ловушка, поэтому кнопка выхода обязательна.
 */
export const PendingApprovalPage: React.FC = () => {
  const { user, logout, refreshUser } = useAuth()
  const [checking, setChecking] = useState(false)

  // Своя анкета с /join. Единственная ручка очереди, открытая ждущему
  // аккаунту (см. _PENDING_APPROVAL_ALLOWED_PATHS в core/deps.py): человек
  // должен видеть, что он о себе указал, — иначе «ждите» нечем проверить.
  const { data: request } = useQuery({
    queryKey: ['access-request', 'mine'],
    queryFn: accessRequestsApi.mine,
    retry: false,
  })

  const handleCheck = async () => {
    setChecking(true)
    try {
      // Если админ уже открыл доступ, refreshUser вернёт is_active: true —
      // и роутер сам уведёт отсюда на рабочий экран роли.
      await refreshUser()
    } finally {
      setChecking(false)
    }
  }

  // Завтра доступ открывают пачкой, и человек в этот момент смотрит на экран.
  // Без опроса он сидит на «ждите» до тех пор, пока сам не догадается нажать
  // кнопку или перезагрузить страницу.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshUser()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refreshUser])

  return (
    <AuthShell
      eyebrow="Доступ"
      title="Заявка на рассмотрении"
      description="Аккаунт создан. Администратор проверит заявку и откроет доступ — после этого вы попадёте в систему автоматически."
      hideHomeLink
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-ctl border border-white/10 bg-white/[0.03] p-4">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD400]" aria-hidden />
          <div className="min-w-0 text-sm leading-6 text-white/70">
            Обычно это занимает один рабочий день. Экран обновится сам, как
            только доступ откроют. Если ждёте дольше — напишите своему
            координатору и назовите почту, на которую оставляли заявку.
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-white/50">Имя</dt>
            <dd className="min-w-0 truncate text-right text-white">{user?.name || '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-white/50">Почта</dt>
            <dd className="min-w-0 truncate text-right text-white">{user?.email || '—'}</dd>
          </div>
          {request?.phone && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-white/50">Телефон</dt>
              <dd className="min-w-0 truncate text-right text-white">{request.phone}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-white/50">Кто вы</dt>
            <dd className="text-right text-white">
              {request?.requested_role === 'mentor' ? 'Ментор' : 'Ученик'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-white/50">Статус</dt>
            <dd className="text-right">
              {/* Цвет не единственный носитель смысла: рядом всегда слово. */}
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-[#FFD400]/30 bg-[#FFD400]/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#FFD400]">
                <Clock className="h-3 w-3" aria-hidden />
                Ожидает подтверждения
              </span>
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-ctl bg-[#FFD400] px-4 text-sm font-semibold text-black transition-colors hover:bg-[#FFD400]/90 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
            {checking ? 'Проверяем…' : 'Проверить статус'}
          </button>
          {request && (
            <Link
              to="/join"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-ctl border border-white/15 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Изменить данные
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-ctl border border-white/15 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Выйти
          </button>
        </div>
      </div>
    </AuthShell>
  )
}
