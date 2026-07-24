import React, { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ExternalLink, ChevronRight, BookOpen, Search } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { useToast } from '@/hooks/use-toast'
import { knowledgeApi, KnowledgeArticleSummary } from '@/api/knowledge'
import { PageHeader, SegmentedTabs } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { useImportJobs } from '@/contexts/ImportJobsContext'

export const KnowledgeBasePage: React.FC = () => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const canSync = user?.role === 'admin' || user?.role === 'mzk_manager'
  const [openId, setOpenId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const { setKnowledgeJobId: setSyncJobId, knowledgeJob: syncJob } = useImportJobs()

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['knowledge-articles'],
    queryFn: () => knowledgeApi.list(),
  })

  React.useEffect(() => {
    if (syncJob?.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] })
    }
  }, [syncJob?.status, queryClient])

  const syncMutation = useMutation({
    mutationFn: () => knowledgeApi.startNotionSync(),
    onSuccess: (job) => {
      setSyncJobId(job.job_id)
      toast({ title: 'Синхронизация запущена', description: 'Обновляем справочные материалы из Notion.' })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const message = typeof detail === 'string' ? detail : detail?.message
      toast({ title: 'Не удалось запустить синхронизацию', description: message, variant: 'destructive' })
      if (detail?.job_id) setSyncJobId(detail.job_id)
    },
  })

  const grouped = useMemo(() => {
    const map = new Map<string, KnowledgeArticleSummary[]>()
    for (const article of articles) {
      const key = article.category || 'Без категории'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(article)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [articles])

  const categoryTabs = useMemo(
    () => [{ value: 'all', label: 'Все' }, ...grouped.map(([category]) => ({ value: category, label: category }))],
    [grouped]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return grouped
      .filter(([category]) => activeCategory === 'all' || category === activeCategory)
      .map(
        ([category, items]) =>
          [category, query ? items.filter((article) => article.title.toLowerCase().includes(query)) : items] as [
            string,
            KnowledgeArticleSummary[],
          ]
      )
      .filter(([, items]) => items.length > 0)
  }, [grouped, activeCategory, search])

  return (
    <div className="mx-auto w-full">
      <PageHeader
        eyebrow="Справочники"
        title="База знаний"
        description="Стипендии, регламенты и пакеты — импортировано из Notion, только для чтения."
      />

      {canSync && (
        <div className="mb-6 rounded-card border border-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-p-muted">
              Подтягивает содержимое из закреплённого списка Notion-страниц (не создаёт новые записи по совпадению названий).
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-3 text-xs"
              disabled={syncMutation.isPending || syncJob?.status === 'running'}
              onClick={() => syncMutation.mutate()}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Обновить из Notion
            </Button>
          </div>
          {syncJob && (
            <div className="mt-3 rounded-panel border border-border bg-muted p-3 text-xs">
              <div className="mb-3 h-2 w-full overflow-hidden rounded-full border border-border bg-card">
                <div
                  className={`h-full bg-amber-500 transition-all duration-300 ${syncJob.status === 'running' ? 'w-1/3 animate-pulse' : ''}`}
                  style={syncJob.status === 'done' ? { width: '100%' } : undefined}
                />
              </div>
              <div className="font-semibold text-p-text">
                {syncJob.status === 'running' ? 'Синхронизация идёт…' : syncJob.status === 'done' ? 'Готово' : 'Ошибка'}
              </div>
              {syncJob.result && (
                <div className="mt-1 text-p-muted">
                  Найдено {syncJob.result.found} · создано {syncJob.result.created} · обновлено {syncJob.result.updated}
                  {syncJob.result.failed ? ` · ошибок ${syncJob.result.failed}` : ''}
                </div>
              )}
              {syncJob.error && <p className="mt-1 text-red-600">{syncJob.error}</p>}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : articles.length === 0 ? (
        <div className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-p-muted2">
          <BookOpen className="mx-auto mb-2 h-5 w-5 text-p-muted2" />
          Пока пусто.{canSync ? ' Нажмите «Обновить из Notion», чтобы загрузить материалы.' : ''}
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SegmentedTabs
              tabs={categoryTabs}
              value={activeCategory}
              onChange={setActiveCategory}
              colorPrefix="p"
            />
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-p-muted2" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по статьям…"
                className="w-full rounded-ctl border border-p-line bg-p-panel2 py-2.5 pl-10 pr-4 text-sm text-p-text placeholder:text-p-muted2 transition-colors hover:border-p-accent-dim focus:border-p-accent-dim focus:outline-none"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-p-muted2">
              <BookOpen className="mx-auto mb-2 h-5 w-5 text-p-muted2" />
              Ничего не найдено. Попробуйте изменить запрос или категорию.
            </div>
          ) : (
            <div className="space-y-6">
              {filtered.map(([category, items]) => (
                <div key={category}>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-p-muted2">{category}</h2>
                  <div className="divide-y divide-border rounded-card border border-border bg-card">
                    {items.map((article) => (
                      <button
                        key={article.id}
                        type="button"
                        onClick={() => setOpenId(article.id)}
                        className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-p-text">{article.title}</span>
                        {activeCategory === 'all' && (
                          <span className="shrink-0 rounded-full border border-p-line bg-p-panel2 px-2.5 py-0.5 text-2xs text-p-muted">
                            {category}
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-p-muted2 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ArticleDialog articleId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

const ArticleDialog: React.FC<{ articleId: string | null; onClose: () => void }> = ({ articleId, onClose }) => {
  const { data: article, isLoading, isError } = useQuery({
    queryKey: ['knowledge-article', articleId],
    queryFn: () => knowledgeApi.get(articleId!),
    enabled: Boolean(articleId),
  })

  return (
    <Dialog open={Boolean(articleId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-5 pr-12 sm:px-6">
          <p className="label-caps text-muted-foreground">{article?.category || 'База знаний'}</p>
          <DialogTitle className="font-display text-2xl font-black leading-tight text-foreground">
            {article?.title || (isLoading ? 'Загрузка…' : 'Материал')}
          </DialogTitle>
          {article?.source_notion_url && (
            <a
              href={article.source_notion_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 pt-1 text-xs text-muted-foreground hover:text-brand"
            >
              Открыть в Notion <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </DialogHeader>
        <div className="px-5 py-5 sm:px-6">
          {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
          {isError && <p className="text-sm text-destructive">Не удалось загрузить материал.</p>}
          {article && <div className="kb-content" dangerouslySetInnerHTML={{ __html: article.body_html }} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
