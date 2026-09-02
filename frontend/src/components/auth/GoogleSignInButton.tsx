import React, { useEffect, useRef, useState } from 'react'
import { authApi } from '@/api/auth'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

/** Высота кнопки Google при size: 'large'. Держим место заранее, чтобы карточка
 *  не подпрыгивала, когда кнопка наконец отрисуется. */
const BUTTON_HEIGHT = 44
/** Потолок ширины у Google; шире он всё равно не нарисует. */
const MAX_WIDTH = 400

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    ux_mode?: string
  }) => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } }
  }
}

/** Загрузить скрипт Google один раз на страницу, даже если кнопок несколько. */
function loadGsi(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
  if (existing) {
    if (window.google?.accounts?.id) return Promise.resolve()
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('gsi')))
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('gsi'))
    document.head.appendChild(script)
  })
}

type Phase = 'loading' | 'ready' | 'disabled' | 'failed'

/**
 * Кнопка «Войти через Google».
 *
 * Почему она выглядит не как остальные кнопки
 * -------------------------------------------
 * Её рисует скрипт Google, а не мы: перекрасить её в фирменный жёлтый нельзя —
 * это требование Google к брендингу, доступны только их пресеты. Поэтому задача
 * не «замаскировать под свою», а перестать выдавать за чужеродную вставку: дать
 * полную ширину вровень с полями, ровное место в сетке и подпись в нашей
 * типографике сверху.
 *
 * Место держим всегда
 * -------------------
 * Раньше блок был `display:none`, пока не отработают запрос конфига, загрузка
 * скрипта и отрисовка, — и карточка на глазах подпрыгивала. Теперь высота
 * зарезервирована с первого кадра, а на время загрузки стоит скелетон.
 *
 * Ширину меряем у контейнера, а не задаём числом: 320px были уже, чем поля
 * ввода рядом, и именно это первым бросалось в глаза.
 */
export const GoogleSignInButton: React.FC<{
  onCredential: (credential: string) => void
  onError: (message: string) => void
  /** Разделитель «или» нужен там, где рядом есть вход по паролю. */
  divider?: boolean
  text?: 'signin_with' | 'continue_with'
}> = ({ onCredential, onError, divider = true, text = 'signin_with' }) => {
  const holder = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [width, setWidth] = useState(0)

  // Колбэк Google вызывается вне React; держим последнюю версию в ref, иначе
  // кнопка, отрисованная один раз, навсегда защёлкнет первый onCredential.
  const latest = useRef({ onCredential, onError })
  latest.current = { onCredential, onError }

  // Ширина контейнера. Пока она не измерена, кнопку не рисуем: Google принимает
  // ширину только в момент renderButton и потом не пересчитывает.
  useEffect(() => {
    const node = holder.current
    if (!node) return
    const measure = () => setWidth(Math.min(Math.round(node.clientWidth), MAX_WIDTH))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!width) return
    let cancelled = false

    const setup = async () => {
      let config: { enabled: boolean; client_id: string | null }
      try {
        config = await authApi.googleConfig()
      } catch {
        if (!cancelled) setPhase('failed')
        return
      }
      if (cancelled) return
      if (!config.enabled || !config.client_id) {
        setPhase('disabled')
        return
      }

      try {
        await loadGsi()
      } catch {
        if (!cancelled) {
          setPhase('failed')
          latest.current.onError('Не удалось загрузить вход через Google')
        }
        return
      }
      if (cancelled || !holder.current || !window.google?.accounts?.id) return

      window.google.accounts.id.initialize({
        client_id: config.client_id,
        callback: (response) => {
          if (response.credential) latest.current.onCredential(response.credential)
          else latest.current.onError('Google не вернул подтверждение входа')
        },
      })
      holder.current.replaceChildren()
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'filled_black',
        size: 'large',
        width,
        text,
        shape: 'rectangular',
        logo_alignment: 'center',
        locale: 'ru',
      })
      setPhase('ready')
    }

    void setup()
    return () => {
      cancelled = true
    }
  }, [width, text])

  return (
    <div className={divider ? 'mt-6' : ''}>
      {divider && (
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-white/35">
          <span className="h-px flex-1 bg-white/10" />
          или
          <span className="h-px flex-1 bg-white/10" />
        </div>
      )}

      {/* Место под кнопку занято с первого кадра — отсюда и min-height. */}
      <div className={divider ? 'mt-4' : ''}>
        <div
          ref={holder}
          className="w-full overflow-hidden rounded-ctl"
          // Место держим, только пока кнопка ожидается. Когда способ выключен,
          // пустая полоса под сообщением выглядела бы как недогрузившийся блок.
          style={{ minHeight: phase === 'disabled' || phase === 'failed' ? 0 : BUTTON_HEIGHT }}
        >
          {phase === 'loading' && (
            <div
              className="w-full animate-pulse rounded-ctl border border-[#343434] bg-[#1C1C1C]"
              style={{ height: BUTTON_HEIGHT }}
              aria-hidden
            />
          )}
        </div>

        {/* Молча спрятанная кнопка читается как поломка, поэтому говорим прямо. */}
        {phase === 'disabled' && (
          <p className="text-center text-[13px] leading-5 text-white/45">
            Вход через Google временно недоступен
          </p>
        )}
        {phase === 'failed' && (
          <p className="text-center text-[13px] leading-5 text-white/45">
            Google не отвечает — попробуйте обновить страницу
          </p>
        )}
      </div>
    </div>
  )
}
