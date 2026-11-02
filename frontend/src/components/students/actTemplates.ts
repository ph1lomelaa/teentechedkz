import type { ActInput, ActTemplate } from '@/api/acts'

// Вид акта не выбирают руками: он следует из отмеченных услуг договора и
// нужен серверу только для проверки результата (подача/оффер/зачисление).
const SINGLE: Partial<Record<string, ActTemplate>> = { portfolio:'portfolio', ielts:'ielts', profile:'profile', career:'career' }
export function inferTemplate(categories: string[], final: boolean): ActTemplate {
  if (final) return 'admission'
  if (categories.some(c => c === 'offer' || c === 'admission')) return 'offer'
  if (categories.includes('applications')) return 'applications'
  const kinds = new Set(categories)
  return kinds.size === 1 ? SINGLE[categories[0]] || 'stages' : 'stages'
}
export const REQUISITES = [
  ['student_name', 'Фамилия и имя студента по договору', true],
  ['customer_name', 'Заказчик / подписант по договору', true],
  ['student_id_number', 'ИИН / идентификатор студента', false],
  ['customer_id', 'ИИН / идентификатор заказчика', false],
  ['customer_email', 'Email заказчика', false],
  ['contract_number', 'Номер договора', true],
  ['contract_date', 'Дата договора', true],
  ['executor_name', 'Исполнитель', true],
  ['executor_representative', 'Представитель исполнителя', true],
  ['executor_basis', 'Основание полномочий', true],
  ['executor_requisites', 'Реквизиты исполнителя', false],
  ['city', 'Город', true],
] as const satisfies readonly (readonly [keyof ActInput, string, boolean])[]
export const actToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty' }).format(new Date())
export function documentTitle(name: string) { return name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() }
export function displayDate(value?: string | null) { return value ? value.slice(0, 10).split('-').reverse().join('.') : 'Без даты' }
