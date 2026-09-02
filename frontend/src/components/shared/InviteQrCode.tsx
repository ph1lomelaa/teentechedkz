import { useEffect, useState } from 'react'
import { Loader2, QrCode } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { cn } from '@/lib/utils'

/**
 * QR персональной ссылки в Telegram-группу.
 *
 * Зачем: на живой встрече ссылку некуда переслать — общего мессенджера с
 * каждым учеником нет. Показать экран быстрее, чем искать канал доставки.
 * Текст ссылки рядом остаётся: QR его дополняет, а не заменяет.
 *
 * Картинка приходит blob'ом, а не через `<img src>`: access-токен лежит в
 * памяти JS, и браузер не приложил бы его к запросу за картинкой.
 */
export function InviteQrCode({ linkId, className }: { linkId: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setUrl(null)
    setFailed(false)
    telegramApi
      .inviteLinkQr(linkId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      // Без revoke каждая перевыпущенная ссылка оставляла бы за собой blob
      // в памяти вкладки до самой перезагрузки.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [linkId])

  if (failed) {
    // Молчаливое отсутствие QR читается как «кнопка не сработала». Ссылка
    // рядом при этом рабочая, и об этом стоит сказать прямо.
    return (
      <div className={cn('text-xs opacity-60', className)}>
        QR не загрузился — воспользуйтесь ссылкой выше
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-ctl bg-white p-2">
        {url ? (
          <img src={url} alt="QR-код приглашения в группу" className="h-full w-full" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        )}
      </div>
      <div className="min-w-0 text-xs opacity-60">
        <div className="flex items-center gap-1.5 font-semibold opacity-90">
          <QrCode className="h-3.5 w-3.5" /> Можно отсканировать
        </div>
        <p className="mt-1">Покажите экран ученику — камера телефона откроет вступление в группу.</p>
      </div>
    </div>
  )
}
