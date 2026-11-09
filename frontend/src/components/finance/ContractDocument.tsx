/**
 * «Документ договора» для финансиста (09.11.2026 вместо «Договор TrustMe и
 * акты»): настоящий договор ученика и две кнопки — открыть во вкладке и
 * скачать. Откуда файл, решает сервер (`originals`): договор TrustMe этого
 * договора, иначе TrustMe ученика без привязки, иначе загруженный скан.
 */
import { useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { actsApi } from '@/api/acts'
import { financeApi, type OriginalDocument } from '@/api/finance'
import { getErrorMessage } from '@/lib/errorMessage'
import { downloadBlob } from '@/lib/utils'

const LINK_BTN = 'inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-p-text underline-offset-2 hover:underline disabled:opacity-50'
const fileName = (label: string) => (/\.[a-z0-9]{2,5}$/i.test(label) ? label : `${label}.pdf`)

export function ContractDocument({ studentId, contractId, documents }: { studentId: string; contractId: string; documents?: OriginalDocument[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!documents?.length) return <span className="text-[13px] text-[var(--fin-text-3)]">Договор не загружен</span>

  const fetchFile = (doc: OriginalDocument) =>
    doc.kind === 'scan' ? financeApi.contractScan(contractId, doc.id) : actsApi.contractPdf(studentId, doc.id)

  const run = async (doc: OriginalDocument, mode: 'open' | 'download') => {
    setError(null)
    setBusy(`${doc.id}:${mode}`)
    // Вкладку открываем сразу по клику: Safari блокирует окна, открытые
    // после ожидания ответа сервера.
    const tab = mode === 'open' ? window.open('', '_blank') : null
    try {
      const blob = await fetchFile(doc)
      if (tab) {
        const typed = blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: 'application/pdf' })
        const url = URL.createObjectURL(typed)
        tab.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        downloadBlob(blob, fileName(doc.label))
      }
    } catch (err) {
      tab?.close()
      setError(getErrorMessage(err, 'Не удалось получить файл договора'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-w-[140px] flex-col gap-2">
      {documents.map((d) => (
        <div key={d.id}>
          <div className="max-w-[240px] truncate text-[13px] font-semibold text-p-text" title={d.label}>
            {d.label}{d.kind === 'scan' && <span className="ml-1 font-normal text-[var(--fin-text-3)]">· скан</span>}
          </div>
          <div className="mt-0.5 flex flex-nowrap items-center gap-3">
            <button type="button" className={LINK_BTN} disabled={!!busy} onClick={() => run(d, 'open')} title="Открыть договор в новой вкладке">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{busy === `${d.id}:open` ? '…' : 'Открыть'}
            </button>
            <button type="button" className={LINK_BTN} disabled={!!busy} onClick={() => run(d, 'download')} title="Скачать договор">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />{busy === `${d.id}:download` ? '…' : 'Скачать'}
            </button>
          </div>
        </div>
      ))}
      {error && <span role="alert" className="text-[12px] text-[var(--fin-bad)]">{error}</span>}
    </div>
  )
}
