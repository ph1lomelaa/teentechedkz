import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Activity, type ActivityInput } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'

export function ActivityEditor({ activity, onClose }: { activity?: Activity; onClose: () => void }) {
  const [form, setForm] = useState<ActivityInput>(activity ? {
    title: activity.title, direction: activity.direction, kind: activity.kind, organizer: activity.organizer,
    country: activity.country, description: activity.description, eligibility: activity.eligibility,
    assignment: activity.assignment, source_url: activity.source_url, publication: activity.publication, conditions_checked_at: activity.conditions_checked_at ?? null,
  } : { title: '', direction: null, kind: null, organizer: null, country: null, description: null, eligibility: null, assignment: null, source_url: null, publication: 'draft' })
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => activitiesApi.save(form, activity?.id), onSuccess: () => { client.invalidateQueries({ queryKey: ['activities'] }); onClose() } })
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose() }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle>{activity ? 'Редактировать активность' : 'Новая активность'}</DialogTitle><DialogDescription>Общее описание для каталога. Сроки и стоимость добавляются отдельно в наборах.</DialogDescription></DialogHeader>
    <form onSubmit={e => { e.preventDefault(); save.mutate() }} className="space-y-4">
      {([['title', 'Название', 500], ['direction', 'Направление', 255], ['kind', 'Тип активности', 100], ['organizer', 'Организатор', 500], ['country', 'Страна', 500], ['source_url', 'Ссылка организатора', 2048]] as const).map(([key, label, max]) => <label className="block text-sm font-semibold" key={key}>{label}<Input className="mt-1" type={key === 'source_url' ? 'url' : 'text'} required={key === 'title'} maxLength={max} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value || (key === 'title' ? '' : null) })} /></label>)}
      {([['description', 'Описание'], ['eligibility', 'Кому подходит'], ['assignment', 'Задание']] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold">{label}<Textarea className="mt-1" maxLength={20000} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value || null })} /></label>)}
      <label className="block text-sm font-semibold">Публикация<select className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={form.publication} onChange={e => setForm({ ...form, publication: e.target.value as Activity['publication'] })}><option value="draft">Черновик · вне каталога ученика</option><option value="published">Опубликовано · видно ученикам</option><option value="archived">Архив · новые участия закрыты</option></select></label>
      {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
      <AppButton type="submit" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</AppButton>
    </form>
  </DialogContent></Dialog>
}
