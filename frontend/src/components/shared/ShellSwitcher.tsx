import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, GraduationCap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

/**
 * Переключатель между двумя рабочими оболочками.
 *
 * Граница между ними: кабинет отвечает на вопрос «что мне сегодня делать?»
 * (scope=mine), CRM — на вопрос «что происходит в компании?» (вся база).
 * Отсюда и подписи: «Мой кабинет» против «Общая база».
 *
 * Раньше переход был несимметричным: из CRM — заметная выпадашка на логотипе,
 * а из кабинета — пункт «Вернуться в CRM» в самом низу меню, в группе
 * «СИСТЕМА». Один и тот же переход выглядел по-разному в зависимости от того,
 * с какой стороны на него смотреть. Теперь контрол один и стоит на одном месте.
 */

type Shell = 'crm' | 'workspace'

const SHELLS: { id: Shell; label: string; hint: string; to: string }[] = [
  { id: 'workspace', label: 'Мой кабинет', hint: 'Мои студенты и моя работа', to: '/workspace/my-day' },
  { id: 'crm', label: 'Общая база', hint: 'Вся компания и справочники', to: '/dashboard' },
]

export const ShellSwitcher: React.FC<{
  current: Shell
  /**
   * Как переключатель ведёт себя во флексе — решает родитель, а не он сам.
   *
   * Здесь стоял жёсткий `flex-1`. В шапке CRM это верно: там строка, и он
   * заполняет ширину рядом с кнопкой закрытия. А в боковом меню кабинета
   * контейнер колоночный, и тот же `flex-1` растягивал его по ВЫСОТЕ — меню
   * уезжало вниз, последние пункты обрезались, появлялась полоса прокрутки.
   * Один и тот же класс в двух направлениях флекса значит разное, поэтому
   * решение отдано месту вызова.
   */
  className?: string
  /** Класс фона плашки логотипа — единственное, чем оболочки отличаются визуально. */
  accentClass?: string
}> = ({ current, accentClass = 'bg-brand', className }) => {
  const { user } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Закрываем при переходе и при клике мимо — иначе меню остаётся висеть
  // поверх новой страницы.
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Обе оболочки доступны только сотрудникам. Студент сюда не попадает вовсе,
  // но проверка страхует от ссылки, которая вернёт 403.
  const canSwitch = user?.role === 'admin' || user?.role === 'mzk_manager' || user?.role === 'mentor'
  const currentShell = SHELLS.find((s) => s.id === current) ?? SHELLS[0]

  const brand = (
    <>
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-ctl', accentClass)}>
        <GraduationCap className="h-[22px] w-[22px] text-black" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block font-display text-sm font-black uppercase leading-none tracking-wider text-white">
          TEENTECHED
        </span>
        <span className="mt-1 block truncate text-[9px] uppercase tracking-[0.22em] text-white/50">
          {currentShell.label}
        </span>
      </div>
    </>
  )

  if (!canSwitch) {
    return (
      <Link
        to={currentShell.to}
        className={cn(
          'flex items-center gap-2.5 rounded-ctl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          className,
        )}
      >
        {brand}
      </Link>
    )
  }

  return (
    <div ref={boxRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Оболочка: ${currentShell.label}. Переключить`}
        className="group flex w-full items-center gap-2.5 rounded-ctl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {brand}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-white/45 transition group-hover:text-white/70',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[52px] z-30 overflow-hidden rounded-ctl border border-white/10 bg-[#1C1C1C] shadow-xl"
        >
          {SHELLS.map((shell) => {
            const active = shell.id === current
            return (
              <Link
                key={shell.id}
                to={shell.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'block px-3 py-2.5 transition hover:bg-white/[0.06]',
                  active ? 'bg-white/[0.04]' : ''
                )}
              >
                <span className={cn('block text-xs font-bold', active ? 'text-brand' : 'text-white')}>
                  {shell.label}
                </span>
                <span className="mt-0.5 block text-[10.5px] text-white/45">{shell.hint}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
