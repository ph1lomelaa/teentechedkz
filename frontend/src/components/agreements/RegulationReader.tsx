import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Текст регламента прямо на странице подписи: настоящие заголовки и списки
 * вместо «# Регламент» сырым markdown, и полоса «прочитано». Дочитал до
 * конца — `onReadToEnd`: только после этого можно поставить галочку. Так
 * подпись означает «прочитал», а не «пролистал мимо».
 */
export const RegulationReader: React.FC<{ markdown: string; onReadToEnd: () => void }> = ({ markdown, onReadToEnd }) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const reported = useRef(false)
  // Колбэк через ref: новый onReadToEnd на каждом рендере родителя не должен
  // сбрасывать прогресс чтения.
  const onReadToEndRef = useRef(onReadToEnd)
  onReadToEndRef.current = onReadToEnd

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const scrollable = el.scrollHeight - el.clientHeight
    // Короткий текст целиком помещается — читать «до конца» уже нечего.
    const value = scrollable <= 8 ? 1 : Math.min(1, el.scrollTop / (scrollable - 8))
    setProgress(value)
    if (value >= 1 && !reported.current) {
      reported.current = true
      onReadToEndRef.current()
    }
  }, [])

  useEffect(() => {
    reported.current = false
    setProgress(0)
    scrollRef.current?.scrollTo({ top: 0 })
    // Дать разметке отрисоваться, потом мерить.
    const id = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(id)
  }, [markdown, measure])

  const percent = Math.round(progress * 100)

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Прочитано"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${percent >= 100 ? 'bg-emerald-400' : 'bg-[#FFD400]'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={`w-28 shrink-0 text-right text-xs font-semibold ${percent >= 100 ? 'text-emerald-400' : 'text-white/55'}`}>
          {percent >= 100 ? 'Прочитано' : `Прочитано ${percent}%`}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={measure}
        tabIndex={0}
        aria-label="Текст регламента"
        className="max-h-[52vh] overflow-y-auto px-5 py-5 text-[15px] leading-7 text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD400] sm:px-7"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-bold text-white first:mt-0">{children}</h2>,
            h2: ({ children }) => <h3 className="mb-2 mt-6 text-lg font-bold text-white first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="mb-2 mt-5 text-[15px] font-bold text-[#FFD400] first:mt-0">{children}</h4>,
            p: ({ children }) => <p className="my-3">{children}</p>,
            ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-[#FFD400]">{children}</ul>,
            ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-[#FFD400]">{children}</ol>,
            li: ({ children }) => <li className="pl-1">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
            blockquote: ({ children }) => (
              <blockquote className="my-4 rounded-r-lg border-l-4 border-[#FFD400] bg-[#FFD400]/[0.06] px-4 py-2 text-white/85">{children}</blockquote>
            ),
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            th: ({ children }) => <th className="border border-white/15 bg-white/[0.06] px-3 py-2 text-left font-semibold text-white">{children}</th>,
            td: ({ children }) => <td className="border border-white/10 px-3 py-2 align-top">{children}</td>,
            hr: () => <hr className="my-6 border-white/10" />,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#FFD400] underline underline-offset-4">
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
      {percent < 100 && (
        <p className="border-t border-white/10 px-4 py-2 text-center text-xs text-white/45">
          Пролистайте документ до конца — после этого откроется подпись
        </p>
      )}
    </div>
  )
}
