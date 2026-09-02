import { useMemo, useState } from 'react'
import type React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { GraduationCap, Users } from 'lucide-react'
import { authApi } from '@/api/auth'
import { publicApi } from '@/api/public'
import type { JoinResult } from '@/api/public'
import { AuthShell } from '@/components/auth/AuthShell'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
import { useAuth } from '@/contexts/AuthContext'
import { getErrorMessage } from '@/lib/errorMessage'
import { postLoginPath } from '@/lib/authRouting'

type Role = 'student' | 'mentor'

/**
 * Одна публичная ссылка регистрации — и для учеников, и для менторов.
 *
 * Порядок шагов не случаен: сначала роль, потом Google, потом форма. Спросить
 * роль до входа — единственный способ узнать её, не заставляя человека гадать
 * потом; а форму показывать до Google бессмысленно, потому что без
 * подтверждённой почты заявка всё равно не создаётся.
 *
 * Google здесь — единственный способ входа, и это осознанно: почты в системе
 * нет, подтвердить адрес самим нечем. Пароль-регистрация ментора осталась на
 * /join/mentor для тех, у кого Google-аккаунта нет.
 */
export function JoinPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { setSession } = useAuth()

  const [role, setRole] = useState<Role | null>(null)
  const [credential, setCredential] = useState<string | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    city: '',
    direction: '',
    code: params.get('code') ?? '',
  })

  // Код из ссылки — признак, что человека звали как ментора. Поле показываем,
  // но не прячем при ручном заходе: код могли передать текстом.
  const codeFromLink = useMemo(() => Boolean(params.get('code')), [params])

  // Настроен ли вход через Google. Спрашиваем сами, а не полагаемся на кнопку:
  // при выключенном способе она не рисуется вовсе, и на /login это правильно —
  // рядом есть пароль. Здесь пароля нет, и молча спрятанная кнопка оставила бы
  // ученика перед пустым экраном без единого слова о том, что произошло.
  const googleConfig = useQuery({
    queryKey: ['google-config'],
    queryFn: authApi.googleConfig,
    retry: false,
  })
  const googleOff = googleConfig.data?.enabled === false

  const mutation = useMutation({
    mutationFn: () =>
      publicApi.join({
        credential: credential ?? '',
        requested_role: role ?? 'student',
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        city: form.city.trim() || undefined,
        direction: form.direction.trim() || undefined,
        code: form.code.trim() || undefined,
      }),
    onSuccess: (data: JoinResult) => {
      setSession(data.user, data.access_token)
      // `pending` тоже получает сессию: экран ожидания показывает человеку его
      // же заявку, а дальше него гейт на бэкенде всё равно не пускает.
      navigate(data.status === 'active' ? postLoginPath(data.user) : '/pending', {
        replace: true,
      })
    },
  })

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (form.full_name.trim().length < 2) {
      errors.full_name = 'Укажите фамилию и имя'
    }
    // Считаем цифры, а не проверяем маску: люди вводят номер как привыкли, и
    // «8 707…» — такой же валидный ввод, как «+7 707…».
    const digits = form.phone.replace(/\D/g, '')
    if (!digits) errors.phone = 'Укажите телефон'
    else if (digits.length < 10) errors.phone = 'Телефон должен начинаться с +7 и содержать 11 цифр'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  // --- Шаг 1: кто вы -------------------------------------------------------
  if (!role) {
    return (
      <AuthShell
        eyebrow="Регистрация"
        title="Кто вы?"
        description="Выберите, как вы участвуете в программе — от этого зависит, что вы увидите внутри."
      >
        <div className="space-y-3">
          <RoleCard
            icon={<GraduationCap className="h-5 w-5" aria-hidden />}
            title="Я ученик"
            hint="Вы занимаетесь по программе TeenTechEd"
            onClick={() => setRole('student')}
          />
          <RoleCard
            icon={<Users className="h-5 w-5" aria-hidden />}
            title="Я ментор"
            hint="Вы работаете с учениками"
            onClick={() => setRole('mentor')}
          />
          <div className="pt-2 text-center">
            <Link to="/login" className="text-sm font-bold text-white/45 transition hover:text-[#FFD400]">
              Уже есть доступ? Войти
            </Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // --- Шаг 2: подтвердить почту -------------------------------------------
  if (!credential) {
    return (
      <AuthShell
        eyebrow={role === 'student' ? 'Регистрация ученика' : 'Регистрация ментора'}
        title="Подтвердите почту"
        description="Вход в систему — через Google. Так мы точно знаем, что почта ваша, и вам не придётся запоминать ещё один пароль."
      >
        <div className="space-y-5">
          {googleOff ? (
            <div className="rounded-ctl border border-[#FFD400]/25 bg-[#FFD400]/[0.08] p-4 text-sm leading-6 text-white/75">
              <p className="font-semibold text-white">Регистрация пока закрыта</p>
              <p className="mt-1">
                Вход через Google в этой системе ещё не включён.{' '}
                {role === 'mentor'
                  ? 'Заведите аккаунт по паролю или напишите координатору.'
                  : 'Напишите своему куратору — он откроет доступ вручную.'}
              </p>
            </div>
          ) : (
            <GoogleSignInButton
              divider={false}
              text="continue_with"
              onCredential={(value) => {
                setGoogleError(null)
                setCredential(value)
              }}
              onError={setGoogleError}
            />
          )}
          {googleError && <ErrorBox>{googleError}</ErrorBox>}
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => setRole(null)}
              className="font-bold text-white/45 transition hover:text-[#FFD400]"
            >
              Назад
            </button>
            {role === 'mentor' && (
              <Link to="/join/mentor" className="font-bold text-white/45 transition hover:text-[#FFD400]">
                Нет Google-аккаунта
              </Link>
            )}
            <Link to="/login" className="font-bold text-white/45 transition hover:text-[#FFD400]">
              У меня уже есть доступ
            </Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // --- Шаг 3: анкета -------------------------------------------------------
  return (
    <AuthShell
      eyebrow={role === 'student' ? 'Регистрация ученика' : 'Регистрация ментора'}
      title="Осталось представиться"
      description={
        role === 'student'
          ? 'Укажите телефон, который вы оставляли при записи, — по нему мы найдём вашу карточку и откроем кабинет сразу.'
          : 'Если куратор дал вам код, введите его — тогда доступ откроется сразу.'
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!validate()) return
          mutation.mutate()
        }}
      >
        <Field label="ФИО" error={fieldErrors.full_name}>
          <Input
            autoComplete="name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </Field>
        <Field label="Телефон" error={fieldErrors.phone}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 707 123 45 67"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>

        {role === 'student' ? (
          <>
            <Field label="Город">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Направление">
              <Input
                placeholder="Например: Computer Science"
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <Field label={codeFromLink ? 'Код приглашения' : 'Код приглашения (если есть)'}>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
        )}

        {mutation.isError && <ErrorBox>{getErrorMessage(mutation.error)}</ErrorBox>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="auth-primary-button h-11 rounded-ctl border-0 px-6 hover:bg-[#E9C200]"
          >
            {mutation.isPending ? 'Отправляем…' : 'Продолжить'}
          </Button>
          <button
            type="button"
            onClick={() => setCredential(null)}
            className="text-sm font-bold text-white/45 transition hover:text-[#FFD400]"
          >
            Назад
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

function RoleCard({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-ctl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-[#FFD400]/40 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD400]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl bg-[#FFD400]/10 text-[#FFD400]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-white">{title}</span>
        <span className="block text-xs leading-5 text-white/45">{hint}</span>
      </span>
    </button>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300"
    >
      {children}
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="auth-field-label">{label}</Label>
      {children}
      {/* Ошибка живёт под своим полем, а не в общей плашке: на телефоне общая
          плашка уезжает за экран, и человек не понимает, что именно исправлять. */}
      {error && <p className="text-xs font-medium text-red-300">{error}</p>}
    </div>
  )
}
