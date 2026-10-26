import React, { useContext, useEffect, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Save, Trash2 } from 'lucide-react'
import { roadmapApi, RoadmapTemplate, TemplateSaveInput } from '@/api/roadmap'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { PageHeader } from '@/components/ui'
import { useToast } from '@/hooks/use-toast'

export function templateDraft(tpl: RoadmapTemplate): TemplateSaveInput {
  return {
    name: tpl.name, country_name: tpl.country_name, degree: tpl.degree,
    year: tpl.year, description: tpl.description, revision: tpl.revision,
    stages: tpl.stages.map(s => ({
      name: s.name, description: s.description,
      tasks: s.tasks.map(t => ({
        title: t.title, description: t.description, expected_result: t.expected_result,
        needs_document: t.needs_document, needs_zoom: t.needs_zoom,
        questionnaire_url: t.questionnaire_url, source_notion_page_id: t.source_notion_page_id,
        priority: t.priority, audience: t.audience, due_offset_days: t.due_offset_days,
        subtasks: t.subtasks.map(st => ({ title: st.title, due_offset_days: st.due_offset_days, source_notion_page_id: st.source_notion_page_id })),
      })),
    })),
  }
}

const leaveMessage = 'Есть несохранённые изменения. Выйти без сохранения?'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-p-muted">{label}{children}</label>
}
const textareaClass = 'min-h-[72px] w-full rounded-ctl border border-p-line bg-background px-3 py-2 text-sm text-p-text'
const selectClass = 'h-10 w-full rounded-ctl border border-p-line bg-background px-3 text-sm text-p-text'

function Offset({ value, onChange }: { value?: number | null; onChange: (n: number | null) => void }) {
  return <Field label="Срок после назначения, дней"><Input type="number" min={0} max={36500} step={1} value={value ?? ''} placeholder="Без срока" onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></Field>
}

function Order({ index, count, label, move, remove }: { index: number; count: number; label: string; move: (by: number) => void; remove: () => void }) {
  return <div className="flex shrink-0 items-center gap-1">
    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={index === 0} aria-label={`${label}: вверх`} onClick={() => move(-1)}><ArrowUp className="h-4 w-4" /></Button>
    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={index === count - 1} aria-label={`${label}: вниз`} onClick={() => move(1)}><ArrowDown className="h-4 w-4" /></Button>
    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" aria-label={`${label}: удалить`} onClick={() => { if (window.confirm(`Удалить ${label.toLowerCase()}?`)) remove() }}><Trash2 className="h-4 w-4" /></Button>
  </div>
}

function swap<T>(items: T[], index: number, by: number) {
  const target = index + by
  if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]]
}

export function TemplateEditor({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const [draft, setDraft] = useState<TemplateSaveInput | null>(null)
  const [baseline, setBaseline] = useState('')
  const [conflict, setConflict] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const draftKey = `roadmap-template-draft:${templateId}`
  const clearStoredDraft = React.useCallback(() => {
    try { sessionStorage.removeItem(draftKey) } catch { /* Storage may be disabled. */ }
  }, [draftKey])
  const { data: tpl, isLoading, isError, refetch } = useQuery({ queryKey: ['roadmap-template', templateId], queryFn: () => roadmapApi.getTemplate(templateId) })
  useEffect(() => {
    if (tpl && !draft) {
      const initial = templateDraft(tpl)
      let restored: TemplateSaveInput | null = null
      try {
        const cached = JSON.parse(sessionStorage.getItem(draftKey) || 'null')
        if (typeof cached?.name === 'string' && Array.isArray(cached.stages) && Number.isInteger(cached.revision)) restored = cached
      } catch { /* Invalid or unavailable session storage. */ }
      setDraft(restored || initial)
      setBaseline(JSON.stringify(initial))
      setRecovered(restored !== null)
      setConflict(restored !== null && restored.revision !== initial.revision)
    }
  }, [tpl, draft, draftKey])
  const dirty = draft !== null && JSON.stringify(draft) !== baseline
  // Keep a recoverable draft even for browser-history gestures that bypass BrowserRouter's navigator.
  useEffect(() => {
    if (dirty) {
      try { sessionStorage.setItem(draftKey, JSON.stringify(draft)) } catch { /* Before-unload protection still applies. */ }
    } else if (draft) clearStoredDraft()
  }, [dirty, draft, draftKey, clearStoredDraft])
  const save = useMutation({
    mutationFn: (body: TemplateSaveInput) => roadmapApi.saveTemplate(templateId, body),
    onSuccess: saved => {
      const next = templateDraft(saved)
      setDraft(next)
      setBaseline(JSON.stringify(next))
      setConflict(false)
      setRecovered(false)
      clearStoredDraft()
      queryClient.setQueryData(['roadmap-template', templateId], saved)
      queryClient.invalidateQueries({ queryKey: ['roadmap-templates'] })
      toast({ title: 'Шаблон сохранён', description: 'Изменения применятся к новым назначениям.' })
    },
    onError: (error: { response?: { status?: number; data?: { detail?: unknown } } }) => {
      const detail = error.response?.data?.detail
      if (error.response?.status === 409) setConflict(true)
      toast({ title: 'Не удалось сохранить шаблон', description: typeof detail === 'string' ? detail : 'Проверьте поля и попробуйте ещё раз.', variant: 'destructive' })
    },
  })

  useEffect(() => {
    if (!dirty && !save.isPending) return
    const confirmLeave = () => {
      if (save.isPending || !window.confirm(leaveMessage)) return false
      clearStoredDraft()
      return true
    }
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    // BrowserRouter's navigator is also used by sidebar links and programmatic navigation.
    const push = navigator.push, replace = navigator.replace, go = navigator.go
    navigator.push = (...args) => { if (confirmLeave()) push.apply(navigator, args) }
    navigator.replace = (...args) => { if (confirmLeave()) replace.apply(navigator, args) }
    navigator.go = (...args) => { if (confirmLeave()) go.apply(navigator, args) }
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      navigator.push = push; navigator.replace = replace; navigator.go = go
    }
  }, [dirty, save.isPending, navigator, clearStoredDraft])

  function update(fn: (next: TemplateSaveInput) => void) {
    setDraft(prev => {
      if (!prev) return prev
      const next: TemplateSaveInput = JSON.parse(JSON.stringify(prev))
      fn(next)
      return next
    })
  }
  const back = () => { if (!save.isPending && (!dirty || window.confirm(leaveMessage))) { clearStoredDraft(); onBack() } }
  const reload = async () => {
    if (dirty && !window.confirm('Загрузить текущую версию? Ваши несохранённые изменения будут потеряны.')) return
    const result = await refetch()
    if (result.data && !result.isError) {
      const next = templateDraft(result.data)
      setDraft(next); setBaseline(JSON.stringify(next)); setConflict(false); setRecovered(false); clearStoredDraft()
    }
  }
  return <div className="mx-auto w-full max-w-5xl">
    <button type="button" onClick={back} disabled={save.isPending} className="mb-4 inline-flex items-center gap-1.5 text-sm text-p-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" />К списку шаблонов</button>
    <PageHeader eyebrow="Редактор шаблона" title={tpl?.name || 'Шаблон Roadmap'} />
    {isLoading && <p role="status">Загружаем шаблон…</p>}
    {isError && !draft && <div role="alert">Не удалось загрузить шаблон. <Button type="button" onClick={() => refetch()}>Повторить</Button></div>}
    {draft && <form onSubmit={e => { e.preventDefault(); if (dirty && !save.isPending && !conflict) save.mutate(draft) }}>
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-card p-3">
        <span className="text-xs text-p-muted" role="status">{save.isPending ? 'Сохраняем…' : dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>
        <Button type="submit" size="sm" disabled={!dirty || save.isPending || conflict}><Save className="mr-2 h-4 w-4" />Сохранить шаблон</Button>
      </div>
      <p className="mb-4 text-sm text-p-muted">Изменения применятся к новым назначениям. Уже назначенные студентам roadmap сохранятся.</p>
      {(tpl?.source_notion_db_id || tpl?.locally_edited) && <p className="mb-4 rounded-panel border border-border bg-muted p-3 text-sm text-p-muted">После сохранения шаблон защищён от перезаписи при импорте Notion.</p>}
      {recovered && <p className="mb-4 text-sm text-p-muted">Восстановлены несохранённые изменения из этой вкладки.</p>}
      {conflict && <div role="alert" className="mb-4 rounded-panel border border-amber-400 p-3 text-sm">Другой сотрудник или импорт изменил шаблон. Скопируйте нужные правки перед загрузкой текущей версии. <Button type="button" variant="outline" onClick={reload}>Загрузить текущую версию</Button></div>}
      <fieldset disabled={save.isPending} className="min-w-0 space-y-5">
        <section className="space-y-3 rounded-panel border border-border bg-card p-4" aria-label="Настройки шаблона">
          <h2 className="text-sm font-semibold">Настройки шаблона</h2>
          <Field label="Название шаблона"><Input required maxLength={300} pattern=".*\S.*" value={draft.name} onChange={e => update(d => { d.name = e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Страна"><Input maxLength={200} value={draft.country_name ?? ''} onChange={e => update(d => { d.country_name = e.target.value || null })} /></Field>
            <Field label="Уровень обучения"><select className={selectClass} value={draft.degree} onChange={e => update(d => { d.degree = e.target.value })}><option value="bachelors">Бакалавриат</option><option value="masters">Магистратура</option>{draft.degree && !['bachelors', 'masters'].includes(draft.degree) && <option value={draft.degree}>{draft.degree}</option>}</select></Field>
            <Field label="Год поступления"><Input required type="number" min={2000} max={2200} step={1} value={draft.year || ''} onChange={e => update(d => { d.year = Number(e.target.value) })} /></Field>
          </div>
          <Field label="Описание шаблона"><textarea className={textareaClass} value={draft.description ?? ''} onChange={e => update(d => { d.description = e.target.value })} /></Field>
        </section>
        {draft.stages.map((stage, si) => <section key={si} className="space-y-3 rounded-panel border border-border bg-card p-4" aria-label={`Этап ${si + 1}`}>
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Этап {si + 1}</h2><Order label={`Этап ${si + 1}`} index={si} count={draft.stages.length} move={by => update(d => swap(d.stages, si, by))} remove={() => update(d => { d.stages.splice(si, 1) })} /></div>
          <Field label="Название этапа"><Input required maxLength={300} pattern=".*\S.*" value={stage.name} onChange={e => update(d => { d.stages[si].name = e.target.value })} /></Field>
          <Field label="Описание этапа"><textarea className={textareaClass} value={stage.description ?? ''} onChange={e => update(d => { d.stages[si].description = e.target.value })} /></Field>
          {(stage.tasks ?? []).map((task, ti) => <div key={ti} className="space-y-3 rounded-panel border border-border bg-muted/30 p-3" role="group" aria-label={`Задача ${si + 1}.${ti + 1}`}>
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Задача {si + 1}.{ti + 1}</h3><Order label={`Задача ${si + 1}.${ti + 1}`} index={ti} count={stage.tasks!.length} move={by => update(d => swap(d.stages[si].tasks!, ti, by))} remove={() => update(d => { d.stages[si].tasks!.splice(ti, 1) })} /></div>
            <Field label="Название задачи"><Input required maxLength={500} pattern=".*\S.*" value={task.title} onChange={e => update(d => { d.stages[si].tasks![ti].title = e.target.value })} /></Field>
            <Field label="Описание задачи"><textarea className={textareaClass} value={task.description ?? ''} onChange={e => update(d => { d.stages[si].tasks![ti].description = e.target.value })} /></Field>
            <Field label="Ожидаемый результат"><textarea className={textareaClass} value={task.expected_result ?? ''} onChange={e => update(d => { d.stages[si].tasks![ti].expected_result = e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Приоритет"><select className={selectClass} value={task.priority ?? 'required'} onChange={e => update(d => { d.stages[si].tasks![ti].priority = e.target.value as typeof task.priority })}><option value="required">Обязательно</option><option value="recommended">Желательно</option><option value="optional">По желанию</option></select></Field>
              <Field label="Исполнитель"><select className={selectClass} value={task.audience ?? 'applicant'} onChange={e => update(d => { d.stages[si].tasks![ti].audience = e.target.value as typeof task.audience })}><option value="applicant">Студент</option><option value="coordinator">Координатор</option></select></Field>
              <Offset value={task.due_offset_days} onChange={n => update(d => { d.stages[si].tasks![ti].due_offset_days = n })} />
            </div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={task.needs_document ?? false} onChange={e => update(d => { d.stages[si].tasks![ti].needs_document = e.target.checked })} />Нужен документ</label><label className="flex items-center gap-2"><input type="checkbox" checked={task.needs_zoom ?? false} onChange={e => update(d => { d.stages[si].tasks![ti].needs_zoom = e.target.checked })} />Нужна встреча Zoom</label></div>
            <Field label="Ссылка на анкету"><Input inputMode="url" maxLength={2048} value={task.questionnaire_url ?? ''} onChange={e => update(d => { d.stages[si].tasks![ti].questionnaire_url = e.target.value || null })} /></Field>
            {(task.subtasks ?? []).map((sub, sti) => <div key={sti} className="grid items-end gap-2 rounded-ctl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" role="group" aria-label={`Подзадача ${si + 1}.${ti + 1}.${sti + 1}`}>
              <Field label="Название подзадачи"><Input required maxLength={500} pattern=".*\S.*" value={sub.title} onChange={e => update(d => { d.stages[si].tasks![ti].subtasks![sti].title = e.target.value })} /></Field>
              <Offset value={sub.due_offset_days} onChange={n => update(d => { d.stages[si].tasks![ti].subtasks![sti].due_offset_days = n })} />
              <Order label={`Подзадача ${si + 1}.${ti + 1}.${sti + 1}`} index={sti} count={task.subtasks!.length} move={by => update(d => swap(d.stages[si].tasks![ti].subtasks!, sti, by))} remove={() => update(d => { d.stages[si].tasks![ti].subtasks!.splice(sti, 1) })} />
            </div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => update(d => { (d.stages[si].tasks![ti].subtasks ??= []).push({ title: '', due_offset_days: null }) })}><Plus className="mr-1 h-4 w-4" />Добавить подзадачу</Button>
          </div>)}
          <Button type="button" variant="outline" size="sm" onClick={() => update(d => { (d.stages[si].tasks ??= []).push({ title: '', description: '', expected_result: '', priority: 'required', audience: 'applicant', due_offset_days: null, needs_document: false, needs_zoom: false, questionnaire_url: null, subtasks: [] }) })}><Plus className="mr-1 h-4 w-4" />Добавить задачу</Button>
        </section>)}
        <Button type="button" variant="outline" className="w-full" onClick={() => update(d => { d.stages.push({ name: '', description: '', tasks: [] }) })}><Plus className="mr-2 h-4 w-4" />Добавить этап</Button>
      </fieldset>
    </form>}
  </div>
}
