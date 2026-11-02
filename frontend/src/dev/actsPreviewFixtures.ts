import sampleServices from './act-service-sample.json'
import { guardiansApi } from '@/api'
import { actsApi, type ActInput, type ActRecord, type ActContract, type ContractService } from '@/api/acts'
import { trustmeApi, type TrustMeLink, type TrustMeCandidate } from '@/api/trustme'

/** Installed only by local Vite preview entry points, never the production app. */
export function installActsPreview(studentName = 'Аманбай Амина Өсімханқызы', parentName = 'Аманбай Айгуль Сериковна') {
const student = studentName
const parent = parentName
const signers = (name: string) => [{ name, signed: true, is_company: false }, { name: 'Представитель TeenTechEd', signed: true, is_company: true }]
const candidates: TrustMeCandidate[] = [
  { name: `Admission договор ${student}`, number: '558', status: 3, short_url: 'demo558', created_at: '2026-09-19', signers: signers(parent) },
  { name: 'Академическое сопровождение', number: '559', status: 3, short_url: 'demo559', created_at: '2026-10-15', signers: signers(student) },
  { name: 'Admission_договор_Амина (1)', number: '546', status: 1, short_url: 'demo546', created_at: '2026-11-01', signers: signers('Перлевская Оксана Анатольевна') },
  { name: 'Admission_договор_Амина__', number: '556', status: 3, short_url: 'demo556', created_at: '2026-09-19', signers: signers('Ахметова Амина Канатовна') },
  { name: 'Admission_договор_Амина_', number: '555', status: 4, short_url: 'demo555', created_at: '2026-09-19', signers: signers('Ахметова Амина Канатовна') },
  { name: 'Бакалавриат Амина Корея', number: 'UPL-'.repeat(35) + '№306', status: 3, short_url: 'demo306', created_at: '2025-03-19', signers: signers('Сапарова Амина Сункаровна') },
  { name: 'Договор Гонконг лагерь Амина', number: '427', status: 5, short_url: 'demo427', created_at: '2025-08-01', signers: signers('Омаргалиева Амина') },
]
let links: TrustMeLink[] = []
let records: ActRecord[] = []
const fields = { student_name: student, customer_name: parent, student_id_number: '000000000000', customer_id: '111111111111', customer_email: 'parent@example.com', executor_name: 'ТОО «Тестовая компания»', executor_representative: 'директора Тест Директор', executor_basis: 'Устава', executor_requisites: 'Демонстрационные реквизиты', contract_number: '671', contract_date: '2026-07-28', city: 'Алматы' }
let partial = false
let unavailable = false
const wait = () => new Promise(resolve => setTimeout(resolve, 250))
const pdf = async () => {
  const response = await fetch('/src/dev/act-sample.pdf')
  if (!response.ok) throw new Error('Тестовый PDF не найден')
  return response.blob()
}
trustmeApi.autoLink = async () => {
  await wait()
  if (unavailable) return { state: 'unavailable', linked_ids: [], review: [] }
  if (!links.length) links = [{ ...candidates[0], id: 'demo558', linked_at: new Date().toISOString(), legal_number: fields.contract_number, contract_date: fields.contract_date }]
  return { state: 'complete', linked_ids: [links[0].id], review: [], partial: false }
}
trustmeApi.list = async () => { await wait(); return links }
guardiansApi.listByStudent = async () => [{ id: 'parent-demo', student_id: 'demo', full_name: parent, relation: 'mother', is_primary: true, phone: '', email: 'parent@example.com' }] as Awaited<ReturnType<typeof guardiansApi.listByStudent>>
trustmeApi.search = async (_sid, query, aliases) => { await wait(); if (unavailable) throw new Error('TrustMe временно недоступен — тестовое состояние'); return { candidates, queries: [query, ...aliases], truncated: false } }
trustmeApi.link = async (_sid, short) => { const found = candidates.find(c => c.short_url === short)!; const link = { ...found, id: short, linked_at: new Date().toISOString() }; links = [...links, link]; return link }
trustmeApi.pdf = pdf
actsApi.contractPdf = pdf
actsApi.pdf = pdf
actsApi.preview = pdf
actsApi.context = async () => { await wait(); return { student_name: student, completed_meetings: 4, mail_configured: false, recipient_suggestions: ['parent@example.com'], contracts: links.map(link => ({ ...link, legal_number: fields.contract_number, contract_date: fields.contract_date })) as ActContract[], acts: records } }
actsApi.checkContract = async (_sid, id) => { await wait(); return { status: links.find(l => l.id === id)?.status ?? 3, checked_at: new Date().toISOString() } }
actsApi.inspect = async (_sid, id) => { await wait(); const data = { ...fields }; if (partial) { data.executor_representative = ''; data.city = '' } return { fingerprint:sampleServices.fingerprint, services:sampleServices.services as ContractService[], company_signature_available:false, applications:[], status: links.find(link => link.id === id)?.status ?? 3, fields: data, sources: Object.fromEntries(Object.keys(data).map(k => [k, { kind: 'pdf', page: 1, excerpt: 'Тестовый договор' }])), conflicts: {}, missing: partial ? ['executor_representative', 'city'] : [], service_hints: { ielts: { page: 2, reference: 'Приложение 1, IELTS', confirmed_price: { amount: '90000', currency: 'KZT', page: 2 } } }, pages: [], suggested_contract_number: '671', signers: signers(parent) } }
trustmeApi.inspect = async (sid, id) => ({ ...await actsApi.inspect(sid, id), signed_date: links.find(l => l.id === id)?.signed_date || null, signed_date_source: links.find(l => l.id === id)?.signed_date_source || null })
trustmeApi.resolve = async (_sid, reference) => { await wait(); const code = reference.split('/').pop(); const found = candidates.find(c => c.short_url === code); if (!found) throw new Error('Тестовый договор не найден. Используйте demo558.'); return found }
trustmeApi.details = async (_sid, id, details) => { const link = links.find(l => l.id === id)!; Object.assign(link, { name: details.name, legal_number: details.contract_number, contract_date: details.contract_date, signed_date: details.signed_date, signed_date_source: details.signed_date ? 'manual' : null, customer_name: details.customer_name, student_name: details.student_name }); if (link.source === 'manual' && details.signed_confirmed !== undefined) link.status = details.signed_confirmed ? 3 : 0; Object.assign(fields, { contract_number: details.contract_number, contract_date: details.contract_date || '', customer_name: details.customer_name, student_name: details.student_name }); return link }
trustmeApi.upload = async (_sid, _file, name, signed) => { await wait(); const link: TrustMeLink = { id: crypto.randomUUID(), name, source: 'manual', status: signed ? 3 : 0, number: null, short_url: 'manual-demo', signers: [], created_at: null, linked_at: new Date().toISOString() }; links = [...links, link]; return link }
actsApi.saveProfile = async (_sid, _id, values) => { Object.assign(fields, values); return { saved: true } }
function record(input: ActInput, id: string = crypto.randomUUID()): ActRecord { return { id, snapshot: structuredClone(input), student_name: input.student_name, template: input.template, act_date: input.act_date, status: 'draft', file_name: null, created_at: new Date().toISOString(), shared: false, supersedes_id: input.supersedes_id, mail: [] } }
actsApi.create = async (_sid, input) => { const row = record(input); records = [...records, row]; return row }
actsApi.update = async (id, input) => { const row = record(input, id); records = records.map(r => r.id === id ? row : r); return row }
actsApi.generate = async id => { const row = records.find(r => r.id === id)!; row.status = 'ready'; row.file_name = `${row.student_name} — Акт.pdf`; return row }
actsApi.share = async id => { records.find(r => r.id === id)!.shared = true }

return (kind: string) => {
    links = kind === 'empty' || kind === 'search-error' ? [] : [{ ...candidates[0], id: 'demo558', linked_at: new Date().toISOString(), status: kind === 'revoked' ? 4 : 3 }]
    records = []; partial = kind === 'partial'; unavailable = kind === 'search-error'
}
}
