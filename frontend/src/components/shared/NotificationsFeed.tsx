import React from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Star, X } from 'lucide-react'
import { notificationsApi } from '@/api'
import { cn } from '@/lib/utils'
import { useLocalState } from '@/lib/use-local-state'

const PAGE_SIZE = 30

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type Filter = 'all' | 'unread'

export const NotificationsFeed: React.FC<{ variant: 'portal' | 'workspace' }> = ({ variant }) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const w = variant === 'workspace'
  const [filter, setFilter] = useLocalState<Filter>(`${variant}:notifications:filter`, 'all')
  const [offset, setOffset] = React.useState(0)

  React.useEffect(() => setOffset(0), [filter])

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'feed', filter, offset],
    queryFn: () => notificationsApi.list({ unread_only: filter === 'unread', limit: PAGE_SIZE, offset }),
  })

  const items = data?.data ?? []
  const total = data?.total ?? 0
  const unreadCount = data?.unread_count ?? 0
  const canLoadMore = offset + items.length < total

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markAsRead(id),
    onSuccess: invalidate,
  })
  const bulkMarkReadMutation = useMutation({
    mutationFn: (ids: string[]) => notificationsApi.bulkMarkAsRead(ids),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: invalidate,
  })

  const markAll = async () => {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id)
    if (unreadIds.length > 0) await bulkMarkReadMutation.mutateAsync(unreadIds)
  }

  return (
    <div className="w-full animate-fade-in">
      <p className={cn('font-display text-[11px] font-black uppercase tracking-[0.24em]', w ? 'text-w-accentText' : 'text-brand')}>Кабинет</p>
      <h1 className={cn('mt-2 mb-6 font-display text-[32px] font-black tracking-tight', w ? 'text-w-ink' : 'text-p-text')}>Уведомления</h1>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className={cn('inline-flex rounded-[12px] border p-1', w ? 'border-w-line bg-w-panel' : 'border-p-line bg-p-panel')}>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-lg px-4 py-2 text-[12.5px] font-bold transition-colors',
              filter === 'all'
                ? (w ? 'bg-w-accent text-black' : 'bg-brand text-black')
                : (w ? 'text-w-muted hover:text-w-ink' : 'text-p-muted hover:text-p-text')
            )}
          >
            Все · {total}
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={cn(
              'rounded-lg px-4 py-2 text-[12.5px] font-bold transition-colors',
              filter === 'unread'
                ? (w ? 'bg-w-accent text-black' : 'bg-brand text-black')
                : (w ? 'text-w-muted hover:text-w-ink' : 'text-p-muted hover:text-p-text')
            )}
          >
            Непрочитанные · {unreadCount}
          </button>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAll}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold transition-colors',
              w ? 'border-w-line bg-w-panel text-w-muted hover:text-w-ink' : 'border-p-line bg-p-panel text-p-muted hover:text-p-text'
            )}
          >
            <Check className="h-3.5 w-3.5" /> Прочитать все
          </button>
        )}
      </div>

      {isLoading && offset === 0 ? (
        <p className={cn('text-sm', w ? 'text-w-muted' : 'text-p-muted')}>Загрузка…</p>
      ) : items.length === 0 ? (
        <div className={cn('rounded-[16px] border p-8 text-center', w ? 'border-w-line bg-w-panel' : 'border-p-line bg-p-panel')}>
          <div className={cn('mx-auto grid h-11 w-11 place-items-center rounded-[13px]', w ? 'bg-w-accent/15' : 'bg-brand/15')}>
            <Bell className={cn('h-5 w-5', w ? 'text-w-accentText' : 'text-brand')} />
          </div>
          <h2 className={cn('mt-4 text-base font-extrabold', w ? 'text-w-ink' : 'text-p-text')}>
            {filter === 'unread' ? 'Непрочитанных уведомлений нет' : 'Уведомлений пока нет'}
          </h2>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {items.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'group flex cursor-pointer items-start gap-3 rounded-[13px] border p-3.5 transition-colors',
                  w ? 'border-w-line bg-w-panel2' : 'border-p-line bg-p-panel2',
                  !n.is_read && (w ? 'bg-w-accent/10' : 'bg-brand/5')
                )}
                onClick={async () => {
                  if (!n.is_read) await markReadMutation.mutateAsync(n.id)
                  if (n.link) navigate(n.link)
                }}
              >
                {!n.is_read && <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', w ? 'bg-w-accent' : 'bg-brand')} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className={cn('min-w-0 flex-1 truncate text-sm font-bold', w ? 'text-w-ink' : 'text-p-text')}>{n.title}</div>
                    {n.priority === 'high' && (
                      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', w ? 'bg-w-accent text-black' : 'bg-brand text-black')}>
                        <Star className="h-2.5 w-2.5 fill-current" /> Важно
                      </span>
                    )}
                  </div>
                  {n.body && <div className={cn('mt-0.5 text-[12.5px]', w ? 'text-w-muted' : 'text-p-muted')}>{n.body}</div>}
                  <div className={cn('mt-1 text-[11px]', w ? 'text-w-muted2' : 'text-p-muted2')}>{fmtWhen(n.created_at)}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteMutation.mutate(n.id)
                  }}
                  className={cn('shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100', w ? 'hover:bg-w-panel' : 'hover:bg-p-panel')}
                >
                  <X className={cn('h-3.5 w-3.5', w ? 'text-w-muted' : 'text-p-muted')} />
                </button>
              </div>
            ))}
          </div>

          {canLoadMore && (
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className={cn(
                'mt-4 w-full rounded-[13px] border py-2.5 text-xs font-bold transition-colors',
                w ? 'border-w-line bg-w-panel2 text-w-muted hover:text-w-ink' : 'border-p-line bg-p-panel2 text-p-muted hover:text-p-text'
              )}
            >
              Показать ещё
            </button>
          )}
        </>
      )}
    </div>
  )
}
