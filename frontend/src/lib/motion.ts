// Моушн-система портала/воркспейса: плавные смены состояния внутри страниц.
//
// withViewTransition оборачивает обновление React-состояния в View Transitions
// API (Chrome/Edge/Safari 18+): браузер сам кроссфейдит и анимирует перестройку
// списков — карточка, уезжающая в другую группу вкладок, не исчезает рывком.
// Без поддержки API или при prefers-reduced-motion — просто выполняет апдейт.

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => unknown
}

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Два кадра — гарантия, что React закоммитил апдейт до «нового» снимка VT. */
const twoFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )

export function withViewTransition(update: () => void): void {
  const doc = document as DocumentWithVT
  if (!doc.startViewTransition || reduceMotion()) {
    update()
    return
  }
  doc.startViewTransition(async () => {
    update()
    await twoFrames()
  })
}
