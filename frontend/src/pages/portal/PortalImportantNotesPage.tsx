import React, { useMemo, useState, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { StickyNote, Search, X } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { QueryState } from '@/components/shared/QueryState'
import { portalImportantNotesApi } from '@/api/portalImportantNotes'
import { EmptyState } from '@/components/ui'

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export const PortalImportantNotesPage: React.FC = () => {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const { data: notes = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal', 'important-notes'],
    queryFn: portalImportantNotesApi.list,
  })

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.note_text.toLowerCase().includes(q))
  }, [notes, deferredSearch])

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <div>
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Заметки</h1>

      <QueryState
        colorPrefix="p"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={notes.length === 0}
        empty={(
          <EmptyState icon={<StickyNote className="h-5 w-5" />} title="Заметок пока нет" description="Здесь появятся важные заметки, которыми с вами поделится ваш ментор." colorPrefix="p" />
        )}
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по заметкам…"
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
            <EmptyState title="Заметки не найдены" colorPrefix="p" />
          ) : (
            <div className="space-y-3">
              {filtered.map((note) => (
                <article key={note.id} className="rounded-card border border-p-line bg-p-panel p-5">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-p-text">{note.note_text}</p>
                  <p className="mt-3 text-[12px] text-p-muted">{fmt(note.created_at)}</p>
                </article>
              ))}
            </div>
          )}
        </div>

      </QueryState>
      </div>
    </PageShell>
  )
}
