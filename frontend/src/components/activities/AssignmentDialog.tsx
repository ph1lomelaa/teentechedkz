import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { activitiesApi, type Activity, type Intake } from '@/api/activities'
import { emptyStep, learnerTasksApi, type StepInput } from '@/api/learnerTasks'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { Textarea } from '@/components/ui/primitives/textarea'
import { QueryState } from '@/components/shared/QueryState'
import { getErrorMessage } from '@/lib/errorMessage'
import { intakeWhen, stepsFromTemplate } from '@/lib/activityUi'

const field = 'w-full rounded-ctl border border-ds-line bg-ds-panel px-3 py-2 text-sm'
const clone = (steps: StepInput[]) => steps.map(s => ({ ...s, subtasks: [...s.subtasks] }))

export function StepBuilder({ steps, onChange }: { steps: StepInput[]; onChange: (steps: StepInput[]) => void }) {
  const edit = (index: number, patch: Partial<StepInput>) => onChange(steps.map((s, i) => i === index ? { ...s, ...patch } : s))
  const move = (index: number, delta: number) => { const next = [...steps]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next) }
  return <div className="space-y-3">
    {!steps.length && <p className="rounded-panel border border-dashed border-ds-line p-5 text-sm text-ds-muted">Добавьте индивидуальные шаги. План можно дополнить и после назначения.</p>}
    {steps.map((step, index) => <section key={index} className="space-y-3 rounded-panel border border-ds-line bg-ds-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Шаг {index + 1}</h3><div className="flex gap-1"><AppButton size="sm" variant="subtle" aria-label={`Поднять шаг ${index + 1}`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Опустить шаг ${index + 1}`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Копировать шаг ${index + 1}`} disabled={steps.length >= 100} onClick={() => onChange([...steps.slice(0, index + 1), { ...step, subtasks: [...step.subtasks] }, ...steps.slice(index + 1)])}><Copy className="h-4 w-4" /></AppButton><AppButton size="sm" variant="subtle" aria-label={`Удалить шаг ${index + 1}`} onClick={() => onChange(steps.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></AppButton></div></div>
      <label className="block text-sm font-semibold">Что сделать<input className={`${field} mt-1`} value={step.title} maxLength={500} onChange={e => edit(index, { title: e.target.value })} placeholder="Например: зарегистрироваться на олимпиаду" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Срок<input className={`${field} mt-1`} type="date" value={step.due_date ?? ''} onChange={e => edit(index, { due_date: e.target.value || null })} /></label><label className="block text-sm">Важность<select className={`${field} mt-1`} value={step.priority} onChange={e => edit(index, { priority: e.target.value as StepInput['priority'] })}><option value="required">Обязательно</option><option value="recommended">Желательно</option><option value="optional">По желанию</option></select></label></div>
      <details className="text-sm"><summary className="cursor-pointer font-semibold text-ds-muted">Описание, проверка и подтверждения</summary><div className="mt-3 space-y-3"><label className="block">Описание<Textarea value={step.description} maxLength={20000} onChange={e => edit(index, { description: e.target.value })} /></label><label className="block">Ожидаемый результат<Textarea value={step.expected_result} maxLength={10000} onChange={e => edit(index, { expected_result: e.target.value })} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={step.requires_review} onChange={e => edit(index, { requires_review: e.target.checked })} />Нужна проверка ментора <span className="text-ds-muted">— для эссе, заявки и других важных шагов</span></label><label className="flex items-center gap-2"><input type="checkbox" checked={step.requires_evidence} onChange={e => edit(index, { requires_evidence: e.target.checked })} />Обязательный файл</label><label className="block">Простой чеклист · один пункт на строку<Textarea value={step.subtasks.join('\n')} onChange={e => edit(index, { subtasks: e.target.value.split('\n') })} placeholder="Проверить почту\nСохранить номер регистрации" /></label></div></details>
      <p className="text-xs text-ds-muted">{step.requires_review ? 'Ученик отправит шаг на проверку.' : 'Ученик закроет шаг сам. Итог участия вы проверите в конце.'}{step.requires_evidence ? ' Для завершения понадобится файл.' : ''}</p>
    </section>)}
    <AppButton variant="subtle" disabled={steps.length >= 100} onClick={() => onChange([...steps, emptyStep()])}><Plus className="h-4 w-4" />Добавить шаг</AppButton>
  </div>
}

export function AssignmentDialog({ activity, intakes, initialStudent, onClose }: { activity: Activity; intakes: Intake[]; initialStudent?: string; onClose: () => void }) {
  const client = useQueryClient()
  const directory = useQuery({ queryKey: ['activities', 'students'], queryFn: activitiesApi.staffStudents })
  const [phase, setPhase] = useState(0)
  const [intakeId, setIntakeId] = useState(intakes[0]?.id ?? '')
  const [selected, setSelected] = useState<string[]>(initialStudent ? [initialStudent] : [])
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState<'selected' | 'suggested'>('selected')
  const [note, setNote] = useState('')
  const [deadline, setDeadline] = useState('')
  const [steps, setStepsState] = useState<StepInput[]>([])
  // Типовые шаги активности подставляются сами, с датами от дедлайна набора.
  // Пока ментор не правил общую заготовку, смена набора пересчитывает даты.
  const template = useQuery({ queryKey: ['activities', 'template', activity.id], queryFn: () => activitiesApi.template(activity.id) })
  const [touched, setTouched] = useState(false)
  const setSteps = (next: StepInput[]) => { setTouched(true); setStepsState(next) }
  const [individual, setIndividual] = useState<Record<string, { steps: StepInput[]; deadline: string }>>({})
  const [editing, setEditing] = useState('')
  const [requestKey] = useState(() => crypto.randomUUID())
  const [report, setReport] = useState<Array<{ student_id: string; status: 'created' | 'existing' | 'error'; participation_id?: string; message?: string }> | null>(null)
  const recipientSteps = (id: string) => individual[id]?.steps ?? steps
  const recipientDeadline = (id: string) => individual[id]?.deadline ?? deadline
  const invalid = selected.some(id => recipientSteps(id).some(s => !s.title.trim() || s.subtasks.length > 100))
  const intake = intakes.find(i => i.id === intakeId)
  useEffect(() => { if (template.data && !touched) setStepsState(stepsFromTemplate(template.data, intake?.deadline)) }, [template.data, intake?.deadline, touched])
  const closed = !intake || (!!intake.deadline && intake.deadline < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' }))
  const name = (id: string) => directory.data?.find(s => s.id === id)?.name ?? id
  const submit = useMutation({ mutationFn: () => activitiesApi.assign({ intake_id: intakeId, decision, recommendation_note: note.trim() || null, request_key: requestKey, recipients: (report ? report.filter(r => r.status === 'error').map(r => r.student_id) : selected).map(id => ({ student_id: id, personal_deadline: recipientDeadline(id) || null, steps: recipientSteps(id) })) }), onSuccess: data => { setReport(previous => previous ? previous.map(p => data.results.find(r => r.student_id === p.student_id) ?? p) : data.results); ['activities', 'portal', 'workspace', 'student-tasks'].forEach(key => client.invalidateQueries({ queryKey: [key] })) } })
  return <Dialog open onOpenChange={open => { if (!open && !submit.isPending) onClose() }}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto text-ds-ink"><DialogHeader><DialogTitle>{decision === 'suggested' ? `Рекомендовать: ${selected.length || ''} ${selected.length === 1 ? 'ученик' : 'учеников'}` : `Добавить в план: ${selected.length || ''} ${selected.length === 1 ? 'ученик' : 'учеников'}`}</DialogTitle><DialogDescription>{activity.title} · индивидуальный план для каждого ученика</DialogDescription></DialogHeader>
    {report ? <div className="space-y-4"><h2 className="text-lg font-bold">Результат выдачи</h2><ul className="divide-y divide-ds-line">{report.map(r => <li key={r.student_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold">{name(r.student_id)}</p><p className={r.status === 'error' ? 'text-ds-danger' : 'text-ds-muted'}>{r.status === 'created' ? 'Активность и план выданы' : r.status === 'existing' ? 'Участие уже существует — план сохранён' : r.message}</p></div>{r.participation_id && <Link className="font-semibold underline" to={`/workspace/activities/participations/${r.participation_id}`} onClick={onClose}>Открыть</Link>}</li>)}</ul>{report.some(r => r.status === 'error') && <AppButton disabled={submit.isPending} onClick={() => submit.mutate()}>Повторить для учеников с ошибкой</AppButton>}<AppButton variant="subtle" onClick={onClose}>Закрыть</AppButton></div> : <>
      <ol className="flex gap-2 border-b border-ds-line pb-4 text-xs sm:text-sm">{['Получатели', 'План шагов', 'Просмотр'].map((label, i) => <li key={label} aria-current={phase === i ? 'step' : undefined} className={`flex-1 rounded-ctl px-2 py-2 ${phase === i ? 'bg-ds-panel2 font-bold' : 'text-ds-muted'}`}>{i + 1}. {label}</li>)}</ol>
      {phase === 0 && <div className="space-y-4"><label className="block text-sm font-semibold">Набор<select className={`${field} mt-1`} value={intakeId} onChange={e => setIntakeId(e.target.value)}><option value="">Выберите набор</option>{intakes.map(i => <option key={i.id} value={i.id}>{i.label} · {intakeWhen(i)}</option>)}</select></label>{closed && <p className="text-sm text-ds-danger">Выберите доступный набор.</p>}<label className="block text-sm font-semibold">Способ выдачи<select className={`${field} mt-1`} value={decision} onChange={e => setDecision(e.target.value as typeof decision)}><option value="selected">Назначить — сразу в план</option><option value="suggested">Рекомендовать — ученик решит</option></select></label><QueryState isLoading={directory.isLoading} isError={directory.isError} error={directory.error} onRetry={() => directory.refetch()}><label className="block text-sm font-semibold">Ученики · выбрано {selected.length}<input className={`${field} my-2`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск ученика" /></label><div className="max-h-60 overflow-y-auto rounded-panel border border-ds-line">{directory.data?.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(s => <label key={s.id} className="flex items-center gap-3 border-b border-ds-line p-3 text-sm last:border-0"><input type="checkbox" checked={selected.includes(s.id)} disabled={!selected.includes(s.id) && selected.length >= 100} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} /><span className="break-words">{s.name}</span></label>)}</div></QueryState><label className="block text-sm font-semibold">Пояснение ученику<Textarea className="mt-1" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label><label className="block text-sm font-semibold">Личный срок участия<input className={`${field} mt-1`} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label></div>}
      {phase === 1 && <div className="space-y-4">{!!template.data?.length && !touched && <p className="rounded-panel bg-ds-panel2 px-3 py-2 text-xs text-ds-muted">Шаги подставлены из типового плана активности{intake?.deadline ? ', сроки — от дедлайна набора' : ''}. Поправьте под учеников при необходимости.</p>}<label className="block text-sm font-semibold">Чьи шаги<select className={`${field} mt-1`} value={editing} onChange={e => { const id = e.target.value; setEditing(id); if (id && !individual[id]) setIndividual(current => ({ ...current, [id]: { steps: clone(steps), deadline } })) }}><option value="">Для всех выбранных учеников (потом можно поправить у каждого)</option>{selected.map(id => <option key={id} value={id}>{name(id)}{individual[id] ? ' · индивидуальный план' : ''}</option>)}</select></label><p className="text-xs text-ds-muted">Индивидуальный план независим от общей заготовки. После выдачи изменения одного ученика не затрагивают остальных.</p>{editing && <label className="block text-sm">Личный срок ученика<input className={`${field} mt-1`} type="date" value={individual[editing]?.deadline ?? deadline} onChange={e => setIndividual(current => ({ ...current, [editing]: { steps: clone(recipientSteps(editing)), deadline: e.target.value } }))} /></label>}<StepBuilder steps={editing ? recipientSteps(editing) : steps} onChange={next => editing ? setIndividual(current => ({ ...current, [editing]: { steps: next, deadline: recipientDeadline(editing) } })) : setSteps(next)} />{invalid && <p className="text-sm text-ds-danger">Заполните названия всех шагов; в чеклисте допускается до 100 пунктов.</p>}</div>}
      {phase === 2 && <div className="space-y-4"><p className="text-sm">{decision === 'selected' ? 'Назначение сразу появится в плане ученика.' : 'Ученик сможет принять рекомендацию или отказаться.'} Регистрацию у организатора нужно выполнить отдельно.</p><p className="text-xs text-ds-muted">Повторная выдача не меняет существующий план.</p>{selected.map(id => <details key={id} className="rounded-panel border border-ds-line p-4"><summary className="cursor-pointer font-semibold">{name(id)} · {recipientSteps(id).length} шагов · {recipientDeadline(id) || 'без личного срока'}</summary><ol className="mt-3 space-y-2 text-sm">{recipientSteps(id).map((s, i) => <li key={i}>{i + 1}. {s.title} · {s.due_date || 'без срока'} · {s.requires_review ? 'проверка ментора' : 'самостоятельно'}{s.requires_evidence ? ' · нужен файл' : ''}</li>)}</ol></details>)}</div>}
      <div className="flex justify-between gap-3 border-t border-ds-line pt-4"><AppButton variant="subtle" disabled={submit.isPending} onClick={() => phase ? setPhase(phase - 1) : onClose()}>{phase ? 'Назад' : 'Отмена'}</AppButton><AppButton disabled={submit.isPending || closed || !selected.length || directory.isError || (phase > 0 && invalid)} onClick={() => phase < 2 ? setPhase(phase + 1) : submit.mutate()}>{submit.isPending ? 'Выдаём…' : phase === 2 ? `${decision === 'selected' ? 'Назначить' : 'Рекомендовать'} · ${selected.length}` : 'Далее'}</AppButton></div>
    </>}
    {submit.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(submit.error)} Повтор запроса не создаст дубли.</p>}
  </DialogContent></Dialog>
}

export function AddParticipationSteps({ studentId, participationId, onClose }: { studentId: string; participationId: string; onClose: () => void }) {
  const [steps, setSteps] = useState<StepInput[]>([emptyStep()])
  const client = useQueryClient()
  const [remaining, setRemaining] = useState<number[]>([])
  const [started, setStarted] = useState(false)
  const requestKeys = useRef<Record<number, string>>({})
  const save = useMutation({ mutationFn: async () => {
    const indexes = started ? remaining : steps.map((_, i) => i)
    setStarted(true); setRemaining(indexes)
    for (const i of indexes) {
      requestKeys.current[i] ??= crypto.randomUUID()
      await learnerTasksApi.create({ ...steps[i], creation_key: requestKeys.current[i], student_id: studentId, activity_participation_id: participationId })
      setRemaining(current => current.filter(index => index !== i))
    }
  }, onSuccess: () => { ['activities', 'portal', 'workspace', 'student-tasks'].forEach(k => client.invalidateQueries({ queryKey: [k] })); onClose() } })
  return <Dialog open onOpenChange={open => !open && !save.isPending && onClose()}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Добавить шаги</DialogTitle><DialogDescription>Индивидуальный план ученика</DialogDescription></DialogHeader><fieldset disabled={save.isPending || started}><StepBuilder steps={steps} onChange={setSteps} /></fieldset>{save.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(save.error)} Уже добавленные шаги сохраняются; повтор продолжит с оставшихся.</p>}<AppButton disabled={!steps.length || steps.some(s => !s.title.trim()) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : started ? 'Продолжить добавление' : 'Добавить в план'}</AppButton></DialogContent></Dialog>
}
