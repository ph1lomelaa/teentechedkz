import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, type ExperienceKey, type HistoricalInput, type Participation } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { EXPERIENCE_LABEL } from '@/lib/activityUi'
import { getErrorMessage } from '@/lib/errorMessage'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'

export function HistoricalDialog({ studentId, item, onClose }: { studentId?: string; item?: Participation; onClose: () => void }) {
  const client = useQueryClient()
  const [form, setForm] = useState<HistoricalInput>(() => ({ request_key: crypto.randomUUID(), title: item?.activity.title ?? '', experience_type: item?.activity.experience_type ?? 'other', period: item?.participation_period ?? '', role: item?.participation_role ?? '', result: item?.result_text ?? '', organizer: item?.activity.organizer ?? '', source_url: item?.activity.source_url ?? '' }))
  const save = useMutation({ mutationFn: () => activitiesApi.saveHistorical(form, studentId, item?.id), onSuccess: () => { ['activities', 'portal', 'workspace'].forEach(k => client.invalidateQueries({ queryKey: [k] })); onClose() } })
  const inputClass = 'mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3 font-normal'
  const field = (key: 'title' | 'period' | 'role' | 'organizer' | 'source_url', label: string, max: number, placeholder?: string) => <label className="block text-sm font-semibold">{label}<input className={inputClass} type={key === 'source_url' ? 'url' : 'text'} required={key === 'title' || key === 'period'} maxLength={max} placeholder={placeholder} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose() }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{item ? 'Изменить прошлую активность' : 'Добавить прошлую активность'}</DialogTitle><DialogDescription>Для опыта, который уже завершён. Он появится в достижениях; результат проверит ментор. Дедлайн подачи, стоимость и план шагов не нужны.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate() }}>
      {field('title', 'Название активности', 500)}
      <label className="block text-sm font-semibold">Тип опыта<select aria-label="Тип опыта" className={inputClass} value={form.experience_type} onChange={e => setForm({ ...form, experience_type: e.target.value as ExperienceKey })}>{Object.entries(EXPERIENCE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {field('period', 'Период участия', 255, 'Например: 2024 или лето 2025')}
      {field('role', 'Роль ученика — необязательно', 500, 'Участник, капитан команды, волонтёр')}
      <label className="block text-sm font-semibold">Результат участия<textarea required maxLength={20000} className={inputClass} rows={3} value={form.result} onChange={e => setForm({ ...form, result: e.target.value })} placeholder="Что сделал ученик, чему научился, какое место занял" /></label>
      {field('organizer', 'Организатор — необязательно', 500)}
      {field('source_url', 'Ссылка организатора — необязательно', 2048, 'https://')}
      <p className="text-xs text-ds-muted">Если ссылка не сохранилась, оставьте поле пустым. Сертификат или другой файл можно прикрепить после сохранения. После изменения результат снова отправится на проверку.</p>
      {save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)}</p>}
      <div className="flex flex-wrap gap-2"><AppButton type="submit" disabled={save.isPending || !form.title.trim() || !form.period.trim() || !form.result.trim()}>{save.isPending ? 'Сохраняем…' : 'Сохранить и отправить на проверку'}</AppButton><AppButton type="button" variant="subtle" disabled={save.isPending} onClick={onClose}>Отмена</AppButton></div>
    </form>
  </DialogContent></Dialog>
}

export function HistoricalExperience({ item, canManage, own }: { item: Participation; canManage: boolean; own: boolean }) {
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState('')
  const client = useQueryClient()
  const review = useMutation({ mutationFn: (action: 'approve' | 'return') => activitiesApi.reviewResult(item.id, action, comment), onSuccess: () => ['activities', 'portal', 'workspace'].forEach(k => client.invalidateQueries({ queryKey: [k] })) })
  const pending = item.result_review_status === 'pending'
  return <section className="space-y-4 rounded-card border border-ds-line bg-ds-panel p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{item.activity.title}</h2><StatusTag tone={item.result_review_status === 'approved' ? 'good' : pending ? 'info' : 'danger'}>{item.result_review_status === 'approved' ? 'Подтверждено ментором' : pending ? 'На проверке у ментора' : 'Нужны правки'}</StatusTag></div>
    <p className="text-sm text-ds-muted">Прошлый опыт · {EXPERIENCE_LABEL[item.activity.experience_type ?? 'other']} · {item.participation_period}</p>
    {item.participation_role && <p className="text-sm">Роль: {item.participation_role}</p>}
    {item.activity.organizer && <p className="text-sm">Организатор: {item.activity.organizer}</p>}
    {item.activity.source_url && <a href={item.activity.source_url} target="_blank" rel="noreferrer" className="text-sm underline">Сайт организатора ↗</a>}
    <div><h3 className="text-sm font-bold">Результат участия</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.result_text}</p></div>
    {item.result_review_comment && <p className="whitespace-pre-wrap rounded-ctl bg-ds-panel2 p-3 text-sm">Комментарий ментора: {item.result_review_comment}</p>}
    <PortfolioFiles target={{ participation_id: item.id }} result editable={canManage || own} />
    {(canManage || own) && <AppButton variant="subtle" onClick={() => setEditing(true)}>Изменить прошлую активность</AppButton>}
    {canManage && pending && <div className="space-y-3 border-t border-ds-line pt-4"><label className="block text-sm font-semibold">Комментарий ученику<textarea className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-3" maxLength={5000} value={comment} onChange={e => setComment(e.target.value)} /></label><div className="flex flex-wrap gap-2"><AppButton disabled={review.isPending} onClick={() => review.mutate('approve')}>Подтвердить итог</AppButton><AppButton variant="subtle" disabled={review.isPending || !comment.trim()} onClick={() => review.mutate('return')}>Вернуть на правки</AppButton></div></div>}
    {review.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(review.error)}</p>}
    {editing && <HistoricalDialog item={item} studentId={item.student_id} onClose={() => setEditing(false)} />}
  </section>
}
