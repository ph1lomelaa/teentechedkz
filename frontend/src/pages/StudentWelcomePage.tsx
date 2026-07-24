import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Map,
  CheckSquare,
  CalendarDays,
  FileText,
  GraduationCap,
  MessageCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import { inviteApi, type InviteInfo } from '@/api/invite'
import { BeeMark } from '@/pages/LandingPage'

/**
 * Лендинг-приветствие для учеников: /welcome/:token
 * Сюда ведёт ссылка из приглашения. Рассказывает, что даёт кабинет,
 * и отправляет на /invite/:token задать пароль.
 */

const PORTAL_FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Map,
    title: 'Roadmap поступления',
    desc: 'Весь путь до зачисления по шагам — всегда видно, что уже сделано и что дальше.',
  },
  {
    icon: CheckSquare,
    title: 'Задачи и дедлайны',
    desc: 'Никаких «а когда сдавать IELTS?» — все задачи с датами в одном списке.',
  },
  {
    icon: CalendarDays,
    title: 'Встречи с ментором',
    desc: 'Расписание встреч и конспекты после каждой — ничего не забудется.',
  },
  {
    icon: FileText,
    title: 'Документы',
    desc: 'Паспорт, сертификаты, эссе — всё в одном месте, без потерянных файлов в чатах.',
  },
  {
    icon: GraduationCap,
    title: 'Университеты и стипендии',
    desc: 'Подборка программ и стипендий под вашу цель, со статусом по каждой заявке.',
  },
  {
    icon: MessageCircle,
    title: 'Связь с командой',
    desc: 'Вопрос ментору — прямо из кабинета или в Telegram, как удобнее.',
  },
]

const STEPS = [
  { title: 'Активируйте доступ', desc: 'Нажмите кнопку и задайте свой пароль — это займёт минуту.' },
  { title: 'Загляните в roadmap', desc: 'Ментор уже собрал ваш план поступления — посмотрите шаги.' },
  { title: 'Двигайтесь к цели', desc: 'Выполняйте задачи, ходите на встречи и следите за прогрессом.' },
]

export function StudentWelcomePage() {
  const { token = '' } = useParams()
  const [checking, setChecking] = useState(true)
  const [info, setInfo] = useState<InviteInfo | null>(null)

  useEffect(() => {
    let alive = true
    inviteApi
      .get(token)
      .then((res) => {
        if (alive) setInfo(res)
      })
      .catch(() => {
        if (alive) setInfo({ valid: false })
      })
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  const valid = info?.valid ?? false

  return (
    <div className="min-h-screen overflow-hidden bg-[#0A0A0A] text-white">
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#0A0A0A]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1000px] items-center justify-between px-6 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-ctl bg-[#FFD400]">
              <BeeMark className="h-5 w-5" />
            </span>
            <span className="text-sm font-black uppercase tracking-tight">
              Teen Tech <span className="text-[#FFD400]">Ed</span>
            </span>
          </div>
          <Link
            to="/login"
            className="text-xs font-bold uppercase tracking-[0.14em] text-white/60 transition-colors hover:text-white"
          >
            Уже есть доступ? Войти
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative px-6 pb-16 pt-32 text-center md:px-8 md:pt-40">
        <div className="pointer-events-none absolute left-1/2 top-24 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.07] blur-3xl" />

        <div className="relative mx-auto max-w-[760px]">
          <p className="mb-4 font-display text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">
            Личное приглашение
          </p>
          <h1 className="mb-6 text-4xl font-black leading-[1.05] tracking-tight md:text-5xl">
            {checking || !valid ? (
              <>
                Ваш личный кабинет
                <br />
                <span className="text-[#FFD400]">поступления готов</span>
              </>
            ) : (
              <>
                {info?.name}, ваш кабинет
                <br />
                <span className="text-[#FFD400]">поступления готов</span>
              </>
            )}
          </h1>
          <p className="mx-auto mb-10 max-w-[560px] text-lg leading-relaxed text-[#B0B0B0]">
            Ментор пригласил вас в TeenTechEd — здесь весь ваш путь к университету:
            план, задачи, документы и встречи в одном месте.
          </p>

          {!checking && !valid ? (
            <div className="mx-auto mb-6 max-w-[520px] rounded-card border border-amber-400/25 bg-amber-400/10 px-5 py-4 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <p className="text-sm leading-relaxed text-amber-100/90">
                  Ссылка недействительна или уже использована. Попросите у ментора новую —
                  или, если пароль уже задан, просто{' '}
                  <Link to="/login" className="font-bold text-[#FFD400] hover:underline">
                    войдите
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to={`/invite/${encodeURIComponent(token)}`}
                className="auth-primary-button h-12 px-8 text-sm"
              >
                Активировать доступ →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* WHAT'S INSIDE */}
      <section className="border-t border-white/10 bg-[#111111] px-6 py-20 md:px-8">
        <div className="mx-auto max-w-[1000px]">
          <h2 className="mb-10 text-center font-display text-2xl font-black leading-[1.05] tracking-tight md:text-3xl">
            Что вас ждёт внутри
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PORTAL_FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-card border border-white/10 bg-[#161616] p-6 transition-colors hover:border-[#FFD400]/30"
              >
                <f.icon className="mb-4 h-7 w-7 text-[#FFD400]" strokeWidth={1.75} />
                <h3 className="mb-2 text-base font-bold tracking-tight">{f.title}</h3>
                <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section className="border-t border-white/10 px-6 py-20 md:px-8">
        <div className="mx-auto max-w-[900px]">
          <h2 className="mb-10 text-center font-display text-2xl font-black leading-[1.05] tracking-tight md:text-3xl">
            Как начать
          </h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center md:text-left">
                <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-full bg-[#FFD400] text-sm font-black text-[#0A0A0A]">
                  {i + 1}
                </span>
                <h3 className="mb-2 text-base font-bold tracking-tight">{step.title}</h3>
                <p className="text-sm leading-relaxed text-white/50">{step.desc}</p>
              </div>
            ))}
          </div>

          {valid && (
            <div className="mt-14 text-center">
              <Link
                to={`/invite/${encodeURIComponent(token)}`}
                className="auth-primary-button h-12 px-8 text-sm"
              >
                Активировать доступ →
              </Link>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 md:px-8">
        <div className="mx-auto flex max-w-[1000px] flex-col items-center justify-between gap-4 text-center md:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-ctl bg-[#FFD400]">
              <BeeMark className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium tracking-tight">TeenTechEd</span>
          </div>
          <p className="text-xs text-white/30">
            Возникли вопросы — напишите вашему ментору.
          </p>
        </div>
      </footer>
    </div>
  )
}
