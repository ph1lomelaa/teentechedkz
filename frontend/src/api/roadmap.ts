import apiClient from './client'

export type ItemStatus = 'planned' | 'in_progress' | 'done'
export type Priority = 'required' | 'recommended' | 'optional'
export type Audience = 'applicant' | 'coordinator'

export interface RoadmapSubtask {
  id: string
  title: string
  is_done: boolean
  position: number
}

export interface RoadmapTask {
  id: string
  stage_id: string
  roadmap_id: string
  title: string
  description: string
  expected_result: string
  needs_document: boolean
  needs_zoom: boolean
  questionnaire_url: string | null
  priority: Priority
  audience: Audience
  status: ItemStatus
  due_date: string | null
  position: number
  subtasks: RoadmapSubtask[]
}

export interface RoadmapStage {
  id: string
  roadmap_id: string
  name: string
  description: string
  position: number
  status: ItemStatus
  tasks: RoadmapTask[]
}

export interface Roadmap {
  id: string
  student_id: string
  mentor_id: string | null
  mentor_name?: string | null
  template_id: string | null
  name: string
  country_name: string | null
  country_flag_emoji?: string
  country_flag_url?: string
  degree: string
  year: number
  status: string
  created_at: string
  stages: RoadmapStage[]
}

// ---- templates ----
export interface TemplateListItem {
  id: string
  name: string
  country_name: string | null
  degree: string
  year: number
  stage_count: number
  task_count: number
  source_notion_db_id?: string | null
  source_notion_title?: string | null
  source_notion_last_edited_at?: string | null
}

export interface TemplateSubtask {
  id: string
  title: string
  position: number
  source_notion_page_id?: string | null
}
export interface TemplateTask {
  id: string
  title: string
  description: string
  expected_result: string
  needs_document: boolean
  needs_zoom: boolean
  questionnaire_url: string | null
  source_notion_page_id?: string | null
  priority: Priority
  audience: Audience
  due_offset_days: number | null
  position: number
  subtasks: TemplateSubtask[]
}
export interface TemplateStage {
  id: string
  name: string
  description: string
  position: number
  tasks: TemplateTask[]
}
export interface RoadmapTemplate {
  id: string
  name: string
  country_name: string | null
  degree: string
  year: number
  description: string
  source_notion_db_id?: string | null
  source_notion_title?: string | null
  source_notion_last_edited_at?: string | null
  created_at: string
  stages: TemplateStage[]
}

// structure input (create / put-structure)
export interface SubtaskInput {
  title: string
  source_notion_page_id?: string | null
}
export interface TaskInput {
  title: string
  description?: string
  expected_result?: string
  needs_document?: boolean
  needs_zoom?: boolean
  questionnaire_url?: string | null
  source_notion_page_id?: string | null
  priority?: Priority
  audience?: Audience
  due_offset_days?: number | null
  subtasks?: SubtaskInput[]
}
export interface StageInput {
  name: string
  description?: string
  tasks?: TaskInput[]
}
export interface TemplateCreateInput {
  name: string
  country_name?: string | null
  degree?: string
  year: number
  description?: string
  source_notion_db_id?: string | null
  source_notion_title?: string | null
  source_notion_last_edited_at?: string | null
  stages?: StageInput[]
}

export interface NotionRoadmapImportRequest {
  dry_run?: boolean
  discover_only?: boolean
  skip_subtasks?: boolean
  only?: string | null
}

export interface NotionRoadmapImportJob {
  job_id: string
  status: 'running' | 'done' | 'failed'
  started_at: string
  finished_at: string | null
  request: NotionRoadmapImportRequest
  progress: {
    message?: string
    template_index?: number
    template_total?: number
    task_index?: number
    task_total?: number
    title?: string
  }
  events: Array<Record<string, unknown>>
  result: null | {
    ok: boolean
    mode: string
    found: number
    created: number
    updated: number
    tasks: number
    subtasks: number
    templates: Array<{
      title: string
      label: string
      source_notion_db_id: string
      action: string
      stages: number
      tasks: number
      subtasks: number
    }>
    error: string | null
  }
  error: string | null
}

export interface FlatTask {
  id: string
  stage_id: string
  roadmap_id: string
  stage_name: string
  stage_position: number
  title: string
  description: string
  expected_result: string
  needs_document: boolean
  needs_zoom: boolean
  questionnaire_url: string | null
  priority: Priority
  audience: Audience
  status: ItemStatus
  due_date: string | null
  position: number
  subtasks: RoadmapSubtask[]
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const roadmapApi = {
  // live roadmap
  myRoadmap: () => data<Roadmap | null>(apiClient.get('/portal/roadmap')),
  studentRoadmap: (studentId: string) =>
    data<Roadmap | null>(apiClient.get(`/students/${studentId}/roadmap`)),

  myTasks: () => data<FlatTask[]>(apiClient.get('/portal/tasks')),
  studentTasks: (studentId: string) =>
    data<FlatTask[]>(apiClient.get(`/students/${studentId}/tasks`)),

  updateStage: (stageId: string, body: { status?: ItemStatus; name?: string; description?: string }) =>
    data<Roadmap>(apiClient.patch(`/stages/${stageId}`, body)),
  createTask: (body: {
    stage_id: string
    title: string
    description?: string
    expected_result?: string
    needs_document?: boolean
    needs_zoom?: boolean
    questionnaire_url?: string | null
    priority?: Priority
    audience?: Audience
    due_date?: string | null
  }) =>
    data<Roadmap>(apiClient.post('/roadmap-tasks', body)),
  updateTask: (taskId: string, body: Partial<{
    title: string
    description: string
    expected_result: string
    needs_document: boolean
    needs_zoom: boolean
    questionnaire_url: string | null
    status: ItemStatus
    priority: Priority
    audience: Audience
    due_date: string | null
  }>) =>
    data<Roadmap>(apiClient.patch(`/roadmap-tasks/${taskId}`, body)),
  deleteTask: (taskId: string) => apiClient.delete(`/roadmap-tasks/${taskId}`),
  createSubtask: (taskId: string, title: string) =>
    data<Roadmap>(apiClient.post(`/roadmap-tasks/${taskId}/subtasks`, { title })),
  updateSubtask: (subtaskId: string, body: { is_done?: boolean; title?: string }) =>
    data<Roadmap>(apiClient.patch(`/roadmap-subtasks/${subtaskId}`, body)),
  deleteSubtask: (subtaskId: string) => apiClient.delete(`/roadmap-subtasks/${subtaskId}`),

  // templates
  listTemplates: () => data<TemplateListItem[]>(apiClient.get('/roadmap-templates')),
  getTemplate: (id: string) => data<RoadmapTemplate>(apiClient.get(`/roadmap-templates/${id}`)),
  createTemplate: (body: TemplateCreateInput) =>
    data<RoadmapTemplate>(apiClient.post('/roadmap-templates', body)),
  updateTemplate: (id: string, body: Partial<TemplateCreateInput>) =>
    data<RoadmapTemplate>(apiClient.patch(`/roadmap-templates/${id}`, body)),
  deleteTemplate: (id: string) => apiClient.delete(`/roadmap-templates/${id}`),
  putStructure: (id: string, stages: StageInput[]) =>
    data<RoadmapTemplate>(apiClient.put(`/roadmap-templates/${id}/structure`, { stages })),
  assign: (templateId: string, studentId: string, opts?: { mentor_id?: string; name?: string }) =>
    data<Roadmap>(apiClient.post(`/roadmap-templates/${templateId}/assign`, { student_id: studentId, ...opts })),
  startNotionImport: (body: NotionRoadmapImportRequest) =>
    data<NotionRoadmapImportJob>(apiClient.post('/roadmap-templates/import/notion', body)),
  notionImportJob: (jobId: string) =>
    data<NotionRoadmapImportJob>(apiClient.get(`/roadmap-templates/import/notion/${jobId}`)),
  notionImportJobs: () => data<NotionRoadmapImportJob[]>(apiClient.get('/roadmap-templates/import/notion')),
}
