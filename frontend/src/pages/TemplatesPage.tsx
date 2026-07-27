import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
  X,
  RefreshCw,
  Search,
  UploadCloud,
  Eye,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Input } from '@/components/ui/primitives/input'
import { useToast } from '@/hooks/use-toast'
import {
  roadmapApi,
  RoadmapTemplate,
  StageInput,
  TaskInput,
  Priority,
} from '@/api/roadmap'
import { PageHeader } from '@/components/ui'
import { useImportJobs } from '@/contexts/ImportJobsContext'

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'required', label: 'Обязательно' },
  { value: 'recommended', label: 'Желательно' },
  { value: 'optional', label: 'По желанию' },
]

function toStageInputs(tpl: RoadmapTemplate): StageInput[] {
  return tpl.stages.map((s) => ({
    name: s.name,
    description: s.description,
    tasks: s.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      priority: t.priority,
      audience: t.audience,
      due_offset_days: t.due_offset_days,
      subtasks: t.subtasks.map((st) => ({ title: st.title })),
    })),
  }))
}

function renderProgressPercent(current: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}

export const TemplatesPage: React.FC = () => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [only, setOnly] = useState('')
  const {
    setRoadmapJobId: setImportJobId,
    roadmapJob: importJob,
  } = useImportJobs()

  const importPercent =
    importJob?.status === 'done'
      ? 100
      : importJob?.progress?.template_total
        ? renderProgressPercent(importJob.progress.template_index || 0, importJob.progress.template_total)
        : null

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
  })

  React.useEffect(() => {
    if (importJob?.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['roadmap-templates'] })
    }
  }, [importJob?.status, queryClient])

  // create form
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [degree, setDegree] = useState('bachelors')
  const [year, setYear] = useState(new Date().getFullYear() + 1)

  const createMutation = useMutation({
    mutationFn: () =>
      roadmapApi.createTemplate({ name: name.trim(), country_name: country.trim() || null, degree, year }),
    onSuccess: (tpl) => {
      setName('')
      setCountry('')
      queryClient.invalidateQueries({ queryKey: ['roadmap-templates'] })
      setEditingId(tpl.id)
      toast({ title: 'Шаблон создан', description: 'Добавьте этапы и задачи.' })
    },
    onError: () => toast({ title: 'Не удалось создать шаблон', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => roadmapApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roadmap-templates'] })
      toast({ title: 'Шаблон удалён' })
    },
  })

  const notionImportMutation = useMutation({
    mutationFn: (body: Parameters<typeof roadmapApi.startNotionImport>[0]) => roadmapApi.startNotionImport(body),
    onSuccess: (job) => {
      setImportJobId(job.job_id)
      toast({ title: 'Импорт Notion запущен', description: 'Прогресс отображается на странице.' })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const message = typeof detail === 'string' ? detail : detail?.message
      toast({ title: 'Не удалось запустить импорт', description: message, variant: 'destructive' })
      if (detail?.job_id) setImportJobId(detail.job_id)
    },
  })

  const startImport = (mode: 'discover' | 'dry-run' | 'apply') => {
    notionImportMutation.mutate({
      discover_only: mode === 'discover',
      dry_run: mode === 'dry-run',
      skip_subtasks: false,
      only: only.trim() || null,
    })
  }

  if (editingId) {
    return <TemplateEditor templateId={editingId} onBack={() => setEditingId(null)} />
  }

  return (
    <div className="mx-auto w-full">
      <PageHeader
        eyebrow="Roadmap"
        title="Шаблоны дорожных карт"
        description="Создание, импорт и настройка шаблонов поступления."
      />

      <div className="mb-6 rounded-card border border-border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-p-text">Импорт из Notion</h2>
            <p className="mt-1 text-xs leading-relaxed text-p-muted">
              Берёт корневые roadmap-шаблоны из Notion, обновляет существующие по source id и не назначает их студентам автоматически. Анкеты из связанных форм Notion подтягиваются тем же импортом.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='Фильтр: "USA UG" / Foundation'
              value={only}
              onChange={(e) => setOnly(e.target.value)}
              className="h-9 min-w-[220px] text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs"
              disabled={notionImportMutation.isPending || importJob?.status === 'running'}
              onClick={() => startImport('discover')}
            >
              <Search className="w-3.5 h-3.5 mr-2" /> Проверить
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs"
              disabled={notionImportMutation.isPending || importJob?.status === 'running'}
              onClick={() => startImport('dry-run')}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Dry-run
            </Button>
            <Button
              size="sm"
              className="h-9 px-3 text-xs"
              disabled={notionImportMutation.isPending || importJob?.status === 'running'}
              onClick={() => {
                const scoped = only.trim()
                const ok = window.confirm(
                  scoped
                    ? `Импортировать/обновить шаблоны Notion по фильтру "${scoped}"?`
                    : 'Запустить полный импорт Notion? Он может идти долго.'
                )
                if (ok) startImport('apply')
              }}
            >
              <UploadCloud className="w-3.5 h-3.5 mr-2" /> Импорт
            </Button>
          </div>
        </div>

        {importJob && (
          <div className="mt-4 rounded-panel border border-border bg-muted p-3">
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full border border-border bg-card">
              <div
                className={`h-full bg-amber-500 transition-all duration-300 ${importJob.status === 'running' && importPercent === null ? 'w-1/3 animate-pulse' : ''}`}
                style={importPercent !== null ? { width: `${importPercent}%` } : undefined}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-p-text">
                  Job {importJob.job_id.slice(0, 8)} · {importJob.status === 'running' ? 'идёт' : importJob.status === 'done' ? 'готово' : 'ошибка'}
                </div>
                <div className="mt-1 text-xs text-p-muted">{importJob.progress?.message || 'Ожидание статуса…'}</div>
              </div>
              {importJob.progress?.template_total ? (
                <div className="text-xs text-p-muted">
                  Шаблон {importJob.progress.template_index || 0}/{importJob.progress.template_total}
                  {importJob.progress.task_total ? ` · задача ${importJob.progress.task_index || 0}/${importJob.progress.task_total}` : ''}
                </div>
              ) : null}
            </div>

            {importJob.result && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <ImportStat label="Найдено" value={importJob.result.found} />
                <ImportStat label="Создано" value={importJob.result.created} />
                <ImportStat label="Обновлено" value={importJob.result.updated} />
                <ImportStat label="Задач" value={importJob.result.tasks} />
                <ImportStat label="Подзадач" value={importJob.result.subtasks} />
              </div>
            )}

            {importJob.error && <p className="mt-3 text-xs text-red-600">{importJob.error}</p>}

            {importJob.events?.length > 0 && (
              <div className="mt-3 max-h-36 overflow-auto rounded-panel border border-border bg-card p-2 font-mono text-xs text-p-muted">
                {importJob.events.slice(-8).map((event, index) => (
                  <div key={index}>{String(event.message || event.type || '')}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-p-text mb-3">Новый шаблон</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Страна" value={country} onChange={(e) => setCountry(e.target.value)} />
          <select
            value={degree}
            onChange={(e) => setDegree(e.target.value)}
            className="h-10 px-3 text-sm border border-p-line rounded-ctl bg-white"
          >
            <option value="bachelors">Бакалавриат</option>
            <option value="masters">Магистратура</option>
          </select>
          <Input
            type="number"
            placeholder="Год"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <Button
          size="sm"
          className="mt-3 h-9 px-4 text-xs"
          disabled={!name.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <Plus className="w-3.5 h-3.5 mr-2" /> Создать
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-p-muted2">Шаблонов пока нет.</p>
      ) : (
        <div className="divide-y divide-border rounded-card border border-border bg-card">
          {templates.map((t) => (
            <div key={t.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setPreviewId(t.id)}
                  className="group inline-flex max-w-full items-center gap-1.5 text-left text-sm font-semibold text-p-text transition-colors hover:text-brand"
                >
                  <span className="truncate">{t.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
                <div className="text-xs text-p-muted mt-0.5">
                  {[t.country_name, t.degree === 'masters' ? 'Магистратура' : 'Бакалавриат', t.year]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  · {t.stage_count} этапов · {t.task_count} задач
                  {t.source_notion_db_id && <span> · Notion</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setPreviewId(t.id)}>
                  <Eye className="mr-1.5 h-3.5 w-3.5" /> Просмотр
                </Button>
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setEditingId(t.id)}>
                  Редактировать
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Удалить шаблон?')) deleteMutation.mutate(t.id)
                  }}
                  className="h-8 w-8 p-0"
                  aria-label={`Удалить шаблон ${t.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplatePreview templateId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  )
}

const ImportStat: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="rounded-panel border border-border bg-card px-3 py-2">
    <div className="text-2xs uppercase tracking-[0.16em] text-p-muted2">{label}</div>
    <div className="mt-1 text-sm font-semibold text-p-text">{value}</div>
  </div>
)

const TemplatePreview: React.FC<{ templateId: string | null; onClose: () => void }> = ({ templateId, onClose }) => {
  const { data: template, isLoading, isError } = useQuery({
    queryKey: ['roadmap-template', templateId],
    queryFn: () => roadmapApi.getTemplate(templateId!),
    enabled: Boolean(templateId),
  })

  const taskCount = template?.stages.reduce((sum, stage) => sum + stage.tasks.length, 0) || 0

  return (
    <Dialog open={Boolean(templateId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-5 pr-12 sm:px-6">
          <p className="label-caps text-muted-foreground">Превью Roadmap</p>
          <DialogTitle className="text-xl text-foreground">
            {template?.name || (isLoading ? 'Загрузка…' : 'Шаблон')}
          </DialogTitle>
          {template && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
              {template.country_name && <span>{template.country_name}</span>}
              <span>{template.degree === 'masters' ? 'Магистратура' : 'Бакалавриат'}</span>
              <span>{template.year}</span>
              <span>{template.stages.length} этапов</span>
              <span>{taskCount} задач</span>
            </div>
          )}
        </DialogHeader>

        <div className="max-h-[70dvh] overflow-y-auto px-5 py-5 sm:px-6">
          {isLoading && <p className="text-sm text-muted-foreground">Загружаем структуру шаблона…</p>}
          {isError && <p className="text-sm text-destructive">Не удалось загрузить шаблон.</p>}

          {template && (
            <div className="space-y-5">
              {template.description && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {template.description}
                </p>
              )}

              {template.stages.length === 0 ? (
                <div className="rounded-panel border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  В шаблоне пока нет этапов.
                </div>
              ) : (
                <div className="space-y-4">
                  {template.stages.map((stage, stageIndex) => (
                    <section key={stage.id} className="overflow-hidden rounded-panel border border-border">
                      <div className="flex items-start gap-3 border-b border-border bg-muted/50 px-4 py-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">
                          {stageIndex + 1}
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">{stage.name}</h3>
                          {stage.description && (
                            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                              {stage.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {stage.tasks.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-muted-foreground">Задач пока нет.</p>
                      ) : (
                        <div className="divide-y divide-border">
                          {stage.tasks.map((task) => (
                            <div key={task.id} className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-sm font-medium text-foreground">{task.title}</h4>
                                    <span className="rounded-pill border border-border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      {PRIORITIES.find((priority) => priority.value === task.priority)?.label || task.priority}
                                    </span>
                                  </div>
                                  {task.description && (
                                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                                      {task.description}
                                    </p>
                                  )}
                                  {task.expected_result && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      <span className="font-semibold text-foreground">Результат:</span> {task.expected_result}
                                    </p>
                                  )}
                                  {task.subtasks.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                      {task.subtasks.map((subtask) => (
                                        <li key={subtask.id} className="flex gap-2">
                                          <span aria-hidden="true">—</span>
                                          <span>{subtask.title}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const TemplateEditor: React.FC<{ templateId: string; onBack: () => void }> = ({ templateId, onBack }) => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [stages, setStages] = useState<StageInput[]>([])
  const [loaded, setLoaded] = useState(false)

  const { data: tpl } = useQuery({
    queryKey: ['roadmap-template', templateId],
    queryFn: () => roadmapApi.getTemplate(templateId),
  })
  React.useEffect(() => {
    if (tpl && !loaded) {
      setStages(toStageInputs(tpl))
      setLoaded(true)
    }
  }, [tpl, loaded])

  const saveMutation = useMutation({
    mutationFn: () => roadmapApi.putStructure(templateId, stages),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roadmap-templates'] })
      queryClient.invalidateQueries({ queryKey: ['roadmap-template', templateId] })
      toast({ title: 'Структура сохранена' })
    },
    onError: () => toast({ title: 'Не удалось сохранить', variant: 'destructive' }),
  })

  const update = (fn: (draft: StageInput[]) => void) => {
    setStages((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as StageInput[]
      fn(next)
      return next
    })
  }

  const addStage = () => {
    const name = window.prompt('Название этапа')?.trim()
    if (name) update((d) => d.push({ name, description: '', tasks: [] }))
  }
  const addTask = (si: number) => {
    const title = window.prompt('Название задачи')?.trim()
    if (title) update((d) => d[si].tasks!.push({ title, priority: 'required', audience: 'applicant', subtasks: [] }))
  }
  const addSubtask = (si: number, ti: number) => {
    const title = window.prompt('Название подзадачи')?.trim()
    if (title) update((d) => d[si].tasks![ti].subtasks!.push({ title }))
  }

  return (
    <div className="mx-auto w-full">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-p-muted hover:text-black mb-4">
        <ChevronLeft className="w-4 h-4" /> К списку шаблонов
      </button>
      <PageHeader
        eyebrow="Редактор шаблона"
        title={tpl?.name || 'Шаблон Roadmap'}
        action={(
          <Button size="sm" className="h-9 px-4 text-xs" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save className="w-3.5 h-3.5 mr-2" /> Сохранить структуру
          </Button>
        )}
      />

      <div className="space-y-4">
        {stages.map((s, si) => (
          <div key={si} className="border border-p-line rounded-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full bg-brand text-brand-ink grid place-items-center text-xs font-bold shrink-0">
                {si + 1}
              </span>
              <span className="text-sm font-semibold text-p-text flex-1">{s.name}</span>
              <button
                onClick={() => update((d) => d.splice(si, 1))}
                className="text-gray-300 hover:text-red-500"
                aria-label="Удалить этап"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 pl-8">
              {(s.tasks || []).map((t: TaskInput, ti) => (
                <div key={ti} className="border border-p-line rounded-panel p-2.5 bg-p-bg/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-p-text flex-1">{t.title}</span>
                    <select
                      value={t.priority}
                      onChange={(e) => update((d) => (d[si].tasks![ti].priority = e.target.value as Priority))}
                      className="h-7 px-2 text-xs border border-p-line rounded-ctl bg-white"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => update((d) => d[si].tasks!.splice(ti, 1))}
                      className="text-gray-300 hover:text-red-500"
                      aria-label="Удалить задачу"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {(t.subtasks || []).length > 0 && (
                    <div className="mt-2 pl-3 space-y-1">
                      {t.subtasks!.map((st, sti) => (
                        <div key={sti} className="flex items-center gap-2 text-xs text-p-muted">
                          <span className="flex-1">— {st.title}</span>
                          <button
                            onClick={() => update((d) => d[si].tasks![ti].subtasks!.splice(sti, 1))}
                            className="text-gray-300 hover:text-red-500"
                            aria-label="Удалить подзадачу"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => addSubtask(si, ti)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-p-muted hover:text-black"
                  >
                    <Plus className="w-3 h-3" /> подзадача
                  </button>
                </div>
              ))}
              <button
                onClick={() => addTask(si)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-p-muted hover:text-black py-1"
              >
                <Plus className="w-3.5 h-3.5" /> задача
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={addStage}
          className="w-full border border-dashed border-p-line rounded-ctl py-3 text-sm text-p-muted hover:text-black hover:border-gray-400 inline-flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Добавить этап
        </button>
      </div>
    </div>
  )
}
