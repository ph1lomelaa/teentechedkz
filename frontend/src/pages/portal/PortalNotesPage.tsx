import React, { useState, useMemo, useDeferredValue, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, Search, X, Download } from 'lucide-react'
import { portalNotesApi, PortalNote } from '@/api/portalNotes'
import { portalApi } from '@/api/portal'
import { Markdown } from '@/components/shared/Markdown'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { PageShell } from '@/components/shared/PageShell'
import { AppButton, EmptyState } from '@/components/ui'
import { cn } from '@/lib/utils'

function fmt(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function monthLabel(iso: string | null): string {
  if (!iso) return 'Без даты'
  try {
    const label = new Date(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  } catch {
    return 'Без даты'
  }
}

function groupByMonth(notes: PortalNote[]): { label: string; notes: PortalNote[] }[] {
  const groups = new Map<string, PortalNote[]>()
  for (const note of notes) {
    const key = monthLabel(note.published_at || note.created_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(note)
  }
  return Array.from(groups.entries()).map(([label, groupNotes]) => ({ label, notes: groupNotes }))
}

export const PortalNotesPage: React.FC = () => {
  const [selectedId, setSelectedId] = useLocalState<string | null>('portal:notes:selected', null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['portal', 'notes'],
    queryFn: portalNotesApi.list,
  })

  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      setSelectedId(null)
    }
  }, [notes, selectedId, setSelectedId])

  const downloadMutation = useMutation({
    mutationFn: () => portalApi.downloadNotesMarkdown(),
    onError: () => toast({ title: 'Не удалось скачать файл', variant: 'destructive' }),
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['portal', 'note', selectedId],
    queryFn: () => portalNotesApi.get(selectedId as string),
    enabled: Boolean(selectedId),
  })

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q),
    )
  }, [notes, deferredSearch])

  const grouped = useMemo(() => groupByMonth(filtered), [filtered])

  const list = (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск конспектов…"
          className="h-11 w-full rounded-ctl border border-p-line bg-p-panel2 pl-10 pr-10 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand transition"
        />
        {search && (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-p-muted2 hover:text-p-text"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Конспекты не найдены" colorPrefix="p" />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.18em] text-p-muted2">{group.label}</p>
              <div className="space-y-2">
                {group.notes.map((n) => {
                  const active = n.id === selectedId
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={cn(
                        'w-full flex items-center gap-3 border rounded-panel p-3.5 text-left transition-colors',
                        active
                          ? 'border-p-accent bg-p-accent/10'
                          : 'border-p-line bg-p-panel hover:bg-p-panel2',
                      )}
                    >
                      <div className="w-9 h-9 rounded-panel bg-brand/15 grid place-items-center shrink-0">
                        <ScrollText className="w-[16px] h-[16px] text-brand" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-p-text truncate">{n.title}</div>
                        <div className="text-[12px] text-p-muted mt-0.5">{fmt(n.published_at || n.created_at)}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const detailView = !selectedId ? (
    <div className="hidden lg:flex h-full min-h-[420px] items-center justify-center rounded-card border border-dashed border-p-line bg-p-panel/40 p-8 text-center">
      <div>
        <ScrollText className="mx-auto mb-3 h-6 w-6 text-p-muted2" />
        <p className="text-sm font-semibold text-p-text">Выберите конспект слева</p>
        <p className="mt-1 text-[12px] text-p-muted">Содержимое откроется здесь</p>
      </div>
    </div>
  ) : detailLoading || !detail ? (
    <p className="text-sm text-p-muted">Загрузка…</p>
  ) : (
    <article className="rounded-card border border-p-line bg-p-panel p-4 sm:p-[22px]">
      <button
        type="button"
        onClick={() => setSelectedId(null)}
        className="lg:hidden inline-flex items-center gap-1.5 text-sm font-semibold text-p-muted hover:text-p-text mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Все конспекты
      </button>
      <h2 className="font-display text-xl font-black text-p-text">{detail.title}</h2>
      <p className="mt-1 text-[12px] text-p-muted">{fmt(detail.published_at || detail.created_at)}</p>
      {/* Markdown component uses light-theme grays — render on a white
          surface so it stays legible under the portal's dark theme too. */}
      <div className="mt-5 rounded-panel border border-p-line bg-white p-3 sm:p-5">
        <Markdown>{detail.summary_markdown ?? ''}</Markdown>
      </div>
    </article>
  )

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
      <div className="flex items-center justify-between gap-4">
        <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Конспекты</h1>
        {notes.length > 0 && (
          <AppButton
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            size="sm"
            variant="primary"
            colorPrefix="p"
            className="mt-2"
            title="Скачать все конспекты в формате Markdown"
          >
            <Download className="w-4 h-4" />
            .md
          </AppButton>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : notes.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-5 h-5" />} title="Конспектов пока нет" description="После встреч ментор публикует конспекты — они появятся здесь." colorPrefix="p" />
      ) : (
        <div className="lg:grid lg:grid-cols-[360px_1fr] lg:items-start lg:gap-6">
          <div className={cn(selectedId ? 'hidden lg:block' : 'block')}>{list}</div>
          <div className={cn(selectedId ? 'block' : 'hidden lg:block')}>{detailView}</div>
        </div>
      )}
    </PageShell>
  )
}
