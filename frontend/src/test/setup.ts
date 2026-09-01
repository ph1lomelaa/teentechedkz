import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom не реализует matchMedia, а на неё опираются экраны, уважающие
// prefers-reduced-motion (AuthShell и далее). Без заглушки такой компонент
// падает при рендере — и тест сообщает не о том, что сломалось.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom отдаёт localStorage не всегда: в прогоне из нескольких файлов его на
// window просто нет, и тест падал на localStorage.clear() — при том что в
// одиночку тот же файл проходил. Продукт от этого не страдает (useLocalState
// заворачивает каждое обращение в try/catch и молча живёт без хранилища), но
// проверять сохранение фильтров без хранилища нечем.
if (typeof window.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
  })
}
