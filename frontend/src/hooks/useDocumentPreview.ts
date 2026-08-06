import { useEffect, useRef, useState } from 'react'
import { agreementsApi, Agreement } from '@/api/agreements'

export type DocumentPreviewMode = 'pdf' | 'docx' | 'text' | 'unavailable'

export interface DocumentPreviewState {
  mode: DocumentPreviewMode
  url: string | null
  text: string | null
  loading: boolean
  error: string | null
}

const isDocx = (fileName?: string | null) => Boolean(fileName?.toLowerCase().endsWith('.docx'))

/**
 * Single source of truth for rendering an agreement's attached file.
 * Mirrors what the backend's /preview endpoint reports (pdf vs converted
 * text) and additionally renders .docx client-side via docx-preview, since
 * the browser has no native DOCX viewer and the server-side text extraction
 * strips formatting.
 */
export function useDocumentPreview(agreement: Pick<Agreement, 'id' | 'file_name' | 'body_markdown'> | null) {
  const [state, setState] = useState<DocumentPreviewState>({
    mode: 'unavailable',
    url: null,
    text: agreement?.body_markdown ?? null,
    loading: false,
    error: null,
  })
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    if (!agreement) {
      setState({ mode: 'unavailable', url: null, text: null, loading: false, error: null })
      return
    }
    if (!agreement.file_name) {
      setState({ mode: 'text', url: null, text: agreement.body_markdown ?? null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    const load = async () => {
      try {
        const preview = await agreementsApi.preview(agreement.id)
        if (cancelled) return

        if (preview.mode === 'pdf') {
          const blob = await agreementsApi.download(agreement.id)
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          urlRef.current = url
          setState({ mode: 'pdf', url, text: null, loading: false, error: null })
          return
        }

        if (isDocx(agreement.file_name)) {
          const blob = await agreementsApi.download(agreement.id)
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          urlRef.current = url
          setState({ mode: 'docx', url, text: preview.text ?? null, loading: false, error: null })
          return
        }

        setState({
          mode: preview.text ? 'text' : 'unavailable',
          url: null,
          text: preview.text ?? agreement.body_markdown ?? null,
          loading: false,
          error: null,
        })
      } catch {
        if (cancelled) return
        setState({
          mode: agreement.body_markdown ? 'text' : 'unavailable',
          url: null,
          text: agreement.body_markdown ?? null,
          loading: false,
          error: 'Не удалось открыть файл документа. Ознакомьтесь с текстом ниже или скачайте файл.',
        })
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreement?.id, agreement?.file_name])

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  return state
}
