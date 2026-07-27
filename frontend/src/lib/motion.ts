// Моушн-система портала/воркспейса: плавные смены состояния внутри страниц.
//
// withViewTransition оборачивает обновление React-состояния в View Transitions
// API (Chrome/Edge/Safari 18+): браузер сам кроссфейдит перестройку списков —
// карточка, уезжающая в другую группу вкладок, не исчезает рывком.
// Без поддержки API или при prefers-reduced-motion — просто выполняет апдейт.
//
// ВАЖНО (источник бага с ~2с зависанием): пока выполняется callback
// startViewTransition, браузер приостанавливает отрисовку, и requestAnimationFrame
// НЕ наступает — ждать rAF внутри нельзя, это замораживает страницу до таймаута.
// Правильный паттерн: flushSync для синхронных апдейтов + один setTimeout(0)-хоп,
// чтобы успели закоммититься асинхронные (оптимистичные патчи кэша react-query).
// Таймеры и микротаски во время заморозки работают — задержка единицы миллисекунд.
import { flushSync } from 'react-dom'

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => unknown
}

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function withViewTransition(update: () => void): void {
  const doc = document as DocumentWithVT
  if (!doc.startViewTransition || reduceMotion()) {
    update()
    return
  }
  doc.startViewTransition(async () => {
    flushSync(update)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}
