import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, Check, Star, X } from 'lucide-react'
import { notificationsApi } from '@/api'
import { useWsEvent } from '@/lib/ws'
import { cn } from '@/lib/utils'

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const NotificationsBell: React.FC<{ variant?: 'crm' | 'portal' }> = ({ variant = 'crm' }) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // `variant` only toggles dark-cabinet vs light-CRM styling — both the
  // student portal and the mentor workspace pass variant="portal", so the
  // actual cabinet has to be read from the current route.
  const notificationsHref = location.pathname.startsWith('/workspace') ? '/workspace/notifications' : '/portal/notifications'

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 50 }),
  })
  const items = [...(data?.data ?? [])].sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high'))
  const unread = data?.unread_count ?? 0
  const portal = variant === 'portal'

  useWsEvent('notification.new', () => queryClient.invalidateQueries({ queryKey: ['notifications'] }))

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const bulkMarkReadMutation = useMutation({
    mutationFn: (notificationIds: string[]) => notificationsApi.bulkMarkAsRead(notificationIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.delete(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAll = async () => {
    const unreadIds = items.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length > 0) {
      await bulkMarkReadMutation.mutateAsync(unreadIds)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative w-9 h-9 grid place-items-center border',
          portal
            ? 'border-w-line rounded-[11px] bg-w-panel text-w-muted hover:text-w-accentText'
            : 'border-gray-200 rounded-[5px] text-gray-500 hover:text-black'
        )}
        aria-label="Уведомления"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className={cn(
            'absolute -top-1.5 -right-1.5 text-[10px] font-bold rounded-full min-w-[17px] h-[17px] grid place-items-center px-1',
            portal ? 'bg-w-accent text-black' : 'bg-brand text-brand-ink'
          )}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={cn(
          'absolute right-0 mt-2 w-80 max-w-[90vw] border z-50 overflow-hidden',
          portal ? 'bg-w-panel border-w-line rounded-[16px]' : 'bg-white border-gray-200 rounded-[6px] shadow-lg'
        )}>
          <div className={cn('flex items-center justify-between px-3 py-2.5 border-b', portal ? 'border-w-line' : 'border-gray-100')}>
            <span className={cn('text-xs font-bold uppercase tracking-wider', portal ? 'text-w-muted' : 'text-gray-500')}>Уведомления</span>
            {unread > 0 && (
              <button onClick={markAll} className={cn('text-[11px] inline-flex items-center gap-1', portal ? 'text-w-muted hover:text-w-accentText' : 'text-gray-500 hover:text-black')}>
                <Check className="w-3 h-3" /> Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <p className={cn('text-sm p-4 text-center', portal ? 'text-w-muted' : 'text-gray-400')}>Пока нет уведомлений</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'w-full text-left px-3 py-2.5 border-b flex items-start gap-2 group cursor-pointer',
                    portal ? 'border-w-line hover:bg-w-panel2' : 'border-gray-50 hover:bg-gray-50',
                    !n.is_read && (portal ? 'bg-w-accent/10' : 'bg-brand/5')
                  )}
                  onClick={async () => {
                    if (!n.is_read) {
                      await markReadMutation.mutateAsync(n.id)
                    }
                    setOpen(false)
                    if (n.link) navigate(n.link)
                  }}
                >
                  {!n.is_read && <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', portal ? 'bg-w-accent' : 'bg-brand')} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className={cn('min-w-0 flex-1 truncate text-sm font-medium', portal ? 'text-w-ink' : 'text-gray-900')}>{n.title}</div>
                      {n.priority === 'high' && <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', portal ? 'bg-w-accent text-black' : 'bg-brand text-brand-ink')}><Star className="h-2.5 w-2.5 fill-current" />Важно</span>}
                    </div>
                    {n.body && <div className={cn('text-[12px] truncate', portal ? 'text-w-muted' : 'text-gray-500')}>{n.body}</div>}
                    <div className={cn('text-[10.5px] mt-0.5', portal ? 'text-w-muted2' : 'text-gray-400')}>{fmtWhen(n.created_at)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteMutation.mutate(n.id)
                    }}
                    className={cn('shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity', portal ? 'hover:bg-w-panel2' : 'hover:bg-gray-100')}
                  >
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
              ))
            )}
          </div>
          {portal && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate(notificationsHref)
              }}
              className="w-full border-t border-w-line py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-w-muted hover:text-w-accentText"
            >
              Все уведомления →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
