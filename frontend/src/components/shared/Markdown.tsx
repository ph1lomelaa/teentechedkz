import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/** Плейн-текст превью из markdown: без решёток, звёздочек и маркеров списков */
export function stripMarkdown(md: string | null | undefined): string {
  if (!md) return ''
  return md
    .replace(/^[#>\s-]+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\n+/g, ' · ')
    .trim()
}

/** Рендер Markdown для AI-конспектов и резюме в стиле приложения. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm text-gray-800 leading-relaxed space-y-2', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <p className="text-base font-semibold text-gray-900 mt-3 first:mt-0">{children}</p>
          ),
          h2: ({ children }) => (
            <p className="text-sm font-semibold text-gray-900 mt-3 first:mt-0">{children}</p>
          ),
          h3: ({ children }) => (
            <p className="label-caps mt-3 first:mt-0">{children}</p>
          ),
          ul: ({ children }) => <ul className="space-y-1 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1 pl-5 list-decimal">{children}</ol>,
          li: ({ children }) => (
            <li className="flex gap-2">
              <span className="text-gray-400 shrink-0 select-none">·</span>
              <span className="min-w-0">{children}</span>
            </li>
          ),
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 bg-gray-100 rounded-ctl text-[12px] font-mono text-gray-700">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-black">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <table className="w-full text-sm border border-gray-200 rounded-panel overflow-hidden">{children}</table>
          ),
          th: ({ children }) => (
            <th className="text-left px-2 py-1 border-b border-gray-200 label-caps">{children}</th>
          ),
          td: ({ children }) => <td className="px-2 py-1 border-b border-gray-100">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
