import { useEffect, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import {
  Map,
  CheckSquare,
  CalendarDays,
  FileText,
  GraduationCap,
  MessageCircle,
  MailOpen,
  KeyRound,
  Rocket,
  type LucideIcon,
} from 'lucide-react'
import { BeeMark, HeroHeadline, Reveal } from '@/pages/LandingPage'

/**
 * Публичный лендинг для учеников: /student
 * Постоянная ссылка без токена — её можно отправить любому ученику.
 * Рассказывает, что даёт кабинет, и ведёт на вход или заявку.
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

const ACCESS_STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: MailOpen,
    title: 'Получите приглашение',
    desc: 'Ментор отправит вам персональную ссылку. Ещё не работаете с нами — оставьте заявку.',
  },
  {
    icon: KeyRound,
    title: 'Активируйте доступ',
    desc: 'Откройте ссылку и задайте свой пароль — это займёт минуту.',
  },
  {
    icon: Rocket,
    title: 'Войдите и двигайтесь',
    desc: 'Roadmap уже собран ментором: выполняйте задачи и следите за прогрессом.',
  },
]

const FAQ = [
  {
    q: 'У меня нет приглашения. Как попасть в кабинет?',
    a: 'Оставьте заявку — команда TeenTechEd свяжется с вами, подберёт ментора и после обработки откроет доступ.',
  },
  {
    q: 'Ссылка-приглашение не открывается или устарела',
    a: 'Попросите у ментора новую ссылку. Если пароль уже задан — приглашение больше не нужно, просто войдите.',
  },
  {
    q: 'Забыли пароль?',
    a: 'Напишите вашему ментору или МЗК — они сбросят пароль, и вы зададите новый при входе.',
  },
]

function scrollToId(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

export function StudentLandingPage() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="min-h-screen overflow-hidden bg-[#0A0A0A] text-white">
      <header
        className={`fixed top-0 z-50 w-full transition-colors duration-300 ${
          scrolled
            ? 'border-b border-white/10 bg-[#0A0A0A]/85 backdrop-blur-md'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 md:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-ctl bg-[#FFD400]">
              <BeeMark className="h-5 w-5" />
            </span>
            <span className="text-sm font-black uppercase tracking-tight">
              Teen Tech <span className="text-[#FFD400]">Ed</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              ['inside', 'Что внутри'],
              ['access', 'Как получить доступ'],
              ['faq', 'Вопросы'],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(e) => scrollToId(e, id)}
                className="text-xs tracking-wide text-white/50 transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>

          <Link to="/login" className="auth-primary-button h-9 px-4 text-xs uppercase tracking-[0.1em]">
            Войти
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative px-4 pb-16 pt-28 text-center sm:px-6 sm:pb-20 sm:pt-32 md:px-8 md:pt-44">
        <div className="glow-pulse pointer-events-none absolute left-1/2 top-32 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.07] blur-3xl" />

        <div className="relative mx-auto max-w-[1200px]">
          <p className="mb-4 font-display text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">
            Кабинет ученика
          </p>
          <HeroHeadline
            lines={['Весь путь в университет', 'в одном кабинете']}
            accentLine={1}
          />

          <p className="mx-auto mb-8 max-w-[600px] text-base leading-relaxed text-[#B0B0B0] sm:mb-10 sm:text-lg">
            Roadmap, задачи, документы и встречи с ментором — ничего не теряется в чатах.
          </p>

          <div className="mb-4 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/login" className="auth-primary-button h-12 px-7 text-sm">
              Войти в кабинет →
            </Link>
            <Link
              to="/for-applicants"
              className="inline-flex h-12 items-center justify-center rounded-ctl border border-[#FFD400]/50 px-7 text-sm font-bold text-[#FFD400] transition-all hover:-translate-y-0.5 hover:border-[#FFD400] hover:bg-[#FFD400]/10"
            >
              Оставить заявку
            </Link>
          </div>

          <p className="mb-20 text-sm text-white/40">
            Получили ссылку-приглашение от ментора? Просто откройте её — кабинет уже ждёт.
          </p>

          <Reveal>
            <PortalMockup />
          </Reveal>
        </div>
      </section>

      {/* WHAT'S INSIDE */}
      <section id="inside" className="scroll-mt-16 border-t border-white/10 bg-[#111111] px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">Что внутри</p>
            <h2 className="font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl">
              Всё для вашего поступления
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PORTAL_FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 100}>
                <div className="h-full rounded-card border border-white/10 bg-[#161616] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#FFD400]/30">
                  <f.icon className="mb-5 h-8 w-8 text-[#FFD400]" strokeWidth={1.75} />
                  <h3 className="mb-2 text-lg font-bold tracking-tight">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOW TO GET ACCESS */}
      <section id="access" className="scroll-mt-16 border-t border-white/10 px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1000px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">Доступ</p>
            <h2 className="font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl">Как получить доступ</h2>
          </Reveal>

          <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
            {ACCESS_STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 100}>
                <div className="relative text-center">
                  <span className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-full bg-[#FFD400] text-[#0A0A0A]">
                    <step.icon className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                  {i < ACCESS_STEPS.length - 1 && (
                    <span className="absolute left-[calc(50%+20px)] right-0 top-5 hidden h-px bg-gradient-to-r from-[#FFD400]/50 to-white/10 md:block" />
                  )}
                  <h3 className="mb-2 text-lg font-bold tracking-tight">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-t border-white/10 bg-[#111111] px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[760px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 font-display text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">FAQ</p>
            <h2 className="font-display text-3xl font-black leading-[1.05] tracking-tight md:text-4xl">Частые вопросы</h2>
          </Reveal>

          <div className="space-y-4">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={i * 100}>
                <div className="rounded-card border border-white/10 bg-[#161616] p-6">
                  <h3 className="mb-2 text-base font-bold tracking-tight">{item.q}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{item.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      
      <footer className="border-t border-white/10 px-6 py-12 md:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-ctl bg-[#FFD400]">
              <BeeMark className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium tracking-tight">TeenTechEd</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link to="/" className="text-xs text-white/40 transition-colors hover:text-white">
              О платформе
            </Link>
            <Link to="/for-applicants" className="text-xs text-white/40 transition-colors hover:text-white">
              Оставить заявку
            </Link>
            <Link to="/login" className="text-xs text-white/40 transition-colors hover:text-white">
              Войти
            </Link>
          </nav>
          <p className="text-xs text-white/30">© 2026 TeenTechEd. Платформа сопровождения студентов.</p>
        </div>
      </footer>
    </div>
  )
}

/* Стилизованный макет кабинета ученика: roadmap + задачи,
   чтобы ученик увидел продукт до входа. */
function PortalMockup() {
  const roadmap = [
    { title: 'Выбор страны и программы', done: true },
    { title: 'IELTS 6.5+', done: true },
    { title: 'Мотивационное письмо', done: false, active: true },
    { title: 'Подача документов', done: false },
    { title: 'Виза и перелёт', done: false },
  ]
  const tasks = [
    { title: 'Черновик эссе до пятницы', tag: 'Дедлайн 25.07' },
    { title: 'Загрузить сертификат IELTS', tag: 'Документы' },
    { title: 'Встреча с ментором', tag: 'Чт 16:00' },
  ]

  return (
    <div className="relative mx-auto max-w-[1000px] [perspective:1600px]">
      <div className="pointer-events-none absolute -inset-x-10 bottom-0 top-10 rounded-full bg-[#FFD400]/[0.06] blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#121212] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.85)] [transform:rotateX(3deg)]">
        <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          </div>
          <div className="mx-auto rounded-md bg-white/[0.06] px-4 py-1 text-[10px] tracking-wide text-white/40">
            teenteched.kz — Мой кабинет
          </div>
          <div className="w-10" />
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 text-left sm:grid-cols-2 sm:p-5">
          <div className="rounded-lg bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Roadmap
              </span>
              <span className="rounded bg-[#FFD400]/15 px-1.5 text-[9px] font-black text-[#FFD400]">
                2 / 5
              </span>
            </div>
            <div className="space-y-2">
              {roadmap.map((step) => (
                <div
                  key={step.title}
                  className={`flex items-center gap-2.5 rounded-md border p-2.5 ${
                    step.active
                      ? 'border-[#FFD400]/40 bg-[#FFD400]/[0.07]'
                      : 'border-white/10 bg-[#1A1A1A]'
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-black ${
                      step.done
                        ? 'bg-[#FFD400] text-[#0A0A0A]'
                        : step.active
                          ? 'border border-[#FFD400] text-[#FFD400]'
                          : 'border border-white/20 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      step.done ? 'text-white/40 line-through' : step.active ? 'text-white/90' : 'text-white/60'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Задачи на неделю
              </span>
              <span className="rounded bg-[#FFD400]/15 px-1.5 text-[9px] font-black text-[#FFD400]">
                {tasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.title} className="rounded-md border border-white/10 bg-[#1A1A1A] p-2.5">
                  <div className="text-[11px] font-semibold text-white/80">{task.title}</div>
                  <div className="mt-1.5">
                    <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-medium text-white/50">
                      {task.tag}
                    </span>
                  </div>
                </div>
              ))}
              <div className="rounded-md border border-dashed border-[#FFD400]/30 p-2.5 text-center text-[10px] font-semibold text-[#FFD400]/70">
                + конспект последней встречи готов
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
