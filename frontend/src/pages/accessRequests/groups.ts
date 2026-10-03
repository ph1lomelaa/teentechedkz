import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'

/** Шесть групп очереди. Каждая заявка попадает ровно в одну. */
export type RequestGroup = 'attach' | 'busy' | 'linked' | 'check' | 'create' | 'mentor'
export type RequestTab = RequestGroup | 'all'

export const GROUP_ORDER: RequestGroup[] = ['attach', 'busy', 'linked', 'check', 'create', 'mentor']

/** Массовое одобрение безопасно только при единственном точном совпадении
 * телефона со свободной карточкой. Это же правило у сервера
 * (`suggest_student.auto_linkable`) — здесь только чтобы не предлагать кнопку,
 * которая ничего не сделает; решение всё равно принимает бэкенд. */
export function isAutoApprovable(item: AccessRequestItem): boolean {
  if (item.requested_role !== 'student') return false
  const byPhone = (item.candidates ?? []).filter((candidate) => candidate.reason === 'phone')
  return byPhone.length === 1 && byPhone[0].is_free
}

/** Кандидаты по телефону — те, из-за кого заявка вообще «найдена». */
export function phoneCandidates(item: AccessRequestItem): StudentCandidate[] {
  return (item.candidates ?? []).filter((candidate) => candidate.reason === 'phone')
}

/**
 * Заявитель и владелец найденной карточки — один пользователь.
 *
 * Строго по user_id владельца карточки (его отдаёт очередь). Сервер повторно
 * проверяет это же условие в `close-linked`.
 */
export function isSameAccount(item: AccessRequestItem, candidate: StudentCandidate): boolean {
  const ownerId = candidate.portal_owner?.user_id
  return Boolean(ownerId) && ownerId === item.user.id
}

/** Запасная подсказка для бэкенда без `portal_owner.user_id`: email кабинета
 * совпал с email заявителя. Когда user_id приходит, решает он, а не email. */
export function looksLikeSameAccount(item: AccessRequestItem): boolean {
  const email = item.user.email.trim().toLowerCase()
  return phoneCandidates(item).some(
    (candidate) =>
      !candidate.is_free &&
      candidate.portal_owner?.user_id === undefined &&
      candidate.portal_owner?.email.trim().toLowerCase() === email,
  )
}

export function getRequestGroup(item: AccessRequestItem): RequestGroup {
  if (item.requested_role !== 'student') return 'mentor'
  if (isAutoApprovable(item)) return 'attach'
  const byPhone = phoneCandidates(item)
  if (byPhone.length > 0 && byPhone.every((candidate) => !candidate.is_free)) {
    return byPhone.some((candidate) => isSameAccount(item, candidate)) ? 'linked' : 'busy'
  }
  return (item.candidates ?? []).length > 0 ? 'check' : 'create'
}

interface GroupMeta {
  tab: string
  badge: string
  hint: string
  /** Классы бейджа: цвет текста, тонированный фон и рамка от одного токена st-*. */
  badgeClass: string
  dotClass: string
}

export const GROUP_META: Record<RequestGroup, GroupMeta> = {
  attach: {
    tab: 'Прикрепить',
    badge: 'Прикрепить',
    hint: 'Телефон совпал с единственной свободной карточкой — можно прикрепить всех сразу.',
    badgeClass: 'border-st-attach/40 bg-st-attach/15 text-st-attach',
    dotClass: 'bg-st-attach',
  },
  busy: {
    tab: 'Кабинет занят',
    badge: 'Кабинет занят',
    hint: 'Кабинет занят: замена по одной заявке, с подтверждением.',
    badgeClass: 'border-st-busy/40 bg-st-busy/15 text-st-busy',
    dotClass: 'bg-st-busy',
  },
  linked: {
    tab: 'Уже привязан',
    badge: 'Уже привязан',
    hint: 'Уже привязан: аккаунт уже владеет карточкой, заявку достаточно закрыть.',
    badgeClass: 'border-st-linked/40 bg-st-linked/15 text-st-linked',
    dotClass: 'bg-st-linked',
  },
  check: {
    tab: 'Проверить',
    badge: 'Проверить',
    hint: 'Проверить: совпало только ФИО или кандидатов несколько. Раскройте строку и выберите карточку.',
    badgeClass: 'border-st-check/40 bg-st-check/15 text-st-check',
    dotClass: 'bg-st-check',
  },
  create: {
    tab: 'Создать карточку',
    badge: 'Создать',
    hint: 'Создать карточку: в базе нет похожих или не указан телефон.',
    badgeClass: 'border-st-create/40 bg-st-create/15 text-st-create',
    dotClass: 'bg-st-create',
  },
  mentor: {
    tab: 'Менторы',
    badge: 'Ментор',
    hint: 'Менторы: карточек нет, заявки одобряются по одной.',
    badgeClass: 'border-st-mentor/40 bg-st-mentor/15 text-st-mentor',
    dotClass: 'bg-st-mentor',
  },
}

/** Заявка подходит под строку поиска: имя, телефон (по цифрам) или email. */
export function matchesSearch(item: AccessRequestItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (item.full_name.toLowerCase().includes(q) || item.user.email.toLowerCase().includes(q)) return true
  const digits = q.replace(/\D/g, '')
  return digits.length > 0 && (item.phone ?? '').replace(/\D/g, '').includes(digits)
}
