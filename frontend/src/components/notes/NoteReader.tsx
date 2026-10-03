import type { Components } from 'react-markdown'
import { Markdown } from '@/components/shared/Markdown'
import { splitNoteMarkdown } from '@/lib/noteBlocks'

// Подтемы «###» внутри раздела — обычные читаемые подзаголовки, а не мелкий
// капслок, как в остальных местах приложения.
const READER_COMPONENTS: Components = {
  h3: ({ children }) => <h4 className="mt-6 mb-1 text-base font-semibold first:mt-0">{children}</h4>,
}

/** A shared reading surface for mentor and student meeting notes. */
export function NoteReader({ markdown }: { markdown?: string | null }) {
  const { hero, sections } = splitNoteMarkdown(markdown, 2)
  if (!markdown?.trim()) return <p className="py-8 text-sm text-slate-500">Текст конспекта пока не готов.</p>
  return (
    <div className="note-reader space-y-8 text-slate-900">
      {hero && <div className="rounded-2xl bg-amber-50/70 p-5 sm:p-6"><Markdown className="text-base leading-7">{hero}</Markdown></div>}
      {sections.map((section, index) => (
        <section key={`${index}-${section.heading}`} className="scroll-mt-24">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{String(index + 1).padStart(2, '0')}</span>
            <h3 className="text-lg font-semibold tracking-tight">{section.heading}</h3>
          </div>
          <Markdown className="text-base leading-7" components={READER_COMPONENTS}>{section.content}</Markdown>
        </section>
      ))}
    </div>
  )
}
