/**
 * Имя для обращения («Привет, Данияр»).
 *
 * Имя ученика в кабинете — это full_name из карточки CRM, а там принят порядок
 * «Фамилия Имя Отчество». Первое слово — фамилия, поэтому раньше ученика
 * приветствовали по фамилии. Имя — второе слово; у одного слова берём его.
 * Если имя придёт в другом порядке (Google: «Имя Фамилия»), менять нужно здесь.
 */
export function givenName(fullName: string | null | undefined, fallback = 'студент'): string {
  // Подпись после « · » (роль, «ученица») к имени не относится; знаки без букв не слова.
  const parts = (fullName ?? '').split(/\s+[·|—–-]\s+/)[0].trim().split(/\s+/).filter((part) => /\p{L}/u.test(part))
  if (parts.length === 0) return fallback
  return parts.length >= 2 ? parts[1] : parts[0]
}
