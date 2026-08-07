import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { DocumentPreviewState } from '@/hooks/useDocumentPreview'

interface Props {
  preview: DocumentPreviewState
  title: string
}

/**
 * Renders whatever useDocumentPreview resolved: PDF via iframe, DOCX via
 * docx-preview (browsers have no native DOCX viewer), plain text as an
 * article, or a fallback message when nothing could be shown inline.
 */
export const DocumentViewer: React.FC<Props> = ({ preview, title }) => {
  const docxRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  // docx-preview рисует страницы фиксированной ширины листа (A4 ≈ 816px), из-за
  // чего документ вылезал за модалку и обрезался. Ужимаем под ширину контейнера.
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState<number>()

  useEffect(() => {
    if (preview.mode !== 'docx' || !preview.url || !docxRef.current) return
    let cancelled = false
    fetch(preview.url)
      .then((response) => response.blob())
      .then((blob) => {
        if (!cancelled && docxRef.current) {
          docxRef.current.innerHTML = ''
          return renderAsync(blob, docxRef.current)
        }
        return undefined
      })
      .catch(() => {
        if (docxRef.current) docxRef.current.textContent = 'Не удалось отобразить документ.'
      })
    return () => {
      cancelled = true
    }
  }, [preview.mode, preview.url])

  useLayoutEffect(() => {
    if (preview.mode !== 'docx') return
    const content = docxRef.current
    const frame = frameRef.current
    if (!content || !frame) return
    const measure = () => {
      const natural = content.scrollWidth
      const available = frame.clientWidth
      if (!natural || !available) return
      const next = Math.min(1, available / natural)
      setScale(next)
      setHeight(content.scrollHeight * next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [preview.mode, preview.url])

  if (preview.loading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-white/60">Загружаем документ…</div>
  }

  if (preview.mode === 'pdf' && preview.url) {
    return <iframe title={`Превью ${title}`} src={preview.url} className="h-[calc(100vh-320px)] min-h-[420px] w-full rounded-lg bg-white" />
  }

  if (preview.mode === 'docx') {
    return (
      <div ref={frameRef} className="w-full overflow-hidden rounded-lg bg-white" style={{ height }}>
        <div
          ref={docxRef}
          className="docx-preview origin-top-left text-black"
          style={{ transform: `scale(${scale})`, width: scale < 1 ? `${100 / scale}%` : '100%' }}
        />
      </div>
    )
  }

  if (preview.mode === 'text' && preview.text) {
    return (
      <article className="mx-auto min-h-[55vh] max-w-3xl whitespace-pre-wrap rounded-lg bg-white p-6 text-sm leading-7 text-gray-900 shadow-sm sm:p-10">
        {preview.text}
      </article>
    )
  }

  return (
    <div className="grid min-h-[50vh] place-items-center text-center text-sm text-white/65">
      {preview.error || 'Формат файла нельзя показать прямо в браузере. Скачайте документ для ознакомления.'}
    </div>
  )
}
