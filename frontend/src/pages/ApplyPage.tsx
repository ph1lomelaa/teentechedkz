import { useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { publicApi } from '@/api/public'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errorMessage'
import { AuthShell } from '@/components/auth/AuthShell'

export function ApplyPage() {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    city: '',
    degree_level: 'undergraduate',
    intake_year: new Date().getFullYear() + 1,
    target_country: '',
    program_interest: '',
    message: '',
  })

  const mutation = useMutation({
    mutationFn: () => publicApi.createApplication({
      ...form,
      email: form.email || undefined,
      city: form.city || undefined,
      target_country: form.target_country || undefined,
      program_interest: form.program_interest || undefined,
      message: form.message || undefined,
    }),
  })

  if (mutation.isSuccess) {
    return (
      <AuthShell
        eyebrow="Заявка принята"
        title="Спасибо! Всё получилось"
        description="Мы получили заявку. Команда TeenTechEd свяжется с вами и после обработки выдаст доступ в личный кабинет."
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
      wide
      eyebrow="Новая заявка"
      title="Начните поступление с TeenTechEd"
      description="Заполните короткую анкету. Она попадёт в CRM, команда свяжется с вами и после обработки откроет доступ в кабинет."
    >
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              mutation.mutate()
            }}
          >
            <Field label="ФИО">
              <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Телефон">
              <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Город">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Уровень">
              <select
                value={form.degree_level}
                onChange={(e) => setForm({ ...form, degree_level: e.target.value })}
                className="h-10 w-full rounded-[10px] border px-3 text-sm"
              >
                <option value="undergraduate">Бакалавриат</option>
                <option value="foundation">Foundation</option>
                <option value="found_ug">Foundation + UG</option>
                <option value="masters">Магистратура</option>
              </select>
            </Field>
            <Field label="Год поступления">
              <Input
                type="number"
                value={form.intake_year}
                onChange={(e) => setForm({ ...form, intake_year: Number(e.target.value) })}
              />
            </Field>
            <Field label="Страна интереса">
              <Input value={form.target_country} onChange={(e) => setForm({ ...form, target_country: e.target.value })} />
            </Field>
            <Field label="Программа/услуга">
              <Input value={form.program_interest} onChange={(e) => setForm({ ...form, program_interest: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Комментарий">
                <Textarea rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </Field>
            </div>

            {mutation.isError && (
              <div className="rounded-[10px] border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300 sm:col-span-2">
                {getErrorMessage(mutation.error)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={mutation.isPending} className="auth-primary-button h-11 rounded-[10px] border-0 px-6 hover:bg-[#E9C200]">
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
