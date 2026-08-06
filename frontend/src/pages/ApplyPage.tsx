import { useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, UserRound, GraduationCap, MessageSquareText } from 'lucide-react'
import { publicApi } from '@/api/public'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Label } from '@/components/ui/primitives/label'
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
        <div className="rounded-card border border-emerald-400/20 bg-emerald-400/10 p-5 text-center">
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
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              mutation.mutate()
            }}
          >
            <FormSection icon={<UserRound className="h-4 w-4" />} title="Контакты" description="Как с вами связаться">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ФИО" required><Input required placeholder="Имя и фамилия" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
                <Field label="Телефон" required><Input required type="tel" placeholder="+7 700 000 00 00" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="Email"><Input type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Город"><Input placeholder="Алматы" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection icon={<GraduationCap className="h-4 w-4" />} title="Поступление" description="Поможем подобрать маршрут">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Уровень поступления" required>
                  <select required value={form.degree_level} onChange={(e) => setForm({ ...form, degree_level: e.target.value })} className="h-10 w-full rounded-ctl border border-white/15 bg-white/[0.05] px-3 text-sm text-white">
                    <option value="undergraduate">Бакалавриат</option><option value="foundation">Foundation</option><option value="found_ug">Foundation + бакалавриат</option><option value="masters">Магистратура</option>
                  </select>
                </Field>
                <Field label="Планируемый год" required><Input required type="number" min={new Date().getFullYear()} max={new Date().getFullYear() + 6} value={form.intake_year} onChange={(e) => setForm({ ...form, intake_year: Number(e.target.value) })} /></Field>
                <Field label="Страна или регион"><Input placeholder="Например: Южная Корея" value={form.target_country} onChange={(e) => setForm({ ...form, target_country: e.target.value })} /></Field>
                <Field label="Что нужно подготовить"><Input placeholder="IELTS, документы, подбор вузов" value={form.program_interest} onChange={(e) => setForm({ ...form, program_interest: e.target.value })} /></Field>
              </div>
            </FormSection>
            <FormSection icon={<MessageSquareText className="h-4 w-4" />} title="Дополнительно" description="Это поможет команде подготовиться к первому разговору">
              <Field label="Комментарий"><Textarea rows={4} placeholder="Расскажите о цели, сроках или вопросе" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
            </FormSection>

            {mutation.isError && (
              <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300 sm:col-span-2">
                {getErrorMessage(mutation.error)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={mutation.isPending} className="auth-primary-button h-11 rounded-ctl border-0 px-6 hover:bg-[#E9C200]">
                {mutation.isPending ? 'Отправляем…' : <>Отправить заявку <ChevronRight className="ml-1 inline h-4 w-4" /></>}
              </Button>
              <Link to="/login" className="text-sm font-bold text-white/45 transition hover:text-[#FFD400]">
                Уже есть доступ? Войти
              </Link>
            </div>
          </form>
    </AuthShell>
  )
}

function FormSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5"><div className="mb-4 flex items-start gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFD400]/15 text-[#FFD400]">{icon}</span><div><h2 className="text-sm font-black text-white">{title}</h2><p className="mt-0.5 text-xs text-white/50">{description}</p></div></div>{children}</section>
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label className="auth-field-label">{label}{required && <span className="ml-1 text-[#FFD400]">*</span>}</Label>
      {children}
    </div>
  )
}
