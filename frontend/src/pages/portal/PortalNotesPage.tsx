import React, { useState, useMemo, useDeferredValue, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, ChevronRight, Search, X, Download } from 'lucide-react'
import { portalNotesApi } from '@/api/portalNotes'
import { portalApi } from '@/api/portal'
import { Markdown } from '@/components/shared/Markdown'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { PageShell } from '@/components/shared/PageShell'
import { AppButton, EmptyState } from '@/components/ui'

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

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
      <div className="flex items-center justify-between gap-4">
        <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Конспекты</h1>
        {notes.length > 0 && !selectedId && (
          <AppButton
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            size="sm"
            variant="primary"
            className="mt-2"
            title="Скачать все конспекты в формате Markdown"
          >
            <Download className="w-4 h-4" />
            .md
          </AppButton>
        )}
      </div>

      {selectedId ? (
        <div>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-p-muted hover:text-p-text mb-4"
          >
            <ChevronLeft className="w-4 h-4" /> Все конспекты
          </button>
          {detailLoading || !detail ? (
            <p className="text-sm text-p-muted">Загрузка…</p>
          ) : (
            <article className="rounded-card border border-p-line bg-p-panel p-[22px]">
              <h2 className="font-display text-xl font-black text-p-text">{detail.title}</h2>
              <p className="mt-1 text-[12px] text-p-muted">{fmt(detail.published_at || detail.created_at)}</p>
              {/* Markdown component uses light-theme grays — render on a white
                  surface so it stays legible under the portal's dark theme too. */}
              <div className="mt-5 rounded-[12px] border border-p-line bg-white p-5">
                <Markdown>{detail.summary_markdown ?? ''}</Markdown>
              </div>
            </article>
          )}
        </div>
      ) : isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : notes.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-5 h-5" />} title="Конспектов пока нет" description="После встреч ментор публикует конспекты — они появятся здесь." colorPrefix="p" />
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск конспектов…"
              className="h-11 w-full rounded-[11px] border border-p-line bg-p-panel2 pl-10 pr-10 text-sm text-p-text outline-none placeholder:text-p-muted2 focus:border-brand transition"
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
            <div className="space-y-2">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className="w-full flex items-center gap-4 border border-p-line rounded-[16px] bg-p-panel p-4 text-left hover:bg-p-panel2 transition-colors"
                >
                  <div className="w-10 h-10 rounded-[12px] bg-brand/15 grid place-items-center shrink-0">
                    <ScrollText className="w-[18px] h-[18px] text-brand" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold text-p-text truncate">{n.title}</div>
                    <div className="text-[12px] text-p-muted mt-0.5">{fmt(n.published_at || n.created_at)}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-p-muted shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}
