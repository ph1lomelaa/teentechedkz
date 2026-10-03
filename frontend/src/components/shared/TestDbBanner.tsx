import { useEffect } from 'react'

/** Фронт запущен против не-основного локального бэкенда (VITE_LOCAL_API_PORT,
 * например сид-базы на 8099). На обычном запуске переменной нет — плашки нет. */
export const isTestDbBuild = (): boolean => {
  const port = import.meta.env.VITE_LOCAL_API_PORT
  return Boolean(port) && port !== '8001'
}

/** Тонкая плашка поверх любой страницы: тестовые данные нельзя перепутать с
 * настоящими. Цвет — брендовый токен с чёрным текстом, одинаково читается в
 * обеих темах; клики она пропускает. */
export function TestDbBanner() {
  const active = isTestDbBuild()
  useEffect(() => {
    if (!active) return
    const previous = document.title
    document.title = `[ТЕСТ] ${previous}`
    return () => {
      document.title = previous
    }
  }, [active])
  if (!active) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex h-4 items-center justify-center bg-brand text-[10px] font-black uppercase leading-none tracking-[0.2em] text-black"
    >
      Тестовая база · порт {import.meta.env.VITE_LOCAL_API_PORT}
    </div>
  )
}
