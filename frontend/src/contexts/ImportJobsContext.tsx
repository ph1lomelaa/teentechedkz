import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { roadmapApi, NotionRoadmapImportJob } from '@/api/roadmap'
import { knowledgeApi, NotionKnowledgeSyncJob } from '@/api/knowledge'
import { questionnairesApi, NotionQuestionnaireSyncJob } from '@/api/questionnaires'

// Tracks long-running Notion import/sync jobs (roadmap templates, knowledge base,
// questionnaires) at the app root — mounted once above the router, so navigating
// between pages does NOT stop polling or lose progress. Job ids are also persisted
// in localStorage so a browser refresh doesn't lose track of a still-running job.

const STORAGE_PREFIX = 'tte:import-job:'

function usePersistedJobId(key: string): [string | null, (id: string | null) => void] {
  const [id, setIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + key)
    } catch {
      return null
    }
  })
  const setId = useCallback(
    (next: string | null) => {
      setIdState(next)
      try {
        if (next) localStorage.setItem(STORAGE_PREFIX + key, next)
        else localStorage.removeItem(STORAGE_PREFIX + key)
      } catch {
        // localStorage unavailable (private mode etc.) — job just won't survive a refresh.
      }
    },
    [key],
  )
  return [id, setId]
}

interface ImportJobsContextValue {
  roadmapJobId: string | null
  setRoadmapJobId: (id: string | null) => void
  roadmapJob?: NotionRoadmapImportJob
  knowledgeJobId: string | null
  setKnowledgeJobId: (id: string | null) => void
  knowledgeJob?: NotionKnowledgeSyncJob
  questionnaireJobId: string | null
  setQuestionnaireJobId: (id: string | null) => void
  questionnaireJob?: NotionQuestionnaireSyncJob
}

const ImportJobsContext = createContext<ImportJobsContextValue | null>(null)

export const ImportJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [roadmapJobId, setRoadmapJobId] = usePersistedJobId('roadmap')
  const [knowledgeJobId, setKnowledgeJobId] = usePersistedJobId('knowledge')
  const [questionnaireJobId, setQuestionnaireJobId] = usePersistedJobId('questionnaires')

  const { data: roadmapJob } = useQuery({
    queryKey: ['global-import-job', 'roadmap', roadmapJobId],
    queryFn: () => roadmapApi.notionImportJob(roadmapJobId!),
    enabled: Boolean(roadmapJobId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  })

  const { data: knowledgeJob } = useQuery({
    queryKey: ['global-import-job', 'knowledge', knowledgeJobId],
    queryFn: () => knowledgeApi.notionSyncJob(knowledgeJobId!),
    enabled: Boolean(knowledgeJobId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  })

  const { data: questionnaireJob } = useQuery({
    queryKey: ['global-import-job', 'questionnaires', questionnaireJobId],
    queryFn: () => questionnairesApi.notionSyncJob(questionnaireJobId!),
    enabled: Boolean(questionnaireJobId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  })

  // Once a job reaches a terminal state, drop its id from localStorage (but keep
  // it in memory so the outcome card still shows this session). This stops a
  // finished/failed job from "resurrecting" and re-showing "завис" on every
  // page refresh — only genuinely running jobs survive a reload.
  useEffect(() => {
    if (roadmapJobId && roadmapJob?.status && roadmapJob.status !== 'running') {
      try { localStorage.removeItem(STORAGE_PREFIX + 'roadmap') } catch { /* ignore */ }
    }
  }, [roadmapJobId, roadmapJob?.status])
  useEffect(() => {
    if (knowledgeJobId && knowledgeJob?.status && knowledgeJob.status !== 'running') {
      try { localStorage.removeItem(STORAGE_PREFIX + 'knowledge') } catch { /* ignore */ }
    }
  }, [knowledgeJobId, knowledgeJob?.status])
  useEffect(() => {
    if (questionnaireJobId && questionnaireJob?.status && questionnaireJob.status !== 'running') {
      try { localStorage.removeItem(STORAGE_PREFIX + 'questionnaires') } catch { /* ignore */ }
    }
  }, [questionnaireJobId, questionnaireJob?.status])

  return (
    <ImportJobsContext.Provider
      value={{
        roadmapJobId,
        setRoadmapJobId,
        roadmapJob,
        knowledgeJobId,
        setKnowledgeJobId,
        knowledgeJob,
        questionnaireJobId,
        setQuestionnaireJobId,
        questionnaireJob,
      }}
    >
      {children}
    </ImportJobsContext.Provider>
  )
}

export function useImportJobs(): ImportJobsContextValue {
  const ctx = useContext(ImportJobsContext)
  if (!ctx) throw new Error('useImportJobs must be used within ImportJobsProvider')
  return ctx
}
