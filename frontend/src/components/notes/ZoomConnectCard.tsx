import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Link2, Loader2 } from 'lucide-react'
import { integrationsApi, type ZoomStatus } from '@/api/integrations'
import { Button } from '@/components/ui/primitives/button'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * «Подключите Zoom (один раз)». Без подключения бот не зайдёт во встречу
 * аккаунта ментора — таково правило Zoom. После «Разрешить» в Zoom ментор
 * возвращается на эту же страницу.
 */
export const ZoomConnectCard: React.FC<{ status?: ZoomStatus; inWorkspace: boolean; onBeforeConnect?: () => void }> = ({ status, inWorkspace, onBeforeConnect }) => {
  const location = useLocation()
  const [connecting, setConnecting] = useState(false)

  if (status?.connected) return null

  const connect = async () => {
    onBeforeConnect?.()
    setConnecting(true)
    try {
      const { authorize_url } = await integrationsApi.zoomConnect(location.pathname + location.search)
      window.location.assign(authorize_url)
    } catch (err) {
      setConnecting(false)
      toast({ title: 'Не удалось открыть Zoom', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-4 rounded-panel border p-4',
      inWorkspace ? 'border-w-accentDim/60 bg-w-accent/10' : 'border-amber-300 bg-amber-50',
    )}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2D8CFF] text-white">
        <Link2 className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', inWorkspace ? 'text-w-ink' : 'text-p-text')}>Подключите Zoom — один раз</p>
        <p className={cn('mt-0.5 text-sm', inWorkspace ? 'text-w-muted' : 'text-p-muted')}>
          {status?.available === false
            ? 'Запись Zoom пока настраивается. Сейчас доступны встречи Google Meet и Teams.'
            : 'Zoom пускает бота только во встречи, где вы — подключённый участник. Нажмите и разрешите доступ в окне Zoom.'}
        </p>
      </div>
      {status?.available !== false && (
        <Button onClick={() => void connect()} disabled={connecting} className="shrink-0">
          {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Подключить Zoom
        </Button>
      )}
    </div>
  )
}
