import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activityImportApi } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'

export function ActivityImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const client = useQueryClient()
  const preview = useMutation({ mutationFn: activityImportApi.preview, onSuccess: data => setSelected(data.rows.filter(r => !r.errors.length).map(r => r.row)) })
  const commit = useMutation({ mutationFn: () => activityImportApi.commit(file!, selected), onSuccess: () => { client.invalidateQueries({ queryKey: ['activities'] }) } })
  const busy = preview.isPending || commit.isPending
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
    <DialogHeader><DialogTitle>Импорт базы активностей</DialogTitle><DialogDescription>Проверьте строки перед загрузкой. Активности сохранятся в черновики, сроки — исходным текстом. Существующие записи не изменятся.</DialogDescription></DialogHeader>
    <label className="block space-y-2 text-sm font-semibold">Файл XLSX · до 5 МБ<input className="block w-full rounded-ctl border border-ds-line p-3 text-sm" type="file" accept=".xlsx" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); preview.reset(); commit.reset(); setSelected([]) }} /></label>
    <AppButton variant="subtle" disabled={!file || busy} onClick={() => { commit.reset(); if (file) preview.mutate(file) }}>{preview.isPending ? 'Проверяем…' : 'Предпросмотр'}</AppButton>
    {preview.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(preview.error)}</p>}
    {preview.data && <>
      <p className="text-sm text-ds-muted">Строк с данными: {preview.data.rows.length}. Строк только с номером пропущено: {preview.data.skipped}.</p>
      <div className="space-y-3">{preview.data.rows.map(row => <div key={row.row} className="rounded-card border border-ds-line p-4">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-yellow-400" disabled={!!row.errors.length || busy || commit.isSuccess} checked={selected.includes(row.row)} onChange={e => setSelected(e.target.checked ? [...selected, row.row] : selected.filter(n => n !== row.row))} /><span className="min-w-0"><span className="text-xs text-ds-muted">Строка {row.row} · {row.source.sheet}</span><span className="mt-1 block break-words text-base font-bold">{row.activity?.title || row.source.raw['Наименование'] || 'Без названия'}</span></span></label>
        <div className="ml-7 mt-2 space-y-1 text-sm"><p className="text-ds-muted">{row.dates_text || 'Сроки не указаны'} · стоимость уточняется</p>{row.warnings.map(w => <p className="text-ds-muted" key={w}>{w}</p>)}{row.errors.map(error => <p className="font-semibold text-ds-danger" key={error}>{error}</p>)}</div>
      </div>)}</div>
      {commit.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(commit.error)}</p>}
      {commit.data ? <div role="status" className="rounded-card border border-ds-line p-4"><p className="font-bold">Сохранено черновиков: {commit.data.imported_rows.length}</p>{commit.data.skipped_rows.map(r => <p className="mt-2 text-sm text-ds-muted" key={r.row}>Строка {r.row}: {r.errors.join('; ')}</p>)}<p className="mt-2 text-sm text-ds-muted">Перед публикацией проверьте название, ссылку и условия каждого набора.</p><AppButton className="mt-4" onClick={onClose}>Перейти к каталогу</AppButton></div> : <AppButton disabled={!selected.length || busy} onClick={() => commit.mutate()}>{commit.isPending ? 'Сохраняем…' : `Загрузить в черновики · ${selected.length}`}</AppButton>}
    </>}
  </DialogContent></Dialog>
}
