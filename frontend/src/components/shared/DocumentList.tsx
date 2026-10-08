import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Download, Eye, EyeOff, FileSignature, MoreHorizontal, Pencil, Search, Upload, X } from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { DOC_TYPE_LABELS, type Document, type DocType } from '@/types'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/primitives/toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

type Doc = Document & { uploaded_by?: string }
type Props = {
  documents: Doc[]
  tone: 'p' | 'w'
  showTitle?: boolean
  canManage?: boolean
  canDelete?: (doc: Doc) => boolean
  canRename?: (doc: Doc) => boolean
  onOpen: (doc: Doc) => void
  onDownload: (doc: Doc) => void
  onUploadClick?: () => void
  onFilesDropped?: (files: File[]) => void
  onChanged: () => void
  onDelete: (doc: Doc) => Promise<unknown>
  onSignature?: (doc: Doc) => void
  onVisibility?: (doc: Doc) => void
  uploadingName?: string | null
  uploadError?: string | null
  onRetryUpload?: () => void
}

const sourceNames: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', manual_upload: 'Загрузка' }
const order: DocType[] = ['certificate', 'achievement', 'transcript', 'offer_letter', 'id_scan', 'resume', 'contract_scan', 'onboarding', 'other']
const forbidden = /[/\\:*?"<>|]/g

export function documentName(doc: Doc) {
  const suffix = doc.file_name.includes('.') ? `.${doc.file_name.split('.').pop()}` : ''
  return doc.display_name ? `${doc.display_name}${suffix}` : doc.file_name
}

function parts(doc: Doc) {
  const name = documentName(doc)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1048576).toFixed(1)} МБ`
}

function fileColor(ext: string) {
  if (ext === '.pdf') return 'text-red-500 border-red-500'
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'text-sky-500 border-sky-500'
  if (['.doc', '.docx'].includes(ext)) return 'text-blue-600 border-blue-600'
  if (['.ppt', '.pptx'].includes(ext)) return 'text-orange-500 border-orange-500'
  if (['.xls', '.xlsx'].includes(ext)) return 'text-emerald-500 border-emerald-500'
  return 'text-slate-500 border-slate-500'
}

export const DocumentList: React.FC<Props> = ({
  documents, tone, showTitle = true, canManage = false, canDelete, canRename, onOpen, onDownload,
  onUploadClick, onFilesDropped, onChanged, onDelete, onSignature, onVisibility,
  uploadingName, uploadError, onRetryUpload,
}) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const line = tone === 'w' ? 'border-w-line' : 'border-p-line'
  const ink = tone === 'w' ? 'text-w-ink' : 'text-p-text'
  const muted = tone === 'w' ? 'text-w-muted' : 'text-p-muted'
  const hover = tone === 'w' ? 'hover:bg-w-panel2' : 'hover:bg-p-panel2'
  const accent = tone === 'w' ? 'text-w-accentText' : 'text-p-accent-text'
  const visible = documents.filter(d => !pending.includes(d.id))
  const filtered = visible.filter(d => `${documentName(d)} ${DOC_TYPE_LABELS[d.doc_type as DocType] || d.doc_type}`.toLowerCase().includes(query.toLowerCase()))
  const groups = useMemo(() => order.map(type => ({ type, items: filtered.filter(d => d.doc_type === type) })).filter(group => group.items.length), [filtered])

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setConfirmDelete(null) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [])
  useEffect(() => { if (renaming) renameRef.current?.select() }, [renaming])

  const startRename = (doc: Doc) => { setDraft(parts(doc)[0]); setRenaming(doc.id); setMenu(null) }
  const saveRename = async (doc: Doc) => {
    const value = draft.trim().replace(forbidden, '_')
    if (!value) return
    if (value === parts(doc)[0]) { setRenaming(null); return }
    try {
      await documentsApi.rename(doc.id, value)
      setRenaming(null)
      onChanged()
      toast({ title: 'Название сохранено' })
    } catch (error) { toast({ title: 'Не удалось переименовать', description: getErrorMessage(error), variant: 'destructive' }) }
  }
  const scheduleDelete = (doc: Doc) => {
    setConfirmDelete(null)
    setPending(ids => [...ids, doc.id])
    const undo = () => {
      clearTimeout(timers.current.get(doc.id))
      timers.current.delete(doc.id)
      setPending(ids => ids.filter(id => id !== doc.id))
    }
    const timer = setTimeout(async () => {
      timers.current.delete(doc.id)
      try { await onDelete(doc); onChanged() }
      catch (error) {
        setPending(ids => ids.filter(id => id !== doc.id))
        toast({ title: 'Не удалось удалить документ', description: getErrorMessage(error), variant: 'destructive' })
      }
    }, 5000)
    timers.current.set(doc.id, timer)
    toast({ title: `Удалён ${documentName(doc)}`, duration: 5000, action: <ToastAction altText="Отменить удаление" onClick={undo}>Отменить</ToastAction> })
  }
  const iconButton = 'grid h-8 w-8 shrink-0 place-items-center rounded-ctl transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-current'

  return <section
    className="min-w-0"
    onDragOver={event => { if (onFilesDropped && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
    onDrop={event => { if (!onFilesDropped) return; event.preventDefault(); setDragging(false); onFilesDropped(Array.from(event.dataTransfer.files)) }}
  >
    <div className="flex flex-wrap items-center gap-2 pb-3">
      {showTitle && <h3 className={cn('font-display text-base font-black', ink)}>Документы</h3>}
      <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold', line, muted)}>{visible.length}</span>
      <div className="min-w-0 flex-1" />
      {visible.length > 5 && <label className={cn('flex h-9 items-center gap-2 rounded-ctl border px-2', line, muted)}><Search className="h-4 w-4" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти документ" aria-label="Найти документ" className={cn('w-36 min-w-0 bg-transparent text-sm outline-none', ink)} /></label>}
      {onUploadClick && <button type="button" onClick={onUploadClick} className={cn('inline-flex h-9 items-center gap-1.5 rounded-ctl border px-3 text-xs font-bold', line, ink, hover)}><Upload className="h-4 w-4" />Загрузить</button>}
      <button type="button" onClick={() => setOpen(v => !v)} className={cn(iconButton, muted)} aria-label={open ? 'Свернуть документы' : 'Развернуть документы'} title={open ? 'Свернуть' : 'Развернуть'}><ChevronDown className={cn('h-4 w-4 transition', !open && '-rotate-90')} /></button>
    </div>
    {open && <>
      {visible.length === 0 && <p className={cn('py-5 text-center text-sm', muted)}>Документов пока нет</p>}
      {visible.length > 0 && filtered.length === 0 && <p className={cn('py-5 text-center text-sm', muted)}>Ничего не найдено</p>}
      {groups.map(group => <div key={group.type} className="mb-3">
        <div className={cn('pb-1 text-[10px] font-black uppercase tracking-[0.15em]', muted)}>{DOC_TYPE_LABELS[group.type]} · {group.items.length}</div>
        {group.items.map(doc => {
          const [stem, ext] = parts(doc)
          const editable = canRename?.(doc) ?? canManage
          const deletable = canDelete?.(doc) ?? canManage
          return <div key={doc.id} className={cn('group relative border-b py-2 last:border-b-0', line)}>
            {confirmDelete === doc.id ? <div className="flex flex-wrap items-center gap-2 rounded-ctl bg-red-500/10 p-3 text-xs text-red-600"><span className="min-w-0 flex-1">Удалить <strong className="break-all">{documentName(doc)}</strong>? Студент и команда больше не увидят файл.</span><button onClick={() => setConfirmDelete(null)} className="font-bold">Отмена</button><button onClick={() => scheduleDelete(doc)} className="rounded-ctl bg-red-600 px-3 py-1.5 font-bold text-white">Удалить</button></div> :
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
              <div className={cn('grid h-11 w-10 shrink-0 place-items-center rounded-ctl border-t-2 bg-black/5 text-[10px] font-black uppercase', fileColor(ext.toLowerCase()))}>{ext.slice(1, 5) || 'FILE'}</div>
              <div className="min-w-0 flex-1 basis-[140px]">
                {renaming === doc.id ? <div className="flex min-w-0 items-center gap-1"><input ref={renameRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename(doc); if (e.key === 'Escape') setRenaming(null) }} className={cn('min-w-0 flex-1 rounded-ctl border bg-transparent px-2 py-1 text-sm', line, ink)} aria-label="Новое название" /><span className={cn('text-xs', muted)}>{ext}</span><button onClick={() => saveRename(doc)} aria-label="Сохранить название" className={accent}><Check className="h-4 w-4" /></button><button onClick={() => setRenaming(null)} aria-label="Отменить переименование" className={muted}><X className="h-4 w-4" /></button></div> : <button onClick={() => onOpen(doc)} title={documentName(doc)} className={cn('block max-w-full truncate text-left text-sm font-bold hover:underline', ink)}>{stem}<span className={cn('font-normal', muted)}>{ext}</span></button>}
                <div className={cn('truncate text-[11px]', muted)}>{DOC_TYPE_LABELS[doc.doc_type as DocType] || doc.doc_type} · {size(doc.file_size)} · {sourceNames[doc.source] || doc.source} · {new Date(doc.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
              </div>
              {canManage && <div className="flex flex-wrap gap-1 text-[10px]"><span className={cn('rounded-full px-2 py-1', doc.visible_to_student ? 'bg-emerald-500/10 text-emerald-600' : 'bg-black/5', muted)}>{doc.visible_to_student ? 'Видит студент' : 'Скрыт от студента'}</span>{doc.signature_status === 'pending' && <span className="rounded-full bg-orange-500/10 px-2 py-1 text-orange-600">На подписи</span>}{doc.signature_status === 'signed' && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-600">Подписан</span>}</div>}
              <div className={cn('ml-auto flex shrink-0 items-center gap-0.5', muted)}>
                <button onClick={() => onOpen(doc)} className={cn('rounded-ctl border px-2.5 py-1.5 text-xs font-bold', line, hover)} aria-label={`Открыть ${documentName(doc)}`}>Открыть</button>
                {canManage && onVisibility && <button onClick={() => onVisibility(doc)} className={cn(iconButton, 'grid sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100')} aria-label={doc.visible_to_student ? 'Скрыть от студента' : 'Показать студенту'} title={doc.visible_to_student ? 'Скрыть от студента' : 'Показать студенту'}>{doc.visible_to_student ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
                {editable && <button onClick={() => startRename(doc)} className={cn(iconButton, 'grid sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100')} aria-label="Переименовать" title="Переименовать"><Pencil className="h-4 w-4" /></button>}
                <div ref={menu === doc.id ? menuRef : undefined} className="relative"><button onClick={() => setMenu(menu === doc.id ? null : doc.id)} className={iconButton} aria-label={`Действия с ${documentName(doc)}`} aria-expanded={menu === doc.id} title="Действия"><MoreHorizontal className="h-4 w-4" /></button>{menu === doc.id && <div className={cn('absolute right-0 top-9 z-30 min-w-48 rounded-ctl border p-1 shadow-xl', line, tone === 'w' ? 'bg-w-panel' : 'bg-p-panel', ink)}>
                  <button onClick={() => { onDownload(doc); setMenu(null) }} className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs', hover)}><Download className="h-3.5 w-3.5" /> Скачать</button>
                  {editable && <button onClick={() => startRename(doc)} className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs', hover)}><Pencil className="h-3.5 w-3.5" /> Переименовать</button>}
                  {canManage && <details className={cn('my-1 border-t pt-1', line)}><summary className={cn('cursor-pointer px-2 py-1 text-xs', muted)}>Тип: {DOC_TYPE_LABELS[doc.doc_type as DocType] || doc.doc_type}</summary>{order.map(type => <button key={type} onClick={async () => { setMenu(null); try { await documentsApi.setType(doc.id, type); onChanged() } catch (error) { toast({ title: 'Не удалось изменить тип', description: getErrorMessage(error), variant: 'destructive' }) } }} className={cn('flex w-full justify-between rounded px-2 py-1 text-left text-xs', hover)}>{DOC_TYPE_LABELS[type]}{doc.doc_type === type && <Check className="h-3 w-3" />}</button>)}</details>}
                  {canManage && onVisibility && <button onClick={() => { onVisibility(doc); setMenu(null) }} className={cn('block w-full rounded px-2 py-1.5 text-left text-xs', hover)}>{doc.visible_to_student ? 'Скрыть от студента' : 'Показать студенту'}</button>}
                  {canManage && onSignature && doc.signature_status !== 'signed' && <button onClick={async () => { setMenu(null); if (doc.signature_status === 'pending') { try { await documentsApi.revokeSignature(doc.id); onChanged(); toast({ title: 'Запрос подписи отозван' }) } catch (error) { toast({ title: 'Не удалось отозвать подпись', description: getErrorMessage(error), variant: 'destructive' }) } } else onSignature(doc) }} className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs', hover)}><FileSignature className="h-3.5 w-3.5" />{doc.signature_status === 'pending' ? 'Отозвать подпись' : 'Отправить на подпись'}</button>}
                  {deletable && <button onClick={() => { setConfirmDelete(doc.id); setMenu(null) }} className="mt-1 block w-full border-t border-current/10 px-2 py-2 text-left text-xs text-red-600">Удалить</button>}
                </div>}</div>
              </div>
            </div>}
          </div>
        })}
      </div>)}
      {uploadingName && <div className={cn('mb-2 rounded-ctl border p-3 text-xs', line, muted)}>{uploadingName} · Загрузка…</div>}
      {uploadError && <div className="mb-2 flex items-center justify-between gap-2 rounded-ctl border border-red-500/40 p-3 text-xs text-red-600"><span>{uploadError}</span>{onRetryUpload && <button type="button" onClick={onRetryUpload} className="font-bold underline">Повторить</button>}</div>}
      {onUploadClick && <button type="button" onClick={onUploadClick} className={cn('flex w-full items-center justify-center rounded-ctl border-2 border-dashed px-4 py-5 text-center text-xs font-medium transition', dragging ? 'border-current bg-current/5' : line, muted)}>Перетащите файлы сюда или нажмите «Загрузить»</button>}
    </>}
  </section>
}
