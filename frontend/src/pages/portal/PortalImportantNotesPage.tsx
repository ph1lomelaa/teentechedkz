import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { StickyNote } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { portalImportantNotesApi } from '@/api/portalImportantNotes'

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
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Заметки</h1>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : notes.length === 0 ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-[13px] bg-brand/15">
            <StickyNote className="h-5 w-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Заметок пока нет</h2>
          <p className="mt-1.5 text-sm text-p-muted">
            Здесь появятся важные заметки, которыми с вами поделится ваш ментор.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <article key={note.id} className="rounded-[16px] border border-p-line bg-p-panel p-5">
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
