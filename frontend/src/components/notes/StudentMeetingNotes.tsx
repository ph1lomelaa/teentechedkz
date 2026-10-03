import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { notesApi } from '@/api/notes'
import { stripMarkdown } from '@/components/shared/Markdown'
import { NoteReader } from './NoteReader'
import { formatDate } from '@/lib/utils'
import { QueryState } from '@/components/shared/QueryState'

export function StudentMeetingNotes({ studentId, workspace = false }: { studentId: string; workspace?: boolean }) {
  const { data: notes = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['student-meeting-notes', studentId],
    queryFn: () => notesApi.list({ student_id: studentId }),
  })
  const sorted = [...notes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const home = workspace ? '/workspace/notes' : '/notes'
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-p-text">Итоги встреч</h3><p className="mt-1 text-sm text-p-muted">Читайте конспекты прямо в карточке студента.</p></div><Link to={`${home}${workspace ? '&' : '?'}student_id=${studentId}&create=1`} className="inline-flex items-center gap-2 rounded-xl bg-[#FFD400] px-4 py-2.5 text-sm font-semibold text-black"><Plus className="h-4 w-4" />Записать встречу</Link></div>
    <QueryState colorPrefix={workspace ? 'w' : 'p'} isLoading={isLoading} isError={isError} error={error} onRetry={refetch} isEmpty={sorted.length === 0} empty={<div className="rounded-2xl border border-dashed border-p-line p-8 text-center"><FileText className="mx-auto mb-3 h-6 w-6 text-p-muted" /><p className="text-sm text-p-muted">После первой встречи здесь появится её итог.</p></div>}>
      <div className="space-y-3">{sorted.map(note => <details key={note.id} className="group overflow-hidden rounded-2xl border border-p-line bg-p-panel">
        <summary className="flex cursor-pointer list-none items-start gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><FileText className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-p-text">{note.student_title || `Встреча ${formatDate(note.created_at)}`}</h4><span className="rounded-full bg-p-panel2 px-2.5 py-1 text-xs text-p-muted">{note.status === 'draft' ? 'На проверке' : note.status === 'approved' ? 'Проверен' : 'Отклонён'}</span><span className="text-xs text-p-muted">{note.published_to_student ? 'Виден ученику' : 'Только для команды'}</span></div><p className="mt-2 line-clamp-2 text-sm leading-6 text-p-muted">{stripMarkdown(note.summary_markdown) || 'Откройте конспект для просмотра.'}</p></div><ChevronRight className="mt-2 h-4 w-4 shrink-0 text-p-muted transition group-open:rotate-90" /></summary>
        <div className="border-t border-p-line"><div className="note-paper bg-white p-5 sm:p-7"><NoteReader markdown={note.summary_markdown} /></div><div className="flex justify-end border-t border-p-line px-5 py-3"><Link to={workspace ? `/workspace/meetings/notes/${note.id}` : `/notes/${note.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-p-text">{note.status === 'draft' ? 'Проверить конспект' : 'Открыть полностью'}<ChevronRight className="h-4 w-4" /></Link></div></div>
      </details>)}</div>
    </QueryState>
  </section>
}
