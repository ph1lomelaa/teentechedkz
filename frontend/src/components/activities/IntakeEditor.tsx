import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type Intake } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { getErrorMessage } from '@/lib/errorMessage'

export function IntakeEditor({ activityId, intake, onClose }: { activityId: string; intake?: Intake; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Intake, 'id' | 'activity_id'>>(intake ? { label: intake.label, mode: intake.mode, deadline: intake.deadline, dates_text: intake.dates_text, format: intake.format, cost_state: intake.cost_state, cost_text: intake.cost_text } : { label: '', mode: 'unknown', deadline: null, dates_text: null, format: null, cost_state: 'unknown', cost_text: null })
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => intake ? activitiesApi.updateIntake(activityId, intake.id, form) : activitiesApi.addIntake(activityId, form), onSuccess: () => { client.invalidateQueries({ queryKey: ['activities'] }); onClose() } })
  return <form onSubmit={e => { e.preventDefault(); save.mutate() }} className="space-y-3 rounded-card border border-ds-line p-4">
    <h4 className="font-bold">{intake ? 'Редактировать набор' : 'Новый набор'}</h4>
    <label className="block text-sm">Название набора<Input required maxLength={255} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Например, осень 2026" /></label>
    <label className="block text-sm">Режим<select className="w-full rounded-ctl border border-ds-line bg-ds-panel p-2" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as Intake['mode'] })}><option value="unknown">Уточняется</option><option value="fixed">Фиксированные сроки</option><option value="rolling">Постоянный набор</option><option value="self_paced">В своём темпе</option></select></label>
    <label className="block text-sm">Дедлайн организатора<Input type="date" value={form.deadline ?? ''} onChange={e => setForm({ ...form, deadline: e.target.value || null })} /></label>
    <label className="block text-sm">Уточнение сроков<Input maxLength={20000} value={form.dates_text ?? ''} onChange={e => setForm({ ...form, dates_text: e.target.value || null })} /></label>
    <label className="block text-sm">Формат<Input maxLength={100} value={form.format ?? ''} onChange={e => setForm({ ...form, format: e.target.value || null })} placeholder="Онлайн / очно / гибрид" /></label>
    <label className="block text-sm">Стоимость<select className="w-full rounded-ctl border border-ds-line bg-ds-panel p-2" value={form.cost_state} onChange={e => setForm({ ...form, cost_state: e.target.value as Intake['cost_state'] })}><option value="unknown">Уточняется</option><option value="free">Бесплатно</option><option value="paid">Платно</option></select></label>
    {form.cost_state === 'paid' && <label className="block text-sm">Цена и валюта<Input maxLength={500} value={form.cost_text ?? ''} onChange={e => setForm({ ...form, cost_text: e.target.value || null })} /></label>}
    {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
    <div className="flex gap-2"><AppButton type="submit" disabled={save.isPending || !form.label.trim()}>{intake ? 'Сохранить набор' : 'Добавить набор'}</AppButton><AppButton variant="subtle" disabled={save.isPending} onClick={onClose}>Отмена</AppButton></div>
  </form>
}
