import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, Check, MoreHorizontal, Plus } from 'lucide-react'
import { activitiesApi, type Activity, type ActivityInput, type ExperienceKey, type Intake, type IntakeInput, type TemplateStep } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryState } from '@/components/shared/QueryState'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errorMessage'
import { intakeCost, intakeWhen, publishIssues } from '@/lib/activityUi'
import { SHELF_TYPES } from '@/lib/portfolio/dictionary'
import { activityInput, emptyActivity, STANDARD_KINDS } from './ActivityDataForm'
import { IntakeEditor } from './IntakeEditor'
import { TemplateBuilder } from './TemplateBuilder'

export type ComposerNext = 'stay' | 'recommend'
type SaveAction = 'draft' | 'publish' | 'recommend' | 'save'

const blankIntake = (): IntakeInput => ({ label: '', mode: 'fixed', deadline: null, dates_text: null, format: null, cost_state: 'unknown', cost_text: null })
/** Первый набор создаём, только если о сроках или цене что-то известно. */
const intakeFilled = (i: IntakeInput) => i.mode !== 'unknown' || !!i.deadline || i.cost_state !== 'unknown'
const cleanSteps = (steps: TemplateStep[]) => steps.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim(), subtasks: s.subtasks.map((t) => t.trim()).filter(Boolean) }))

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="space-y-3">
    <div><h3 className="font-bold">{title}</h3>{hint && <p className="mt-0.5 text-xs text-ds-muted">{hint}</p>}</div>
    {children}
  </section>
}

function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t) }, [value, ms])
  return debounced
}

/**
 * Активность целиком на одном экране: что это, сроки, типовые шаги — и одна
 * кнопка внизу. Новая активность сохраняется одним запросом, без пустых черновиков.
 */
export function ActivityComposer({ activity, catalog, editable, presetType, onSaved, onDuplicated }: {
  activity: Activity | null; catalog: Activity[]; editable: boolean; presetType?: ExperienceKey
  onSaved: (activity: Activity, next: ComposerNext) => void; onDuplicated: (activity: Activity) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<ActivityInput>(() => activity ? activityInput(activity) : { ...emptyActivity, experience_type: presetType ?? null })
  const [intake, setIntake] = useState<IntakeInput>(blankIntake)
  const [steps, setSteps] = useState<TemplateStep[] | null>(activity ? null : [])
  const [stepsDirty, setStepsDirty] = useState(false)
  const [intakeEdit, setIntakeEdit] = useState<Intake | 'new' | null>(null)
  const set = <K extends keyof ActivityInput>(key: K, value: ActivityInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  const template = useQuery({ queryKey: ['activities', 'template', activity?.id], queryFn: () => activitiesApi.template(activity!.id), enabled: !!activity })
  useEffect(() => { if (template.data && steps === null) setSteps(template.data) }, [template.data, steps])
  const intakes = useQuery({ queryKey: ['activities', 'intakes', activity?.id], queryFn: () => activitiesApi.intakes(activity!.id), enabled: !!activity })

  const title = useDebounced(form.title.trim()), url = useDebounced(form.source_url?.trim() ?? '')
  const dupes = useQuery({ queryKey: ['activities', 'duplicates', title, url, activity?.id], queryFn: () => activitiesApi.duplicates({ title, source_url: url, ...(activity ? { exclude: activity.id } : {}) }),
    enabled: editable && (title.length >= 4 || url.length > 8), staleTime: 30_000 })

  const type = form.experience_type ?? guessFromKind(form.kind)
  const knownIntakes = activity ? intakes.data ?? [] : intakeFilled(intake) ? [intake] : []
  const issues = publishIssues(form, knownIntakes)
  // Набор без дедлайна: сроки шагов «через N дней после добавления в план».
  const relative = knownIntakes.length > 0 && knownIntakes.every((i) => i.mode === 'rolling' || i.mode === 'self_paced')

  const save = useMutation({
    mutationFn: async (action: SaveAction) => {
      const publication = action === 'draft' ? 'draft' : action === 'save' ? form.publication : 'published'
      const body = { ...form, title: form.title.trim(), publication }
      if (!activity) return activitiesApi.createFull({ activity: body, intake: intakeFilled(intake) ? intake : null, steps: cleanSteps(steps ?? []) })
      const saved = await activitiesApi.save(body, activity.id)
      if (stepsDirty && steps) await activitiesApi.saveTemplate(activity.id, cleanSteps(steps))
      return saved
    },
    onSuccess: (saved, action) => {
      client.invalidateQueries({ queryKey: ['activities'] })
      setForm(activityInput(saved)); setStepsDirty(false)
      onSaved(saved, action === 'recommend' ? 'recommend' : 'stay')
    },
  })
  const duplicate = useMutation({ mutationFn: () => activitiesApi.duplicate(activity!.id), onSuccess: (copy) => { client.invalidateQueries({ queryKey: ['activities'] }); onDuplicated(copy) } })
  const nextSeason = useMutation({ mutationFn: (i: Intake) => activitiesApi.nextSeason(activity!.id, i.id), onSuccess: () => client.invalidateQueries({ queryKey: ['activities'] }) })

  const text = (key: 'title' | 'organizer' | 'country' | 'source_url' | 'kind' | 'direction', label: string, max: number, props: Record<string, unknown> = {}) =>
    <label className="block text-sm font-semibold">{label}<Input className="mt-1" maxLength={max} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value || (key === 'title' ? '' : null))} {...props} /></label>

  return <div className="space-y-8">
    <fieldset disabled={!editable || save.isPending} className="space-y-8">
      <Section title="Что это">
        {text('title', 'Название', 500, { required: true, placeholder: 'Например: Олимпиада «Высшая проба» по математике', autoFocus: !activity })}
        <div role="radiogroup" aria-label="Тип опыта" className="space-y-2">
          <p className="text-sm font-semibold">Тип опыта <span className="font-normal text-ds-muted">— по нему ученик видит, чего не хватает в портфолио</span></p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SHELF_TYPES.map((t) => {
              const chosen = form.experience_type === t.key, guessed = !form.experience_type && type === t.key
              return <button key={t.key} type="button" role="radio" aria-checked={chosen} onClick={() => set('experience_type', chosen ? null : t.key)}
                className={cn('rounded-panel border px-3 py-2 text-left text-xs font-bold transition', chosen ? 'border-ds-ink bg-ds-ink text-ds-bg' : guessed ? 'border-dashed border-ds-muted2 text-ds-ink' : 'border-ds-line text-ds-muted hover:border-ds-muted2 hover:text-ds-ink')}>
                {t.short}{guessed && <span className="block text-2xs font-normal text-ds-muted">по названию типа</span>}
              </button>
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('kind', 'Подзаголовок (необязательно)', 100, { list: 'composer-kind', placeholder: 'Например: командный конкурс' })}
          {text('direction', 'Направление', 255, { list: 'composer-direction' })}
          {text('organizer', 'Организатор', 500)}
          {text('country', 'Страна', 500)}
        </div>
        {text('source_url', 'Ссылка организатора', 2048, { type: 'url', placeholder: 'https://', id: 'composer-source_url' })}
        <datalist id="composer-kind">{[...new Set([...STANDARD_KINDS, ...catalog.map((a) => a.kind).filter(Boolean)])].map((v) => <option key={v} value={v!} />)}</datalist>
        <datalist id="composer-direction">{[...new Set(catalog.map((a) => a.direction).filter(Boolean))].map((v) => <option key={v} value={v!} />)}</datalist>
        {!!dupes.data?.length && <div role="status" className="flex gap-3 rounded-panel border border-ds-accent-dim bg-ds-accent/[0.07] p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ds-accentText" aria-hidden />
          <div><p className="font-semibold">Похожее уже есть в каталоге</p><ul className="mt-1 space-y-0.5 text-ds-muted">{dupes.data.map((d) => <li key={d.id}>«{d.title}» · {d.reason === 'title' ? 'то же название' : 'тот же сайт'}{d.publication === 'archived' ? ' · в архиве' : d.publication === 'draft' ? ' · черновик' : ''}</li>)}</ul></div>
        </div>}
      </Section>

      <Section title="Что увидит ученик" hint="Без описания опубликовать нельзя. Можно сохранить черновик.">
        {([['description', 'О чём это'], ['eligibility', 'Кто может участвовать'], ['assignment', 'Что нужно сделать']] as const).map(([key, label]) =>
          <label key={key} className="block text-sm font-semibold">{label}<Textarea id={`composer-${key}`} className="mt-1 min-h-20" maxLength={20000} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value || null)} /></label>)}
        <label className="block text-sm font-semibold sm:w-1/2">Условия сверены с сайтом<Input className="mt-1" type="date" value={form.conditions_checked_at ?? ''} onChange={(e) => set('conditions_checked_at', e.target.value || null)} /></label>
      </Section>
    </fieldset>

    <Section title="Сроки и стоимость" hint="Набор это сезон: свой дедлайн и цена. На следующий год есть кнопка «Новый сезон».">
      <span id="composer-intake" />
      {activity
        ? <QueryState isLoading={intakes.isLoading} isError={intakes.isError} error={intakes.error} onRetry={() => intakes.refetch()}>
            <ul className="space-y-2">{intakes.data?.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-panel border border-ds-line bg-ds-panel p-3">
              <div className="min-w-0 flex-1"><p className="font-semibold">{i.label}</p><p className="text-xs text-ds-muted">{intakeWhen(i)} · {intakeCost(i)}</p></div>
              {editable && <div className="flex gap-3 text-xs font-bold"><button type="button" className="underline underline-offset-4" onClick={() => setIntakeEdit(i)}>Изменить</button><button type="button" disabled={nextSeason.isPending} className="underline underline-offset-4" onClick={() => nextSeason.mutate(i)}>Новый сезон</button></div>}
            </li>)}</ul>
            {!intakes.data?.length && <p className="text-sm text-ds-muted">Наборов пока нет — без него ученику нечего выбрать.</p>}
            {intakeEdit ? <IntakeEditor key={intakeEdit === 'new' ? 'new' : intakeEdit.id} activityId={activity.id} intake={intakeEdit === 'new' ? undefined : intakeEdit} onClose={() => setIntakeEdit(null)} />
              : editable && <AppButton size="sm" variant="subtle" onClick={() => setIntakeEdit('new')}><Plus className="h-4 w-4" />Добавить набор</AppButton>}
            {nextSeason.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(nextSeason.error)}</p>}
          </QueryState>
        : <fieldset disabled={!editable || save.isPending} className="space-y-3 rounded-panel border border-ds-line p-4">
            <div role="radiogroup" aria-label="Когда набор" className="flex flex-wrap gap-2">
              {([['fixed', 'Есть дедлайн'], ['rolling', 'Принимают постоянно'], ['self_paced', 'В своём темпе'], ['unknown', 'Пока неизвестно']] as const).map(([mode, label]) =>
                <button key={mode} type="button" role="radio" aria-checked={intake.mode === mode} onClick={() => setIntake({ ...intake, mode, deadline: mode === 'fixed' ? intake.deadline : null })}
                  className={cn('rounded-pill border px-3 py-1.5 text-xs font-bold', intake.mode === mode ? 'border-ds-ink bg-ds-ink text-ds-bg' : 'border-ds-line text-ds-muted hover:text-ds-ink')}>{label}</button>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {intake.mode === 'fixed' && <label className="block text-sm font-semibold">Дедлайн организатора<Input className="mt-1" type="date" value={intake.deadline ?? ''} onChange={(e) => setIntake({ ...intake, deadline: e.target.value || null })} /></label>}
              <label className="block text-sm font-semibold">Название набора<Input className="mt-1" maxLength={255} value={intake.label} placeholder="Пусто: по дате, например «Осень 2026»" onChange={(e) => setIntake({ ...intake, label: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Стоимость<select className="mt-1 w-full rounded-ctl border border-ds-line bg-ds-panel p-2.5 text-sm" value={intake.cost_state} onChange={(e) => setIntake({ ...intake, cost_state: e.target.value as IntakeInput['cost_state'] })}><option value="unknown">Уточняется</option><option value="free">Бесплатно</option><option value="paid">Платно</option></select></label>
              {intake.cost_state === 'paid' && <label className="block text-sm font-semibold">Цена<Input className="mt-1" maxLength={500} value={intake.cost_text ?? ''} onChange={(e) => setIntake({ ...intake, cost_text: e.target.value || null })} placeholder="100 USD" /></label>}
              <label className="block text-sm font-semibold">Формат<Input className="mt-1" maxLength={100} value={intake.format ?? ''} onChange={(e) => setIntake({ ...intake, format: e.target.value || null })} placeholder="Онлайн / очно" /></label>
            </div>
          </fieldset>}
    </Section>

    <Section title="Типовые шаги" hint={relative ? 'Подставляются каждому ученику при выдаче, сроки считаются от даты добавления в план. У ученика их можно поправить.' : 'Подставляются каждому ученику при выдаче, сроки считаются от дедлайна набора. У ученика их можно поправить.'}>
      {steps === null ? <QueryState isLoading={template.isLoading} isError={template.isError} error={template.error} onRetry={() => template.refetch()}>{null}</QueryState>
        : <TemplateBuilder steps={steps} type={type} relative={relative} disabled={!editable || save.isPending} onChange={(next) => { setSteps(next); setStepsDirty(true) }} />}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-dashed border-ds-line p-3 text-sm">
        <span><b>Итог</b> <span className="text-ds-muted">· текст и файл · подтверждает ментор</span></span>
        <label className="inline-flex items-center gap-2 text-xs font-semibold"><input type="checkbox" disabled={!editable} checked={!!form.result_requires_file} onChange={(e) => set('result_requires_file', e.target.checked)} />Файл обязателен</label>
      </div>
    </Section>

    {editable && <footer className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-ds-line bg-ds-bg/95 px-5 py-3 backdrop-blur">
      <p className="min-w-0 flex-1 basis-60 text-xs">
        {issues.length
          ? <>Не хватает: {issues.map((issue, n) => <span key={issue}>{n > 0 && ', '}<button type="button" className="font-semibold underline underline-offset-2" onClick={() => focusField(issue)}>{issue.toLocaleLowerCase('ru')}</button></span>)}</>
          : <span className="inline-flex items-center gap-1.5 font-semibold text-ds-good"><Check className="h-3.5 w-3.5" aria-hidden />Готово к публикации</span>}
      </p>
      {(save.isError || duplicate.isError) && <p role="alert" className="basis-full text-sm text-ds-danger">{getErrorMessage(save.error || duplicate.error)}</p>}
      <div className="flex items-center gap-2">
        {activity?.publication === 'published'
          ? <AppButton disabled={save.isPending || !form.title.trim()} onClick={() => save.mutate('save')}>Сохранить</AppButton>
          : <AppButton variant={issues.length ? 'subtle' : undefined} disabled={save.isPending || !form.title.trim() || issues.length > 0} title={issues.length ? 'Сначала заполните недостающее' : undefined} onClick={() => save.mutate('publish')}>Опубликовать</AppButton>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button type="button" aria-label="Другие действия" className="rounded-ctl border border-ds-line p-2.5"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" side="top" className="z-50 rounded-panel border border-ds-line bg-ds-panel p-1 text-sm text-ds-ink shadow-lg">
            {activity?.publication === 'published'
              ? <DropdownMenu.Item disabled={save.isPending} onSelect={() => save.mutate('recommend')} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Рекомендовать</DropdownMenu.Item>
              : <>
                  <DropdownMenu.Item disabled={save.isPending || issues.length > 0} onSelect={() => save.mutate('recommend')} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-ds-panel2">Опубликовать и рекомендовать</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={save.isPending || !form.title.trim()} onSelect={() => save.mutate('draft')} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Сохранить черновик</DropdownMenu.Item>
                </>}
            {activity && <DropdownMenu.Item disabled={duplicate.isPending} onSelect={() => duplicate.mutate()} className="cursor-pointer rounded-ctl px-4 py-2 outline-none data-[highlighted]:bg-ds-panel2">Сделать копию</DropdownMenu.Item>}
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </footer>}
  </div>
}

const ISSUE_FIELD: Record<string, string> = { 'Ссылка организатора': 'composer-source_url', 'Описание': 'composer-description', 'Сроки набора': 'composer-intake', 'Стоимость': 'composer-intake' }

/** «Не хватает: описание» ведёт к полю и подсвечивает его. */
function focusField(issue: string) {
  const el = document.getElementById(ISSUE_FIELD[issue] ?? '')
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus()
  el.classList.add('ring-2', 'ring-ds-danger')
  setTimeout(() => el.classList.remove('ring-2', 'ring-ds-danger'), 1600)
}

// Подсказка в выборе типа, пока ментор не выбрал явно. Сервер решает так же
// (app/services/experience.py); здесь — упрощённо, только для подсветки.
function guessFromKind(kind: string | null): ExperienceKey {
  const v = (kind ?? '').toLowerCase()
  if (/олимпиад|конкурс|хакатон|чемпионат|турнир/.test(v)) return 'competitions'
  if (/стажир|практик/.test(v)) return 'internships'
  if (/волонт|социал|благотвор/.test(v)) return 'social'
  if (/исслед|проект|научн/.test(v)) return 'research'
  if (/школ|академ|программ|лагер|интенсив/.test(v)) return 'programs'
  if (/курс/.test(v)) return 'courses'
  return 'other'
}
