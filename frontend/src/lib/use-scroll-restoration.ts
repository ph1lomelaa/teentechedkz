import { useEffect, useLayoutEffect, type RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Восстановление прокрутки для контейнера, который скроллится сам.
 *
 * Зачем: в CRM прокручивается не окно, а <main class="app-main"> — у него
 * overflow-y-auto. Браузер и React Router восстанавливают только окно, поэтому
 * в CRM не работало ни то, ни другое: карточка студента открывалась на той
 * высоте, где был список, а возврат к списку — на той, где закончилась
 * карточка. В кабинете этой беды нет ровно потому, что там скроллится окно и
 * браузер справляется сам.
 *
 * Правило простое: «назад» (POP) — человек возвращается к тому, что уже читал,
 * и ждёт то же место; новый экран (PUSH) — начинать сверху.
 *
 * Позиции живут в модульной Map, а не в sessionStorage: они осмысленны только
 * внутри текущего стека истории, ключи которого браузер выдаёт заново.
 */
const POSITIONS = new Map<string, number>()

// Экраны грузятся лениво (React.lazy), и в момент перехода в контейнере ещё
// заглушка нулевой высоты. Одной попытки мало — позиция схлопнулась бы в 0.
const MAX_FRAMES = 30

export function useScrollRestoration(ref: RefObject<HTMLElement>): void {
  const { key } = useLocation()
  const navigationType = useNavigationType()

  // Пишем позицию на каждую прокрутку: узнать её в момент ухода уже нельзя —
  // к тому времени отрисован новый экран и контейнер сброшен.
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const remember = () => POSITIONS.set(key, container.scrollTop)
    container.addEventListener('scroll', remember, { passive: true })
    // Снимать позицию здесь, при уходе, нельзя: очистка пассивного эффекта
    // выполняется уже после размонтирования, scrollTop у оторванного узла
    // читается нулём — и сохранённая позиция затиралась бы этим нулём ровно в
    // момент, когда она нужна. Последнее событие scroll её уже записало, а
    // если экран не прокручивали, запись и не нужна: по умолчанию верх.
    return () => container.removeEventListener('scroll', remember)
  }, [key, ref])

  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    // Значение снимаем сразу: программная установка scrollTop сама поднимает
    // событие scroll, и слушатель выше успел бы переписать сохранённое нулём.
    const target = navigationType === 'POP' ? POSITIONS.get(key) ?? 0 : 0
    if (target === 0) {
      container.scrollTop = 0
      return
    }

    let frames = 0
    let raf = 0
    const attempt = () => {
      container.scrollTop = target
      frames += 1
      if (Math.abs(container.scrollTop - target) > 1 && frames < MAX_FRAMES) {
        raf = requestAnimationFrame(attempt)
      }
    }
    attempt()
    return () => cancelAnimationFrame(raf)
  }, [key, navigationType, ref])
}
