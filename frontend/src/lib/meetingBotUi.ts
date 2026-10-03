import type { MeetingBotStatus } from '@/types'

export type MeetingPlatform = 'zoom' | 'google_meet' | 'teams'

export const MEETING_PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  zoom: 'Zoom',
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
}

/**
 * Платформа по ссылке — та же логика, что на бэкенде
 * (backend/app/services/meeting_bot/platforms.py). Бот умеет только Zoom,
 * Google Meet и Teams; для остального — микрофон или файл.
 */
export function detectMeetingPlatform(url: string): MeetingPlatform | null {
  const raw = url.trim()
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) {
    return /^\/(j|my|wc|s)\//.test(path) ? 'zoom' : null
  }
  if (host === 'meet.google.com') {
    const code = path.replace(/^\/+|\/+$/g, '')
    return code && !code.includes('/') ? 'google_meet' : null
  }
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'teams'
  return null
}

/** Бот ещё в работе — показываем плашку «идёт запись». */
export const ACTIVE_BOT_STATUSES: MeetingBotStatus[] = [
  'joining',
  'waiting_room',
  'waiting_permission',
  'recording',
  'paused',
  'processing',
]

export function isBotActive(status: MeetingBotStatus | null | undefined): boolean {
  return Boolean(status && ACTIVE_BOT_STATUSES.includes(status))
}

/** Ментору нужно что-то сделать прямо сейчас (впустить бота, разрешить запись). */
export function botNeedsAttention(status: MeetingBotStatus | null | undefined): boolean {
  return status === 'waiting_room' || status === 'waiting_permission' || status === 'failed'
}

export const BOT_STEPS = [
  { key: 'sent', label: 'Бот отправлен' },
  { key: 'admit', label: 'Впустите бота' },
  { key: 'recording', label: 'Идёт запись' },
  { key: 'processing', label: 'Готовим конспект' },
  { key: 'done', label: 'Готово' },
] as const

/** Номер текущего шага (0…4). Для failed — шаг, на котором сорвалось. */
export function botStepIndex(status: MeetingBotStatus | null | undefined, joined = false): number {
  switch (status) {
    case 'joining':
    case 'waiting_room':
    case 'waiting_permission':
      return 1
    case 'recording':
    case 'paused':
      return 2
    case 'processing':
      return 3
    case 'done':
      return 4
    case 'failed':
      return joined ? 2 : 1
    default:
      return 0
  }
}

export type BotTone = 'pending' | 'attention' | 'recording' | 'processing' | 'good' | 'danger'

export interface BotStatusView {
  tone: BotTone
  title: string
  description: string
}

export function botStatusView(input: {
  status: MeetingBotStatus | null | undefined
  platform: MeetingPlatform | null
  reasonMessage?: string | null
}): BotStatusView {
  const zoomStayHint = 'Не выходите из Zoom до конца встречи — бот выйдет вместе с вами.'
  switch (input.status) {
    case 'joining':
      return {
        tone: 'pending',
        title: 'Бот заходит во встречу…',
        description: input.platform === 'zoom'
          ? 'Запрос отправлен. Подключаем бота к Zoom; организатор должен быть во встрече с подключённого аккаунта.'
          : 'Через несколько секунд бот попросится в звонок — нажмите «Принять» или «Впустить».',
      }
    case 'waiting_room':
      return {
        tone: 'attention',
        title: 'Впустите бота в звонок',
        description: 'Участник «TeenTechEd» ждёт в зале ожидания. Нажмите «Впустить» или «Принять» во встрече.',
      }
    case 'waiting_permission':
      return {
        tone: 'attention',
        title: 'Разрешите боту запись',
        description: input.reasonMessage || 'Во встрече нажмите «Разрешить запись» для участника «TeenTechEd».',
      }
    case 'recording':
      return {
        tone: 'recording',
        title: 'Идёт запись',
        description: input.platform === 'zoom'
          ? `Бот в звонке и записывает разговор. ${zoomStayHint}`
          : 'Бот в звонке и записывает разговор. Можно спокойно разговаривать — конспект придёт после встречи.',
      }
    case 'paused':
      return { tone: 'attention', title: 'Запись на паузе', description: 'Бот в звонке, но запись приостановлена.' }
    case 'processing':
      return {
        tone: 'processing',
        title: 'Готовим конспект…',
        description: 'Обычно это 1–2 минуты. Пришлём уведомление, когда конспект будет готов, — страницу можно закрыть.',
      }
    case 'done':
      return { tone: 'good', title: 'Конспект готов', description: 'Проверьте черновик и примените изменения к профилю студента.' }
    case 'failed':
      return {
        tone: 'danger',
        title: 'Запись не идёт',
        description: input.reasonMessage || 'Что-то пошло не так с записью. Нажмите «Отправить ещё раз».',
      }
    default:
      return { tone: 'pending', title: 'Бот готов к отправке', description: 'Вставьте ссылку на встречу и нажмите «Отправить бота».' }
  }
}

/** Короткая подпись для плашки сверху. */
export function botBarLabel(status: MeetingBotStatus | null | undefined): string {
  switch (status) {
    case 'joining':
      return 'Бот заходит во встречу'
    case 'waiting_room':
      return 'Впустите бота в звонок'
    case 'waiting_permission':
      return 'Разрешите боту запись'
    case 'recording':
      return 'Идёт запись'
    case 'paused':
      return 'Запись на паузе'
    case 'processing':
      return 'Готовим конспект'
    default:
      return 'Запись'
  }
}

// ---------------------------------------------------------------- загрузка файла

/** Тот же лимит, что на сервере (backend/app/services/note_upload.py). */
export const MAX_RECORDING_FILE_BYTES = 300 * 1024 * 1024

const RECORDING_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'webm', 'flac', 'amr', '3gp', 'mp4', 'mov', 'm4v']

export const RECORDING_FILE_ACCEPT = ['audio/*', 'video/*', ...RECORDING_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

/** Аудио или видео со звуком и не больше лимита. */
export function isAcceptedRecordingFile(file: { name: string; type: string; size: number }): boolean {
  if (file.size <= 0 || file.size > MAX_RECORDING_FILE_BYTES) return false
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  return RECORDING_EXTENSIONS.includes(ext) || file.type.startsWith('audio/') || file.type.startsWith('video/')
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} МБ`
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}
