import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Activity, type ActivityInput } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { getErrorMessage } from '@/lib/errorMessage'
import { PUBLICATION } from '@/lib/activityUi'

export function activityInput(a: Activity): ActivityInput {
  return { title: a.title, direction: a.direction, kind: a.kind, organizer: a.organizer, country: a.country,
    description: a.description, eligibility: a.eligibility, assignment: a.assignment, source_url: a.source_url,
    publication: a.publication, conditions_checked_at: a.conditions_checked_at ?? null }
}
export const emptyActivity: ActivityInput = { title: '', direction: null, kind: null, organizer: null, country: null, description: null, eligibility: null, assignment: null, source_url: null, publication: 'draft', conditions_checked_at: null }

export function ActivityDataForm({ activity, editable, catalog, onSaved }: { activity?: Activity; editable: boolean; catalog: Activity[]; onSaved: (a: Activity) => void }) {
  const [form, setForm] = useState<ActivityInput>(activity ? activityInput(activity) : emptyActivity)
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => activitiesApi.save(form, activity?.id), onSuccess: a => { client.invalidateQueries({ queryKey: ['activities'] }); onSaved(a) } })
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <fieldset disabled={!editable || save.isPending} className="space-y-4">
      {([['title', 'Название', 500], ['direction', 'Направление', 255], ['kind', 'Тип активности', 100], ['organizer', 'Организатор', 500], ['country', 'Страна', 500], ['source_url', 'Ссылка организатора', 2048]] as const).map(([key, label, max]) => <label key={key} className="block text-sm font-semibold">{label}<Input className="mt-1" required={key === 'title'} maxLength={max} type={key === 'source_url' ? 'url' : 'text'} list={key === 'direction' || key === 'kind' ? `activity-${key}` : undefined} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value || (key === 'title' ? '' : null) })} /></label>)}
      {(['direction', 'kind'] as const).map(key => <datalist id={`activity-${key}`} key={key}>{[...new Set(catalog.map(a => a[key]).filter(Boolean))].map(v => <option key={v} value={v!} />)}</datalist>)}
      {([['description', 'О чём это'], ['eligibility', 'Кто может участвовать'], ['assignment', 'Что нужно сделать']] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold">{label}<Textarea className="mt-1 min-h-24" maxLength={20000} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value || null })} /></label>)}
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Публикация<select className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" value={form.publication} onChange={e => setForm({ ...form, publication: e.target.value as Activity['publication'] })}>{Object.entries(PUBLICATION).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label className="block text-sm font-semibold">Условия проверены<Input className="mt-1" type="date" value={form.conditions_checked_at ?? ''} onChange={e => setForm({ ...form, conditions_checked_at: e.target.value || null })} /></label></div>
    </fieldset>
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
    {editable && <AppButton type="submit" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Сохраняем…' : 'Сохранить данные'}</AppButton>}
  </form>
}
