import apiClient from './client'

export interface KnowledgeArticleSummary {
  id: string
  title: string
  category: string | null
  source_notion_url: string | null
  synced_at: string | null
}

export interface KnowledgeArticleDetail extends KnowledgeArticleSummary {
  body_html: string
}

export interface NotionKnowledgeSyncJob {
  job_id: string
  status: 'running' | 'done' | 'failed'
  started_at: string
  finished_at: string | null
  events: { at: string; message?: string }[]
  result: { found: number; created: number; updated: number; failed: number } | null
  error: string | null
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const knowledgeApi = {
  list: (category?: string) =>
    data<KnowledgeArticleSummary[]>(apiClient.get('/knowledge-articles', { params: { category } })),
  get: (id: string) => data<KnowledgeArticleDetail>(apiClient.get(`/knowledge-articles/${id}`)),
  startNotionSync: () =>
    data<NotionKnowledgeSyncJob>(apiClient.post('/knowledge-articles/sync/notion', {})),
  notionSyncJob: (jobId: string) =>
    data<NotionKnowledgeSyncJob>(apiClient.get(`/knowledge-articles/sync/notion/${jobId}`)),
}
