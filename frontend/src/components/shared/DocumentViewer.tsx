import React, { useEffect, useRef } from 'react'
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

  if (preview.loading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-white/60">Загружаем документ…</div>
  }

  if (preview.mode === 'pdf' && preview.url) {
    return <iframe title={`Превью ${title}`} src={preview.url} className="h-[68vh] min-h-[420px] w-full rounded-lg bg-white" />
  }

  if (preview.mode === 'docx') {
    return <div ref={docxRef} className="docx-preview mx-auto max-w-4xl rounded-lg bg-white p-4 text-black sm:p-8" />
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
