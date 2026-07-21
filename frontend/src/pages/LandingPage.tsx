import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import {
  Kanban,
  Users,
  Wallet,
  Mic,
  Send,
  Shield,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'

const STATS = [
  { value: '20+', label: 'менторов' },
  { value: '5', label: 'стран поступления' },
]

const UNIVERSITIES = [
  'Fudan University',
  'Peking University',
  'Tsinghua University',
  'Seoul National University',
  'TUM',
]

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Kanban,
    title: 'Единый пайплайн',
    desc: 'Все этапы — от первого звонка до зачисления — на одной канбан-доске. Ни один студент не потеряется.',
  },
  {
    icon: Users,
    title: 'Кабинет студента и ментора',
    desc: 'Студент видит свой прогресс, ментор — всю воронку. Без пересылки файлов и лишних созвонов.',
  },
  {
    icon: Wallet,
    title: 'Финансы под контролем',
    desc: 'Договоры, платежи и остатки — в одном дашборде. Всегда видно, кто и сколько должен.',
  },
  {
    icon: Mic,
    title: 'AI-конспекты встреч',
    desc: 'Запись превращается в транскрипт и конспект автоматически. Команда не тратит время на заметки.',
  },
  {
    icon: Send,
    title: 'Telegram-интеграция',
    desc: 'Уведомления и файлы приходят прямо в Telegram. Команда в курсе, не открывая CRM.',
  },
  {
    icon: Shield,
    title: 'Приватность по ролям',
    desc: 'Каждая роль видит только то, что ей нужно. Конфиденциальные заметки остаются внутри команды.',
  },
]

const STEPS = [
  { title: 'Заявка', desc: 'Студент оставляет заявку сам, или ментор добавляет его вручную.' },
  { title: 'Подготовка', desc: 'Документы, IELTS, мотивационное письмо — всё по чек-листу.' },
  { title: 'Подача', desc: 'Отправка в университеты и отслеживание статусов по каждой заявке.' },
  { title: 'Зачисление', desc: 'Виза, оплата и финальные документы — до самого оффера.' },
]

const FOR_MENTORS = [
  'Свои студенты, задачи и расписание — на одном экране',
  'AI-конспект после каждой встречи, без ручных заметок',
  'Уведомления о дедлайнах и статусах в Telegram',
  'Шаблоны документов и писем под рукой',
]

const FOR_OWNERS = [
  'Вся воронка целиком: на каком этапе каждый студент',
  'Финансы: договоры, платежи и остатки в одном дашборде',
  'Доступы по ролям — чувствительные данные под контролем',
  'Студенты в зоне риска видны до того, как станет поздно',
]

function scrollToId(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

export function LandingPage() {
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
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#FFD400]">
              <BeeMark className="h-5 w-5" />
            </span>
            <span className="text-sm font-black uppercase tracking-tight">
              Teen Tech <span className="text-[#FFD400]">Ed</span>
            </span>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              ['features', 'Возможности'],
              ['how', 'Как работает'],
              ['for-whom', 'Для кого'],
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
            <Link
              to="/student"
              className="text-xs tracking-wide text-white/50 transition-colors hover:text-white"
            >
              Ученикам
            </Link>
          </nav>

          <Link to="/login" className="auth-primary-button h-9 px-4 text-xs uppercase tracking-[0.1em]">
            Войти
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative px-6 pb-20 pt-32 text-center md:px-8 md:pt-44">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.07] blur-3xl" />

        <div className="relative mx-auto max-w-[1200px]">
          <h1 className="mb-6 text-[40px] font-black leading-[1.02] tracking-tight md:text-[56px]">
            Ведём студентов
            <br />
            <span className="text-[#FFD400]">от заявки до зачисления</span>
          </h1>

          <p className="mx-auto mb-10 max-w-[600px] text-lg leading-relaxed text-[#B0B0B0]">
            Пайплайн, документы, звонки и менторы — в одной системе.
          </p>

          <div className="mb-4 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/login" className="auth-primary-button h-12 px-7 text-sm">
              Войти в кабинет →
            </Link>
            <Link
              to="/join"
              className="inline-flex h-12 items-center justify-center rounded-[10px] border border-[#FFD400]/50 px-7 text-sm font-bold text-[#FFD400] transition-colors hover:border-[#FFD400] hover:bg-[#FFD400]/10"
            >
              Оставить заявку
            </Link>
          </div>

          <p className="mb-20 text-sm text-white/40">
            Для менторов: доступ откроется после одобрения администратора.{' '}
            <Link to="/student" className="font-semibold text-[#FFD400]/80 transition-colors hover:text-[#FFD400]">
              Вы ученик? Вам сюда →
            </Link>
          </p>

          <Reveal>
            <ProductMockup />
          </Reveal>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-y border-white/10 bg-white/[0.03] px-6 py-10 md:px-8">
        <div className="mx-auto max-w-[1000px]">
          <div className="mx-auto mb-8 grid max-w-[420px] grid-cols-2 gap-8">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-black tracking-tight text-white md:text-3xl">{s.value}</div>
                <div className="mt-1 text-xs uppercase tracking-widest text-white/40">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="mb-4 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-white/30">
            Студенты поступают в
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {UNIVERSITIES.map((name) => (
              <span key={name} className="text-sm font-semibold tracking-tight text-white/50">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="scroll-mt-16 px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#FFD400]">Возможности</p>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">
              Всё для работы с абитуриентами
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 100}>
                <div className="h-full rounded-xl border border-white/10 bg-[#141414] p-6 transition-colors hover:border-[#FFD400]/30">
                  <f.icon className="mb-5 h-8 w-8 text-[#FFD400]" strokeWidth={1.75} />
                  <h3 className="mb-2 text-lg font-bold tracking-tight">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="scroll-mt-16 border-t border-white/10 bg-[#111111] px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#FFD400]">Как это работает</p>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">Четыре шага до зачисления</h2>
          </Reveal>

          <div className="grid grid-cols-1 gap-10 md:grid-cols-4 md:gap-6">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 100}>
                <div className="relative">
                  <div className="mb-4 flex items-center gap-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFD400] text-sm font-black text-[#0A0A0A]">
                      {i + 1}
                    </span>
                    {i < STEPS.length - 1 && (
                      <span className="hidden h-px flex-1 bg-gradient-to-r from-[#FFD400]/50 to-white/10 md:block" />
                    )}
                  </div>
                  <h3 className="mb-2 text-lg font-bold tracking-tight">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-white/50">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FOR WHOM */}
      <section id="for-whom" className="scroll-mt-16 border-t border-white/10 px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-14 text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#FFD400]">Для кого</p>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">Каждому — своё рабочее место</h2>
          </Reveal>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[
              { title: 'Для менторов и консультантов', items: FOR_MENTORS },
              { title: 'Для управляющих и владельцев', items: FOR_OWNERS },
            ].map((col, i) => (
              <Reveal key={col.title} delay={i * 100}>
                <div className="h-full rounded-xl border border-white/10 bg-[#141414] p-8">
                  <h3 className="mb-6 text-xl font-bold tracking-tight">{col.title}</h3>
                  <ul className="space-y-4">
                    {col.items.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD400]" strokeWidth={1.75} />
                        <span className="text-sm leading-relaxed text-white/70">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-12 md:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#FFD400]">
              <BeeMark className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium tracking-tight">TeenTechEd</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a
              href="#features"
              onClick={(e) => scrollToId(e, 'features')}
              className="text-xs text-white/40 transition-colors hover:text-white"
            >
              Возможности
            </a>
            <a
              href="#how"
              onClick={(e) => scrollToId(e, 'how')}
              className="text-xs text-white/40 transition-colors hover:text-white"
            >
              Как работает
            </a>
            <Link to="/student" className="text-xs text-white/40 transition-colors hover:text-white">
              Ученикам
            </Link>
            <Link to="/join" className="text-xs text-white/40 transition-colors hover:text-white">
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

/* Стилизованный макет канбан-доски: показываем продукт до регистрации,
   не завися от актуальности реальных скриншотов. */
function ProductMockup() {
  const columns: { title: string; cards: { name: string; tags: string[] }[] }[] = [
    {
      title: 'Заявка',
      cards: [
        { name: 'Аружан С.', tags: ['Звонок 14:00'] },
        { name: 'Данияр К.', tags: ['Китай', 'Бакалавр'] },
      ],
    },
    {
      title: 'Подготовка',
      cards: [
        { name: 'Томирис Ж.', tags: ['IELTS 7.0'] },
        { name: 'Алихан Б.', tags: ['Мотив. письмо'] },
      ],
    },
    {
      title: 'Подача',
      cards: [
        { name: 'Аяулым Н.', tags: ['Fudan', 'KAIST'] },
        { name: 'Тамерлан О.', tags: ['3 заявки'] },
      ],
    },
    {
      title: 'Зачисление',
      cards: [
        { name: 'Диас М.', tags: ['Виза ✓'] },
        { name: 'Инкар А.', tags: ['Оффер 🎉'] },
      ],
    },
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
            teenteched.kz — Пайплайн
          </div>
          <div className="w-10" />
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 text-left sm:grid-cols-4 sm:p-5">
          {columns.map((col) => (
            <div key={col.title} className="rounded-lg bg-white/[0.03] p-2.5">
              <div className="mb-2.5 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                  {col.title}
                </span>
                <span className="rounded bg-[#FFD400]/15 px-1.5 text-[9px] font-black text-[#FFD400]">
                  {col.cards.length}
                </span>
              </div>
              <div className="space-y-2">
                {col.cards.map((card) => (
                  <div key={card.name} className="rounded-md border border-white/10 bg-[#1A1A1A] p-2.5">
                    <div className="text-[11px] font-semibold text-white/80">{card.name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {card.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-medium text-white/50"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function BeeMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 2.8 43 13.5v21L24 45.2 5 34.5v-21L24 2.8Z" fill="#080808" />
      <g stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m19.4 13.3-2.2-3.7M28.6 13.3l2.2-3.7" />
        <path d="M24 15.3c-4.2 0-6.5 3.5-5.8 8.2.8 5.7 5.8 11.2 5.8 11.2s5-5.5 5.8-11.2c.7-4.7-1.6-8.2-5.8-8.2Z" />
        <path d="M18.8 20.3c-5.2-3.1-9.1-1.1-8.2 4.4.8 5.1 5.3 8.5 12.5 4.1M29.2 20.3c5.2-3.1 9.1-1.1 8.2 4.4-.8 5.1-5.3 8.5-12.5 4.1M19 21.4h10M19.6 26.7h8.8" />
      </g>
    </svg>
  )
}
