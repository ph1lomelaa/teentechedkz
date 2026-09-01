import React, { useEffect, useRef, useState } from 'react'
import { authApi } from '@/api/auth'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

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

/**
 * Кнопка «Войти через Google».
 *
 * Рисуется только если сервер сказал, что способ настроен: без client ID
 * кнопка вела бы в тупик, а на экране входа тупик читается как «система
 * сломана», а не «способ выключен».
 *
 * Скрипт Google подгружается лениво — на экране входа, а не в бандле: он
 * нужен меньшинству посещений, и тянуть его на каждую загрузку приложения ни
 * к чему.
 */
export const GoogleSignInButton: React.FC<{
  onCredential: (credential: string) => void
  onError: (message: string) => void
}> = ({ onCredential, onError }) => {
  const holder = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  // Колбэк Google вызывается вне React; держим последнюю версию в ref, иначе
  // кнопка, отрисованная один раз, навсегда защёлкнет первый onCredential.
  const latest = useRef({ onCredential, onError })
  latest.current = { onCredential, onError }

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      let config: { enabled: boolean; client_id: string | null }
      try {
        config = await authApi.googleConfig()
      } catch {
        return // способ просто не показываем; вход по паролю остаётся
      }
      if (cancelled || !config.enabled || !config.client_id) return

      try {
        await loadGsi()
      } catch {
        if (!cancelled) latest.current.onError('Не удалось загрузить вход через Google')
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
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'filled_black',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'rectangular',
        locale: 'ru',
      })
      setEnabled(true)
    }

    void setup()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={enabled ? 'mt-6' : 'hidden'}>
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-white/35">
        <span className="h-px flex-1 bg-white/10" />
        или
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div ref={holder} className="mt-4 flex justify-center" />
    </div>
  )
}
