import { FileText } from 'lucide-react'
import type { Submission } from '@/api/activities'
import { formatDay } from '@/lib/portfolio/dictionary'

/** Одна отправка шага: дата, текст и приложенные файлы. */
export function SubmissionView({ submission, title }: { submission: Submission; title: string }) {
  return <section className="space-y-2 rounded-ctl border border-ds-line p-3 text-sm">
    <p className="text-xs font-semibold text-ds-muted">{title} {formatDay(submission.submitted_at)}:</p>
    {submission.note && <p className="whitespace-pre-wrap break-words">{submission.note}</p>}
    {submission.files.length > 0 && <ul className="flex flex-wrap gap-2">
      {submission.files.map((file) => <li key={file.id} className="inline-flex items-center gap-1.5 rounded-pill bg-ds-panel2 px-2.5 py-1 text-xs">
        <FileText className="h-3.5 w-3.5 text-ds-muted" aria-hidden />{file.name}
      </li>)}
    </ul>}
    {!submission.note && !submission.files.length && <p className="text-ds-muted">Без текста и файлов.</p>}
  </section>
}
