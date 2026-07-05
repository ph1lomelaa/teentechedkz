/** Нечёткий поиск по именам: терпит лишние/пропущенные пробелы, 1 опечатку
 * в слове и кириллицу↔латиницу («Syban» найдёт «Сыбан Еркенур»).
 * Зеркалит squash_name из migration/transformers/normalize.py. */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e',
  ж: 'zh', з: 'z', и: 'i', і: 'i', й: 'i', к: 'k', қ: 'k', л: 'l',
  м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya', ә: 'a',
}

export function squashName(text: string): string {
  let s = ''
  for (const ch of String(text ?? '').toLowerCase()) {
    s += ch in TRANSLIT ? TRANSLIT[ch] : ch
  }
  s = s.replace(/[^a-z\s]/g, '')
  s = s.replace(/q/g, 'k').replace(/w/g, 'v')
  s = s.replace(/[yh]/g, '')
  s = s.replace(/(.)\1+/g, '$1')
  return s.trim().replace(/\s+/g, ' ')
}

/** Расстояние Левенштейна ≤ 1 (одна вставка/удаление/замена). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  const [short, long] = la <= lb ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let edits = 0
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (short.length === long.length) i++
    j++
  }
  return edits + (long.length - j) <= 1
}

/** Подходит ли студент под поисковый запрос (имя или телефон). */
export function fuzzyStudentMatch(query: string, fullName: string, phone?: string | null): boolean {
  const q = query.trim()
  if (!q) return true

  // Телефон: сравниваем только цифры
  const qDigits = q.replace(/\D/g, '')
  if (qDigits.length >= 4 && (phone ?? '').replace(/\D/g, '').includes(qDigits)) return true

  const qs = squashName(q)
  const ns = squashName(fullName)
  if (!qs || !ns) return false

  // Подстрока без учёта пробелов: «аружанива» найдёт «Аружан Иванова»
  if (ns.replace(/\s/g, '').includes(qs.replace(/\s/g, ''))) return true

  // Пословно: каждое слово запроса — префикс или слово с 1 опечаткой
  const nameWords = ns.split(' ')
  return qs.split(' ').every((qw) =>
    nameWords.some(
      (nw) => nw.startsWith(qw) || (qw.length >= 4 && withinOneEdit(qw, nw))
    )
  )
}
