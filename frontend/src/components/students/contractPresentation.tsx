import type { TrustMeCandidate } from '@/api/trustme'

export function recordNumber(value?: string | null) {
  const number = value?.replace(/^(?:\s*(?:UPL\s*[-–—]?|№|#))+/i, '').trim()
  return number ? `№${number}` : 'Без номера'
}
export function contractStatus(status?: number) {
  return status === 3 ? { label: 'Подписан', color: 'bg-emerald-50 text-emerald-800' }
    : status === 4 ? { label: 'Отозван компанией', color: 'bg-red-50 text-red-700' }
    : status === 0 ? { label: 'Создан', color: 'bg-slate-100 text-slate-600' }
    : { label: 'Статус не определён', color: 'bg-slate-100 text-slate-600' }
}
export function ContractStatus({ status, source }: { status?: number; source?: string }) {
  const { label, color } = source === 'manual' ? { label: status === 3 ? 'Подписи проверены' : 'Подписи не проверены', color: status === 3 ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600' } : contractStatus(status)
  return <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${color}`}>{label}</span>
}
export function nameWords(value: string) {
  return value.normalize('NFKD').toLocaleLowerCase('ru').replace(/[әғқңөұүһіё]/g, c => ({ ә:'а', ғ:'г', қ:'к', ң:'н', ө:'о', ұ:'у', ү:'у', һ:'х', і:'и', ё:'е' })[c] || c).replace(/\p{M}/gu, '').split(/[^\p{L}]+/u).filter(Boolean)
}
// A first-name-only hit is too weak to put among likely matches.
export function identityMatch(item: TrustMeCandidate, names: string[]) {
  const haystacks = [item.name, ...item.signers.filter(s => !s.is_company).map(s => s.name || '')].map(nameWords)
  return names.some(name => {
    const words = nameWords(name)
    return words.length >= 2 && haystacks.some(found => words.filter(w => found.includes(w)).length >= 2)
  })
}
export const documentLink = 'inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-p-muted underline-offset-4 hover:text-p-text hover:underline disabled:cursor-not-allowed disabled:text-slate-400'
export const neutralDisabled = 'disabled:!border-slate-200 disabled:!bg-slate-100 disabled:!text-slate-400 disabled:!opacity-100 disabled:!shadow-none disabled:!transform-none'
