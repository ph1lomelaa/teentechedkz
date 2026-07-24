import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { StickyNote } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
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
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['portal', 'important-notes'],
    queryFn: portalImportantNotesApi.list,
  })

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <div>
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Заметки</h1>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : notes.length === 0 ? (
        <EmptyState icon={<StickyNote className="h-5 w-5" />} title="Заметок пока нет" description="Здесь появятся важные заметки, которыми с вами поделится ваш ментор." colorPrefix="p" />
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <article key={note.id} className="rounded-card border border-p-line bg-p-panel p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-p-text">{note.note_text}</p>
              <p className="mt-3 text-[12px] text-p-muted">{fmt(note.created_at)}</p>
            </article>
          ))}
        </div>
      )}
      </div>
    </PageShell>
  )
}
