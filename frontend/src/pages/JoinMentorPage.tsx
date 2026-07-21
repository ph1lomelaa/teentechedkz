import { useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { publicApi } from '@/api/public'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errorMessage'
import { AuthShell } from '@/components/auth/AuthShell'

export function JoinMentorPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    password_confirm: '',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => publicApi.mentorSignup({
      name: form.name,
      email: form.email,
      phone: form.phone || undefined,
      password: form.password,
    }),
  })

  if (mutation.isSuccess) {
    return (
      <AuthShell
        eyebrow="Заявка принята"
        title="Осталось дождаться одобрения"
        description="Аккаунт создан, но пока неактивен. Администратор проверит заявку и откроет доступ — после этого вы сможете войти со своим email и паролем."
      >
        <div className="rounded-[16px] border border-emerald-400/20 bg-emerald-400/10 p-5 text-center">
          <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-300" />
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/" className="auth-secondary-button h-11 px-5 text-sm font-bold">
              На главную
            </Link>
            <Link to="/login" className="auth-primary-button h-11 px-5 text-sm">
              Войти
            </Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="Заявка ментора"
      title="Присоединяйтесь к команде"
      description="Заполните форму — администратор одобрит заявку и откроет доступ в систему."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (form.password !== form.password_confirm) {
            setLocalError('Пароли не совпадают')
            return
          }
          if (form.password.length < 8) {
            setLocalError('Пароль должен быть минимум 8 символов')
            return
          }
          setLocalError(null)
          mutation.mutate()
        }}
      >
        <Field label="ФИО">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Телефон">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Пароль">
          <Input
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Повторите пароль">
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={form.password_confirm}
            onChange={(e) => setForm({ ...form, password_confirm: e.target.value })}
          />
        </Field>

        {(localError || mutation.isError) && (
          <div className="rounded-[10px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {localError ?? getErrorMessage(mutation.error)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="auth-primary-button h-11 rounded-[10px] border-0 px-6 hover:bg-[#E9C200]"
          >
            {mutation.isPending ? 'Отправка…' : 'Отправить заявку'}
          </Button>
          <Link to="/login" className="text-sm font-bold text-white/45 transition hover:text-[#FFD400]">
            Уже есть доступ? Войти
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="auth-field-label">{label}</Label>
      {children}
    </div>
  )
}
