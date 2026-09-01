import type { QueryClient } from '@tanstack/react-query'

/**
 * Ключи кэша для данных одного студента в CRM (карточка и то немногое, что
 * читает её данные по id вне карточки — вкладку заявок в портале, привязку
 * телеграм-чата, редактирование конспекта).
 *
 * Зачем нужна фабрика: данные студента лежат не под одним корнем, а под
 * семью — каждый когда-то был написан по месту своей строкой. React Query
 * сверяет только точное совпадение начала ключа, поэтому
 * invalidateQueries(['student', id]) не задевает ['student-timeline', id] —
 * это два независимых дерева, пусть оба и про одного студента. Отсюда и был
 * дефект: 18 мутаций в StudentCardPage сбрасывали ['student', id], и ни одна
 * не знала, что рядом есть ещё таймлайн — добавил заметку, отметил задачу,
 * загрузил документ, а в таймлайне этого нет, пока не откроешь карточку заново.
 *
 * Фабрика не устраняет саму множественность корней — это переделка бэкенда,
 * который отдаёт профиль и таймлайн разными эндпоинтами (students.py:1068).
 * Она переводит инвалидацию с «переписал строку — забыл про соседа» на
 * «позвал функцию — получил оба».
 */
// id принимает string | undefined: вызывающая сторона обычно берёт его из
// useParams (там же типизирован нестрого) и включает запрос через
// enabled: !!id — запрещать undefined в самой фабрике только добавило бы
// приведений типов без пользы.
type MaybeId = string | undefined

export const studentKeys = {
  detail: (id: MaybeId) => ['student', id] as const,
  timeline: (id: MaybeId) => ['student-timeline', id] as const,
  history: (id: MaybeId) => ['history', 'student', id] as const,
  intake: (id: MaybeId) => ['intake', 'student', id] as const,
  notion: (id: MaybeId) => ['notion', 'student', id] as const,
  telegramChat: (id: MaybeId) => ['telegram-chat', 'student', id] as const,
  emergencyContacts: (id: MaybeId) => ['emergency-contacts', id] as const,
}

/**
 * Сбрасывает профиль студента и таймлайн вместе.
 *
 * Это пара, а не полный набор из studentKeys: intake/notion/telegram-chat
 * трогает только то, что их реально меняет (см. вызовы в StudentCardPage),
 * незачем дёргать привязку к Notion на каждую отметку задачи. А вот профиль
 * и таймлайн меняются практически любой правкой карточки — родом из одного и
 * того же события, и должны обновляться вместе. Лишний рефетч таймлайна там,
 * где он не изменился (например, правка портфолио — не событие таймлайна),
 * не заметен и не стоит того, чтобы разбирать 18 мутаций по отдельности —
 * ровно так туда и закралась исходная ошибка.
 */
export function invalidateStudent(queryClient: QueryClient, id: MaybeId): void {
  queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) })
  queryClient.invalidateQueries({ queryKey: studentKeys.timeline(id) })
}

/**
 * Финансовая сводка (`/finances`) считается на бэке от Contract.amount,
 * Contract.currency и Contract.client_remaining_amount
 * (backend/app/api/v1/endpoints/payments.py:135-144) — ровно тех полей,
 * что правит форма договора в карточке студента. Сводка не сбрасывалась
 * никогда ни при одной правке: правка договора до неё не доезжала, и
 * старые суммы на /finances можно было принять за актуальные.
 */
export const financeKeys = {
  summary: () => ['finance-summary'] as const,
  breakdown: () => ['finance-breakdown'] as const,
  notionSummary: () => ['notion', 'finance-summary'] as const,
}

export function invalidateFinances(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: financeKeys.summary() })
  queryClient.invalidateQueries({ queryKey: financeKeys.breakdown() })
  queryClient.invalidateQueries({ queryKey: financeKeys.notionSummary() })
}
