import { Link } from 'react-router-dom'

const TAGS = ['Пайплайн', 'Договоры', 'Менторы', 'Финансы']

const FEATURES = [
  {
    title: 'Единый пайплайн',
    desc: 'Заявка, звонок, документы, зачисление — все статусы студента в одной воронке, без разрозненных таблиц.',
  },
  {
    title: 'Кабинет студента и ментора',
    desc: 'Roadmap, задачи и встречи видны обеим сторонам в реальном времени — без лишних созвонов и пересылки файлов.',
  },
  {
    title: 'Приватность по ролям',
    desc: 'Конфиденциальные заметки и права доступа разграничены — чувствительные данные остаются внутри команды.',
  },
]

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#0A0A0A] text-white">
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#0A0A0A]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#FFD400]">
              <BeeMark className="h-5 w-5" />
            </span>
            <span className="text-sm font-black uppercase tracking-tight">
              Teen Tech <span className="text-[#FFD400]">Ed</span>
            </span>
          </div>
          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#features"
              className="text-xs tracking-wide text-white/50 transition-colors hover:text-white"
            >
              Возможности
            </a>
          </nav>
          <Link to="/login" className="auth-secondary-button h-9 px-4 text-xs font-bold uppercase tracking-[0.14em]">
            Войти
          </Link>
        </div>
      </header>

      <section className="relative px-6 pb-24 pt-32 text-center md:px-8 md:pb-28 md:pt-40">
        <div className="pointer-events-none absolute left-1/2 top-40 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.06] blur-3xl" />

        <div className="relative">
         

          <h1 className="mb-6 text-5xl font-black leading-[0.95] tracking-tight md:text-8xl">
            Ведём студентов
            <br />
            <span className="text-white/40">от заявки до зачисления</span>
          </h1>

          <p className="mx-auto mb-12 max-w-2xl text-lg font-light leading-relaxed text-white/50">
            Пайплайн, документы, звонки и менторы — в одной системе.
            <br />
            Ученики видят свой прогресс в личном кабинете, команда — воронку целиком.
          </p>

          <div className="mb-16 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/login" className="auth-primary-button h-11 px-6 text-sm font-bold">
              Войти в кабинет →
            </Link>
          </div>

          <p className="text-center text-sm text-gray-400">
            Студенты присоединяются по приглашению от менторов
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {TAGS.map((tag) => (
              <span key={tag} className="text-xs uppercase tracking-widest text-white/35">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="border-t border-white/10 px-6 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid grid-cols-1 gap-px bg-white/10 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-[#0A0A0A] p-10 transition-colors hover:bg-white/[0.03] md:p-12">
                <h3 className="mb-3 text-xl font-bold tracking-tight">{f.title}</h3>
                <p className="text-sm font-light leading-relaxed text-white/40">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-12 md:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#FFD400]">
              <BeeMark className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium tracking-tight">TeenTechEd</span>
          </div>
          <p className="text-xs text-white/30">© 2026 TeenTechEd. Платформа сопровождения студентов.</p>
        </div>
      </footer>
    </div>
  )
}

function BeeMark({ className }: { className?: string }) {
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
