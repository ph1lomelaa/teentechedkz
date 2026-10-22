import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react'
import type { ExperienceKey, TemplateStep } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { EXPERIENCE_TYPES, TEMPLATE_PRESETS } from '@/lib/activityUi'

const field = 'w-full rounded-ctl border border-ds-line bg-ds-panel px-3 py-2 text-sm'
export const blankTemplateStep = (): TemplateStep => ({ title: '', description: '', expected_result: '', priority: 'required', requires_review: false, requires_evidence: false, days_before_deadline: null, subtasks: [] })

/**
 * Типовые шаги активности. При выдаче ученику они становятся его личным планом,
 * а сроки считаются от дедлайна выбранного набора.
 */
export function TemplateBuilder({ steps, onChange, type, disabled = false }: { steps: TemplateStep[]; onChange: (steps: TemplateStep[]) => void; type: ExperienceKey; disabled?: boolean }) {
  const edit = (index: number, patch: Partial<TemplateStep>) => onChange(steps.map((s, i) => i === index ? { ...s, ...patch } : s))
  const move = (index: number, delta: number) => { const next = [...steps]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next) }
  const label = EXPERIENCE_TYPES.find((t) => t.key === type)?.short.toLowerCase() ?? ''
  return <fieldset disabled={disabled} className="space-y-3">
    {!steps.length && <div className="flex flex-wrap items-center gap-3 rounded-panel border border-dashed border-ds-line p-4 text-sm text-ds-muted">
      <span className="min-w-0 flex-1">Шагов пока нет. Их подставят каждому ученику при выдаче — ментору не придётся писать их заново.</span>
      <AppButton size="sm" variant="subtle" onClick={() => onChange(TEMPLATE_PRESETS[type].map((s) => ({ ...s, subtasks: [...s.subtasks] })))}><Wand2 className="h-4 w-4" />Типовые шаги{label ? ` · ${label}` : ''}</AppButton>
    </div>}
    <ol className="space-y-2">
      {steps.map((step, index) => <li key={index} className="space-y-2 rounded-panel border border-ds-line bg-ds-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ds-panel2 text-2xs font-bold text-ds-muted">{index + 1}</span>
          <input aria-label={`Шаг ${index + 1}`} className={`${field} min-w-0 flex-1`} value={step.title} maxLength={500} onChange={(e) => edit(index, { title: e.target.value })} placeholder="Что сделать" />
          <div className="flex gap-1">
            <AppButton size="sm" variant="subtle" aria-label={`Поднять шаг ${index + 1}`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></AppButton>
            <AppButton size="sm" variant="subtle" aria-label={`Опустить шаг ${index + 1}`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></AppButton>
            <AppButton size="sm" variant="subtle" aria-label={`Удалить шаг ${index + 1}`} onClick={() => onChange(steps.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></AppButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 text-xs">
          <label className="inline-flex items-center gap-1.5">За
            <input type="number" min={0} max={730} aria-label={`Дней до дедлайна, шаг ${index + 1}`} className="w-16 rounded-ctl border border-ds-line bg-ds-panel px-2 py-1" value={step.days_before_deadline ?? ''}
              onChange={(e) => edit(index, { days_before_deadline: e.target.value === '' ? null : Math.max(0, Math.min(730, Number(e.target.value))) })} placeholder="—" />
            дн. до дедлайна</label>
          <label className="inline-flex items-center gap-1.5"><select className="rounded-ctl border border-ds-line bg-ds-panel px-2 py-1" value={step.priority} onChange={(e) => edit(index, { priority: e.target.value as TemplateStep['priority'] })}><option value="required">Обязательно</option><option value="recommended">Желательно</option><option value="optional">По желанию</option></select></label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={step.requires_review} onChange={(e) => edit(index, { requires_review: e.target.checked })} />Проверка ментора</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={step.requires_evidence} onChange={(e) => edit(index, { requires_evidence: e.target.checked })} />Нужен файл</label>
        </div>
        <details className="pl-8 text-sm"><summary className="cursor-pointer text-xs font-semibold text-ds-muted">Описание и чеклист</summary><div className="mt-2 space-y-2">
          <label className="block text-xs">Описание<Textarea value={step.description} maxLength={20000} onChange={(e) => edit(index, { description: e.target.value })} /></label>
          <label className="block text-xs">Ожидаемый результат<Textarea value={step.expected_result} maxLength={10000} onChange={(e) => edit(index, { expected_result: e.target.value })} /></label>
          <label className="block text-xs">Чеклист · один пункт на строку<Textarea value={step.subtasks.join('\n')} onChange={(e) => edit(index, { subtasks: e.target.value.split('\n') })} /></label>
        </div></details>
      </li>)}
    </ol>
    <AppButton size="sm" variant="subtle" disabled={steps.length >= 50} onClick={() => onChange([...steps, blankTemplateStep()])}><Plus className="h-4 w-4" />Добавить шаг</AppButton>
  </fieldset>
}
