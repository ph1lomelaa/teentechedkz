export type UserRole = 'admin' | 'mzk_manager' | 'mentor' | 'student'
export type NoteVisibility = 'admin_only' | 'admin_and_mzk' | 'all_mentors'

export type PipelineStatus =
  | 'active_work'
  | 'on_visa'
  | 'paused'
  | 'changed_mind'
  | 'refund'
  | 'unpaid'
  | 'transferred_pipeline'
  | 'ielts_retake'
  | 'suspended'
  | 'no_status'

export type DegreeLevel = 'undergraduate' | 'masters' | 'foundation' | 'found_ug'

export type ServiceType =
  | 'proforientation'
  | 'ielts_mock'
  | 'ielts_prep'
  | 'sat_prep'
  | 'portfolio_improvement'
  | 'english_general'

export type ServiceStatus =
  | 'not_started'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'not_applicable'

export type SubmissionStatus =
  | 'not_started'
  | 'documents_prep'
  | 'submitted'
  | 'offer_received'
  | 'rejected'
  | 'enrolled'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  telegram_username?: string
  phone?: string
  is_active: boolean
  must_change_password: boolean
}

export interface StudentListItem {
  id: string
  full_name: string
  phone: string
  degree_level: DegreeLevel
  intake_year: number
  city?: string
  pipeline_status?: PipelineStatus
  days_in_work?: number
  is_mine?: boolean
  country?: string | null
  mentors?: string[]
  mzk_manager_name?: string | null
  responsible_count?: number
  responsibles?: ResponsibleUser[]
  services_summary?: {
    total: number
    in_progress: number
    scheduled: number
    completed: number
    items: Array<{
      id: string
      service_type: ServiceType
      status: ServiceStatus
      assigned_mentor_id?: string | null
      assigned_staff_id?: string | null
      assigned_mentor_name?: string | null
      deadline?: string | null
    }>
  }
  has_portal_access?: boolean
  roadmap?: {
    id?: string | null
    name?: string | null
    progress?: number | null
    tasks_total?: number
    tasks_done?: number
  }
  open_tasks_count?: number
  next_meeting?: {
    id: string
    title: string
    starts_at: string
  } | null
  telegram?: {
    linked: boolean
    chat_id?: string | null
    pending_signals: number
  }
  documents_unverified?: number
  last_contact?: {
    source: string
    at: string
  } | null
}

export interface StudentTimelineItem {
  id: string
  at: string
  kind: string
  title: string
  text?: string
  href?: string | null
  source?: string | null
  meta?: Record<string, unknown>
}

export interface StudentTimelineResponse {
  items: StudentTimelineItem[]
  total: number
  limit: number
  offset: number
}

export interface ResponsibleUser {
  id: string
  assignment_id?: string
  name?: string | null
  role?: string
  is_active: boolean
}

export interface Application {
  id: string
  student_id?: string
  contract_id?: string
  country: string
  university?: string
  program?: string
  submissions_planned: number
  submissions_done: number
  submission_status: SubmissionStatus
  visa_status?: string
  scholarship_target?: boolean
  is_primary: boolean
  lead_mentor_id?: string
}

export interface Service {
  id: string
  student_id?: string
  contract_id?: string
  service_type: ServiceType
  included: boolean
  status: ServiceStatus
  result?: string
  assigned_mentor_id?: string
  assigned_staff_id?: string
  deadline?: string | null
  notes?: string
  portfolio_directions_count?: number
  portfolio_directions_types?: string
  proforientation_specialty?: string
}

export interface Payment {
  id: string
  type: string
  amount: string
  currency: string
  status: string
  paid_at?: string
  mentor_id?: string
  note?: string
  student_id?: string
  student_name?: string
}

export interface Contract {
  id: string
  student_id?: string
  signed_date?: string
  amount?: string
  currency: string
  payment_plan?: string
  pipeline_status: PipelineStatus
  mzk_manager_id?: string
  mzk_manager_name?: string
  ielts_payment_included: boolean
  english_sum?: string
  english_paid?: string
  client_remaining_amount?: string
  client_remaining_date?: string
  mentor_total_owed?: string
  notes?: string
  payments: Payment[]
}

export interface Guardian {
  id: string
  student_id?: string
  full_name: string
  iin?: string
  iin_masked?: string
  phone: string
  email?: string
  relation: string
  is_primary: boolean
}

export interface StudentTask {
  id: string
  student_id: string
  service_id?: string | null
  student_name?: string
  task_text: string
  status: 'open' | 'done'
  created_by: string
  created_at: string
  done_at?: string
}

export interface PortfolioProgress {
  id: string
  vpp_group?: string
  first_call_milestone?: string
  deadline_text?: string
  focus_areas: string[]
  status: string
  achievements_count: number
  calls_count: number
  special_notes?: string
}

export type DocType =
  | 'certificate'
  | 'achievement'
  | 'id_scan'
  | 'offer_letter'
  | 'contract_scan'
  | 'transcript'
  | 'resume'
  | 'other'

export interface Document {
  id: string
  doc_type: string
  file_name: string
  file_size: number
  mime_type: string
  source: string
  ai_description?: string
  is_verified: boolean
  visible_to_student?: boolean
  uploaded_at: string
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  certificate: 'Сертификат',
  achievement: 'Достижение',
  id_scan: 'Скан документа',
  offer_letter: 'Оффер',
  contract_scan: 'Скан договора',
  transcript: 'Транскрипт',
  resume: 'Резюме',
  other: 'Другое',
}

export interface MentorAssignment {
  id: string
  mentor_id: string
  mentor_name?: string
  role: string
  is_active?: boolean
  assigned_at: string
}

export type CommSource = 'telegram' | 'whatsapp' | 'zoom' | 'manual'
export type MessageType = 'text_event' | 'attachment' | 'call_transcript' | 'general_chat'
export type StudentNoteStatus = 'draft' | 'approved' | 'rejected'
export type NoteSessionStatus = 'active' | 'completed' | 'cancelled'

export interface CommunicationLog {
  id: string
  student_id: string
  source: CommSource
  message_type: MessageType
  raw_text?: string
  ai_summary?: string
  zoom_call_date?: string
  zoom_duration_min?: number
  created_at: string
}

export interface StudentNote {
  id: string
  student_id?: string | null
  student_name?: string | null
  title: string
  source_text: string
  summary_markdown: string
  student_summary_markdown?: string | null
  profile_snapshot: Record<string, unknown>
  suggested_changes: Record<string, unknown>
  applied_changes: Record<string, unknown>
  status: StudentNoteStatus
  created_by?: string | null
  reviewed_by?: string | null
  created_at: string
  reviewed_at?: string | null
  published_to_student?: boolean
  published_at?: string | null
  student_title?: string | null
  hidden_blocks?: string[]
  blocks?: { key: string; heading: string }[]
  is_important?: boolean
  source_kind?: 'manual' | 'meeting' | 'telegram'
}

export interface NoteTranscript {
  id: string
  session_id: string
  text: string
  timestamp: string
  speaker?: string | null
  client_segment_id?: string | null
  sequence_no: number
  created_at: string
}

export interface NoteSession {
  id: string
  student_id?: string | null
  student_name?: string | null
  note_id?: string | null
  meeting_id?: string | null
  title: string
  source: string
  status: NoteSessionStatus
  started_at: string
  ended_at?: string | null
  last_heartbeat_at?: string | null
  created_by?: string | null
  transcript_count: number
  latest_transcript?: string | null
}

export interface NoteSessionDetail extends NoteSession {
  transcripts: NoteTranscript[]
  backup_transcript_text?: string | null
  note?: StudentNote | null
}

export type NoteAudioChunkStatus = 'pending' | 'processing' | 'transcribed' | 'failed'

export interface NoteSessionAudioChunk {
  id: string
  session_id: string
  chunk_index: number
  file_size: number
  status: NoteAudioChunkStatus
  transcript_text?: string | null
  download_url?: string | null
  created_at: string
}

export interface NoteSessionReconcileResult {
  backup_transcript_text: string
  chunks: NoteSessionAudioChunk[]
  queued: boolean
}

export interface NoteSessionDraft {
  title: string
  source_text: string
  summary_markdown: string
  student_summary_markdown: string
  profile_snapshot: Record<string, unknown>
  suggested_changes: Record<string, unknown>
  change_preview: Array<{
    field: string
    old_value: unknown
    new_value: unknown
  }>
  /** "provider_chain" = real AI model, "heuristic" = rule-based fallback. */
  ai_model?: string | null
}

export interface ConfidentialNote {
  id: string
  note_text: string
  visible_to_role: NoteVisibility
  visible_to_student?: boolean
  created_by?: string
  created_at: string
}

export interface PendingInsight {
  id: string
  student_id: string
  insight_type: string
  proposed_changes: Record<string, unknown>
  unmatched_fields: Record<string, unknown>
  confidence: number
  risk_level: 'low' | 'sensitive'
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by?: string
  auto_applied: boolean
  created_at: string
  reviewed_at?: string
}

export interface InsightWithDiff extends PendingInsight {
  diff: { field: string; old_value: unknown; new_value: unknown }[]
  student_name?: string
  is_mine?: boolean
  responsibles?: ResponsibleUser[]
}

export type TelegramChatStatus = 'unbound' | 'active' | 'paused' | 'closed'

export interface TelegramChat {
  id: string
  chat_id: number
  chat_type: 'private' | 'group' | 'supergroup'
  title: string | null
  status: TelegramChatStatus
  privacy_mode_disabled: boolean
  created_at: string
  session_id: string | null
  student_id: string | null
  student_name: string | null
  student_telegram_user_id: string | null
  student_telegram_username: string | null
  student_telegram_linked_at: string | null
  last_message_preview: string | null
  last_message_at: string | null
  pending_insight_count: number
  unresolved_attachment_count: number
  context_signal_count: number
  has_context_signal: boolean
  is_mine?: boolean
  responsible_count?: number
  responsibles?: ResponsibleUser[]
}

export interface TelegramAttachment {
  id: string
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  status: 'pending' | 'downloaded' | 'parsed' | 'failed'
  can_download: boolean
}

export interface TelegramMessage {
  id: string
  telegram_message_id: number
  sender_tg_id: number | null
  sender_name: string | null
  sender_display_name?: string | null
  sender_role?: string
  is_current_user?: boolean
  message_type: 'text' | 'photo' | 'document' | 'voice' | 'video_note' | 'other'
  raw_text: string | null
  created_at: string
  attachments: TelegramAttachment[]
}

export interface TelegramParticipant {
  telegram_user_id: number
  sender_name: string | null
  display_name: string | null
  role: string
  is_current_user: boolean
}

export interface TelegramChatSessionHistory {
  id: string
  chat_id: string
  student_id: string | null
  student_name: string | null
  status: 'active' | 'closed'
  opened_by: string | null
  opened_by_name: string | null
  opened_at: string
  closed_at: string | null
}

export interface TelegramPairingCode {
  code: string
  deep_link: string
  expires_at: string
}

export interface TelegramGroupSetupLink {
  code: string
  startgroup_link: string
  suggested_title: string
  expires_at: string
}

export interface TelegramGroupReadiness {
  chat_id: string
  telegram_chat_id: number
  title: string | null
  bot_in_chat: boolean
  bot_is_admin: boolean
  can_change_info: boolean
  can_invite_users: boolean
  privacy_mode_disabled: boolean
  ready: boolean
  issues: string[]
  telegram_error: string | null
  checked_at: string
}

export interface TelegramGroupInviteLink {
  invite_link: string
  expires_at: string
  expected_student_id: string
  expected_student_name: string
}

export type TelegramChatInsight = InsightWithDiff

export interface TelegramContextProfileUpdate {
  field: string
  value: unknown
  old_value?: unknown
  reason?: string
}

export interface TelegramContextDraft {
  draft_run_id?: string
  summary: string
  source_text: string
  student_id: string
  student_name: string
  profile_snapshot: Record<string, unknown>
  source_last_message_id?: string
  prompt_version?: string
  model?: string | null
  source_filter?: { q?: string; limit?: number }
  profile_updates: TelegramContextProfileUpdate[]
  profile_notes: string[]
  follow_ups: string[]
  document_flags: string[]
  contradictions: string[]
  quality_warnings: string[]
  ignored_as_noise: string[]
}

export interface TelegramContextApplyResult {
  note_id: string
  applied_changes: Array<{ field: string; old_value: unknown; new_value: unknown }>
  profile_notes_saved: number
}

// Unlike TelegramContextApplyResult, the combined workspace flow doesn't create
// one ConfidentialNote per item — profile_notes/document_flags/contradictions/
// quality_warnings are folded into a single StudentNote, and follow_ups become
// StudentTask rows instead (counted here, not saved as notes).
export interface WorkspaceContextApplyResult {
  note_id: string
  applied_changes: Array<{ field: string; old_value: unknown; new_value: unknown }>
  tasks_created: number
}

export interface TelegramImportResult {
  chat_id: string
  mode?: 'desktop_json' | 'client_session'
  source?: string
  status?: 'completed' | 'failed' | 'pending'
  imported: number
  skipped: number
  total: number
}

export interface TelegramImportCapabilities {
  chat_id: string
  active_mode: 'desktop_json' | 'client_session'
  modes: Array<{
    mode: 'desktop_json' | 'client_session'
    enabled: boolean
    label: string
    description: string
  }>
}

export function hasReviewPending(chat: TelegramChat): boolean {
  return (chat.status === 'active' || chat.status === 'paused') && chat.pending_insight_count > 0
}

export const TELEGRAM_STATUS_LABELS: Record<TelegramChatStatus, string> = {
  unbound: 'Не привязан',
  active: 'Активен',
  paused: 'На паузе',
  closed: 'Завершён',
}

export const TELEGRAM_STATUS_COLORS: Record<TelegramChatStatus, string> = {
  unbound: 'bg-slate-50 text-slate-600 border border-slate-200',
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  paused: 'bg-amber-50 text-amber-700 border border-amber-200',
  closed: 'bg-gray-50 text-gray-500 border border-gray-200',
}

export const TELEGRAM_FIELD_LABELS_RU: Record<string, string> = {
  full_name: 'ФИО',
  phone: 'Телефон',
  city: 'Город',
  age: 'Возраст',
  degree_level: 'Ступень',
  specialty: 'Специальность',
  group_direction: 'Направление',
  additional_sphere: 'Доп. сфера',
  gpa: 'GPA',
  achievements_text: 'Достижения',
  budget_per_year: 'Бюджет в год',
  transcript_resume_url: 'Транскрипт/резюме',
  intake_year: 'Год поступления',
  intake_season: 'Сезон поступления',
}

export interface StudentFull extends StudentListItem {
  is_archived: boolean
  user_id?: string | null  // linked portal (student) account, if access was granted
  specialty?: string
  age?: number | null
  group_direction?: string | null
  additional_sphere?: string | null
  gpa?: string
  achievements_text?: string
  budget_per_year?: string
  transcript_resume_url?: string | null
  intake_season?: 'fall' | 'spring' | 'summer' | null
  contracts: Contract[]
  applications: Application[]
  services: Service[]
  portfolio_progress?: PortfolioProgress
  documents: Document[]
  student_tasks: StudentTask[]
  mentor_assignments: MentorAssignment[]
  communication_logs: CommunicationLog[]
  notes: StudentNote[]
  pending_insights: PendingInsight[]
  guardians?: Guardian[]
  confidential_notes?: ConfidentialNote[]
  responsibles?: ResponsibleUser[]
  is_mine?: boolean
  alerts?: StudentAlert[]
}

export interface StudentAlert {
  level: 'danger' | 'warning' | 'info'
  kind: 'payment_due' | 'payment_overdue' | 'mentor_unpaid'
  title: string
  amount: number | null
  currency: string
  due_date: string | null
  days: number | null
}

export interface Country {
  id: string
  country_name: string
  vpp_required: boolean
  submission_deadline_notes?: string
  notes?: string
  code?: string
  flag_emoji?: string
  flag_url?: string
  degree_levels: Array<'undergraduate' | 'graduate'>
}

export interface FinanceSummaryByCurrency {
  currency: string
  total_contracts: number
  total_amount: string
  total_paid: string
  total_remaining: string
  remaining_known_count: number
}

export interface FinanceSummary {
  total_contracts: number
  total_amount: string
  total_paid: string
  total_remaining: string
  remaining_known_count: number
  currency?: string
  by_currency?: FinanceSummaryByCurrency[]
}

export interface FinanceBreakdownContract {
  contract_id: string
  student_id: string
  student_name: string
  intake_year: number
  degree_level: DegreeLevel
  pipeline_status?: PipelineStatus
  currency: string
  amount?: string | null
  paid_amount: string
  remaining_amount: string
  calculated_remaining_amount: string
  manager_name?: string | null
  mentor_name?: string | null
  responsible_name?: string | null
  responsible_role?: 'manager' | 'mentor' | null
}

export interface FinanceBreakdown {
  contracts: FinanceBreakdownContract[]
}

export interface MentorPayout {
  mentor_id: string
  mentor_name: string
  paid: string
  to_be_paid: string
  currency?: string
}

export interface ClientBalance {
  student_id: string
  full_name: string
  intake_year: number
  degree_level: DegreeLevel
  pipeline_status?: PipelineStatus
  remaining: string
  currency: string
  responsible_name?: string | null
  responsible_role?: 'manager' | 'mentor' | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface HistoryEntry {
  id: string
  entity_type: string
  entity_id: string
  field_changed: string
  old_value?: string | null
  new_value?: string | null
  changed_by?: string | null
  source?: string | null
  changed_at: string
}

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  active_work: 'Активная работа',
  on_visa: 'На визе',
  paused: 'Пауза',
  changed_mind: 'Передумали',
  refund: 'На возврате',
  unpaid: 'Не оплачено',
  transferred_pipeline: 'Перевели',
  ielts_retake: 'Пересдача IELTS',
  suspended: 'Подвешено',
  no_status: 'Нет статуса',
}

export const PIPELINE_STATUS_COLORS: Record<PipelineStatus, string> = {
  active_work: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  on_visa: 'bg-sky-50 text-sky-700 border border-sky-200',
  paused: 'bg-amber-50 text-amber-700 border border-amber-200',
  changed_mind: 'bg-gray-50 text-gray-600 border border-gray-200',
  refund: 'bg-red-50 text-red-700 border border-red-200',
  unpaid: 'bg-orange-50 text-orange-700 border border-orange-200',
  ielts_retake: 'bg-violet-50 text-violet-700 border border-violet-200',
  suspended: 'bg-gray-50 text-gray-500 border border-gray-200',
  transferred_pipeline: 'bg-teal-50 text-teal-700 border border-teal-200',
  no_status: 'bg-gray-50 text-gray-500 border border-gray-200',
}

export const DEGREE_LEVEL_LABELS: Record<DegreeLevel, string> = {
  undergraduate: 'Бакалавр',
  masters: 'Магистр',
  foundation: 'Foundation',
  found_ug: 'Found+UG',
}

export const DEGREE_LEVEL_COLORS: Record<DegreeLevel, string> = {
  undergraduate: 'bg-sky-50 text-sky-700 border border-sky-200',
  masters: 'bg-violet-50 text-violet-700 border border-violet-200',
  foundation: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  found_ug: 'bg-teal-50 text-teal-700 border border-teal-200',
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  proforientation: 'Профориентация',
  ielts_mock: 'IELTS Mock',
  ielts_prep: 'Подготовка IELTS',
  sat_prep: 'Подготовка SAT',
  portfolio_improvement: 'Портфолио UP',
  english_general: 'Общий английский',
}

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  not_started: 'Не начато',
  scheduled: 'Запланировано',
  in_progress: 'В процессе',
  completed: 'Завершено',
  failed: 'Провалено',
  not_applicable: 'Н/П',
}

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  not_started: 'Не начато',
  documents_prep: 'Подготовка',
  submitted: 'Подано',
  offer_received: 'Оффер',
  rejected: 'Отказ',
  enrolled: 'Зачислен',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  mzk_manager: 'MZK Менеджер',
  mentor: 'Ментор',
  student: 'Студент',
}

export const PIPELINE_COLUMNS: PipelineStatus[] = [
  'active_work',
  'on_visa',
  'paused',
  'ielts_retake',
  'unpaid',
  'changed_mind',
  'refund',
  'suspended',
  'transferred_pipeline',
  'no_status',
]
