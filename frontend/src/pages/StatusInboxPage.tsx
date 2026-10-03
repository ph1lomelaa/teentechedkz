import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { CheckCircle2, ChevronDown, MoreHorizontal, Search } from 'lucide-react'
import { mentorAssignmentsApi, notesApi, pendingInsightsApi } from '@/api'
import { useAuth } from '@/contexts/AuthContext'
import { humanizeInsightValue, INSIGHT_TYPE_LABELS } from '@/components/shared/InsightCard'
import { AppButton, AppCard, PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { QueryError } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { DEGREE_LEVEL_LABELS, type DegreeLevel, type InsightWithDiff, type StudentNote, TELEGRAM_FIELD_LABELS_RU } from '@/types'
import { cn } from '@/lib/utils'

const CONFIDENT = .8
const PAGE_SIZE = 20
type TabKey = 'changes' | 'drafts' | 'resolved'
type Scope = 'mine' | 'all'
const sourceLabel = (source: string) => INSIGHT_TYPE_LABELS[source] || ({meeting:'Итог созвона',telegram:'Telegram',manual:'Вручную'}[source] || source)
const when = (date: string) => new Date(date).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
const nameMatches = (name: string|null|undefined, search: string) => (name || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
const approvable = (i: InsightWithDiff) => i.diff.length > 0 || Object.keys(i.unmatched_fields || {}).length > 0
const shortName = (name: string) => { const parts=name.trim().split(/\s+/); return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : name }

export default function StatusInboxPage() {
  const {user}=useAuth()
  const workspace=useLocation().pathname.startsWith('/workspace')
  const studentPath=(id:string)=>workspace?`/workspace/students/${id}`:`/students/${id}`
  const notePath=(id:string)=>workspace?`/workspace/meetings/notes/${id}`:`/notes/${id}`
  const scopeKey=`tte-confirmation-scope:${user?.id || 'current'}`
  const [scope,setScope]=useState<Scope>(()=>sessionStorage.getItem(scopeKey)==='all'?'all':'mine')
  const [tab,setTab]=useState<TabKey>('changes')
  const [search,setSearch]=useState(''); const [source,setSource]=useState('');const [sort,setSort]=useState('new')
  const [visibleCount,setVisibleCount]=useState(PAGE_SIZE)
  const [expanded,setExpanded]=useState<Record<string,boolean>>({})
  const [departing,setDeparting]=useState<Set<string>>(new Set())
  const [dismissed,setDismissed]=useState<Set<string>>(new Set())
  const qc=useQueryClient()
  useEffect(()=>{sessionStorage.setItem(scopeKey,scope)},[scope,scopeKey])
  useEffect(()=>{setVisibleCount(PAGE_SIZE);setExpanded({})},[scope,tab,search,source,sort])
  const pendingQuery=useQuery({queryKey:['pending-insights','pending','all'],queryFn:()=>pendingInsightsApi.listAll('pending','all')})
  const history=useQuery({queryKey:['pending-insights','resolved',scope],queryFn:()=>pendingInsightsApi.listAll('resolved',scope,200)})
  const notes=useQuery({queryKey:['student-notes','draft',scope],queryFn:()=>notesApi.list({status:'draft',scope})})
  const allNotes=useQuery({queryKey:['student-notes','draft','all'],queryFn:()=>notesApi.list({status:'draft',scope:'all'}),enabled:scope==='mine'})
  const invalidate=()=>{qc.invalidateQueries({queryKey:['pending-insights']});qc.invalidateQueries({queryKey:['student-notes']})}
  const remove=(id:string)=>{
    setDeparting(prev=>new Set(prev).add(id))
    window.setTimeout(()=>{setDismissed(prev=>new Set(prev).add(id));setDeparting(prev=>{const next=new Set(prev);next.delete(id);return next});invalidate()},200)
  }
  const review=useMutation({mutationFn:({id,action}:{id:string;action:'approve'|'reject'})=>pendingInsightsApi.review(id,action),onSuccess:(_,v)=>{remove(v.id);toast({title:v.action==='approve'?'Подтверждено':'Отклонено',duration:5000})},onError:e=>toast({title:'Не удалось обработать предложение',description:getErrorMessage(e),variant:'destructive'})})
  const batch=useMutation({mutationFn:async(ids:string[])=>{let done=0;for(const id of ids){try{await pendingInsightsApi.review(id,'approve');remove(id);done++}catch{/* Failed rows stay visible. */}}return{done,failed:ids.length-done}},onSuccess:r=>toast({title:`Подтверждено: ${r.done}${r.failed?` · Не удалось: ${r.failed}`:''}`,variant:r.failed?'destructive':'default',duration:5000})})
  const reviewNote=useMutation({mutationFn:({id,action}:{id:string;action:'approve'|'reject'})=>notesApi.review(id,{action}),onSuccess:(_,v)=>{remove(v.id);toast({title:v.action==='approve'?'Конспект подтверждён':'Конспект отклонён',duration:5000})},onError:e=>toast({title:'Не удалось обработать конспект',description:getErrorMessage(e),variant:'destructive'})})
  const assign=useMutation({mutationFn:mentorAssignmentsApi.assignSelf,onSuccess:()=>{invalidate();toast({title:'Студент добавлен в ваши'})},onError:e=>toast({title:getErrorMessage(e),variant:'destructive'})})
  const allPending=(pendingQuery.data || []).filter(i=>!dismissed.has(i.id))
  const minePending=allPending.filter(i=>i.is_mine)
  const scopedPending=scope==='mine'?minePending:allPending
  const pending=scopedPending.filter(i=>nameMatches(i.student_name,search)&&(!source||i.insight_type===source))
  const resolved=(history.data || []).filter(i=>nameMatches(i.student_name,search)&&(!source||i.insight_type===source))
  const drafts=(notes.data || []).filter(n=>!dismissed.has(n.id)&&nameMatches(n.student_name,search)&&(!source||n.source_kind===source))
  const groupInsights=(items:InsightWithDiff[])=>{
    const grouped=new Map<string,InsightWithDiff[]>()
    for(const i of [...items].sort((a,b)=>sort==='attention'&&(a.confidence<CONFIDENT)!==(b.confidence<CONFIDENT)?Number(b.confidence<CONFIDENT)-Number(a.confidence<CONFIDENT):Date.parse(b.created_at)-Date.parse(a.created_at))){const group=grouped.get(i.student_id)||[];group.push(i);grouped.set(i.student_id,group)}
    return [...grouped.entries()]
  }
  const groups=groupInsights(tab==='resolved'?resolved:pending)
  const draftGroups=useMemo(()=>{const grouped=new Map<string,StudentNote[]>();for(const n of [...drafts].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))){const id=n.student_id||'unlinked';const group=grouped.get(id)||[];group.push(n);grouped.set(id,group)}return [...grouped.entries()]},[drafts])
  const groupCount=tab==='drafts'?draftGroups.length:groups.length
  const counts={changes:scopedPending.length,drafts:(notes.data||[]).filter(n=>!dismissed.has(n.id)).length,resolved:history.data?.length||0}
  const sources=[...new Set(tab==='drafts'?(notes.data||[]).map(n=>n.source_kind).filter(Boolean) as string[]:(tab==='resolved'?history.data||[]:scopedPending).map(i=>i.insight_type))]
  const attention=scopedPending.filter(i=>i.confidence<CONFIDENT).length
  const studentCount=new Set(scopedPending.map(i=>i.student_id)).size
  const activeQuery=tab==='drafts'?notes:tab==='resolved'?history:pendingQuery
  const busy=review.isPending||batch.isPending||reviewNote.isPending
  const allCount=tab==='drafts'?(allNotes.data?.length||0):tab==='resolved'?0:allPending.length
  const toggle=(key:string,index:number)=>setExpanded(prev=>({...prev,[key]:!(prev[key]??index<5)}))
  return <div className="fade-in text-w-ink">
    <PageHeader eyebrow="Кабинет ментора" title="На подтверждение" description="ИИ находит изменения в чатах и созвонах. В карточку попадает только то, что вы подтвердите." colorPrefix="w" />
    <p className="mb-6 text-sm text-w-muted" aria-live="polite">{pendingQuery.isLoading?'Проверяем очередь…':`${scopedPending.length} ${plural(scopedPending.length,'изменение','изменения','изменений')} у ${studentCount} ${plural(studentCount,'студента','студентов','студентов')} · ${attention} требуют внимания`}</p>
    <div role="tablist" aria-label="Очередь подтверждений" className="flex gap-1 overflow-x-auto border-b border-w-line">{([['changes','Изменения в карточках'],['drafts','Черновики конспектов'],['resolved','Разобранные']] as [TabKey,string][]).map(([value,label])=><button key={value} role="tab" aria-selected={tab===value} onClick={()=>{setTab(value);setSource('')}} className={cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-bold',tab===value?'border-w-accent text-w-ink':'border-transparent text-w-muted hover:text-w-ink')}>{label}{counts[value]>0&&<span className="rounded-pill bg-w-panel2 px-2 py-0.5 text-xs">{counts[value]}</span>}</button>)}</div>
    <div className="my-5 flex flex-wrap items-center gap-3"><SegmentedTabs value={scope} onChange={v=>setScope(v as Scope)} tabs={[{value:'mine',label:'Мои'},{value:'all',label:'Все'}]} colorPrefix="w"/><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-w-muted"/><input aria-label="Поиск по имени студента" placeholder="Имя студента" className="h-10 w-full rounded-ctl border border-w-line bg-w-panel pl-9 pr-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)}/></div><select aria-label="Источник предложения" className="h-10 rounded-ctl border border-w-line bg-w-panel px-3 text-sm" value={source} onChange={e=>setSource(e.target.value)}><option value="">Все источники</option>{sources.map(x=><option key={x} value={x}>{sourceLabel(x)}</option>)}</select><select aria-label="Сортировка предложений" className="h-10 rounded-ctl border border-w-line bg-w-panel px-3 text-sm" value={sort} onChange={e=>setSort(e.target.value)}><option value="new">Сначала новые</option>{tab!=='drafts'&&<option value="attention">Сначала требующие внимания</option>}</select></div>
    <div role="tabpanel">{activeQuery.isError?<QueryError colorPrefix="w" error={activeQuery.error} onRetry={()=>activeQuery.refetch()}/>:activeQuery.isLoading?<div aria-label="Загрузка предложений" className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-28 animate-pulse rounded-panel bg-w-panel2"/>)}</div>:!groupCount?<EmptyState colorPrefix="w" icon={<CheckCircle2 className="h-6 w-6"/>} title="Всё разобрано" description="Новые предложения появятся после следующей проверки чатов" action={scope==='mine'&&!search&&!source&&allCount>0?<AppButton colorPrefix="w" variant="ghost" onClick={()=>setScope('all')}>Показать все ({allCount})</AppButton>:undefined}/>:<div className="space-y-4">
      {tab==='drafts'?draftGroups.slice(0,visibleCount).map(([id,items],index)=>{const key=`draft-${id}`,open=expanded[key]??index<5;return <AppCard colorPrefix="w" className="p-0" key={key}><GroupHeader name={items[0].student_name||'Без студента'} path={id==='unlinked'?undefined:studentPath(id)} count={items.length} open={open} onToggle={()=>toggle(key,index)} label="конспектов"/>{open&&<div className="px-4 sm:px-5">{items.map(n=><div key={n.id} className={cn('flex flex-wrap items-start gap-3 border-t border-w-line py-4 transition-all duration-200',departing.has(n.id)&&'translate-x-2 opacity-0')}><div className="min-w-0 flex-1"><div className="mb-1 flex gap-2 text-xs text-w-muted"><span>{sourceLabel(n.source_kind||'manual')}</span><span>{when(n.created_at)}</span></div><Link to={notePath(n.id)} className="font-bold hover:underline">{n.title}</Link><p className="mt-2 line-clamp-2 text-sm text-w-muted">{n.summary_markdown.replace(/[#*_`>]/g,'').replace(/—/g,',')}</p></div><div className="flex flex-wrap gap-2"><Link className="inline-flex items-center rounded-ctl px-3 py-2 text-xs font-bold text-w-ink hover:bg-w-panel2" to={notePath(n.id)}>Открыть</Link><AppButton colorPrefix="w" size="sm" disabled={busy} onClick={()=>reviewNote.mutate({id:n.id,action:'approve'})}>Подтвердить</AppButton><AppButton colorPrefix="w" variant="ghost" size="sm" disabled={busy} onClick={()=>reviewNote.mutate({id:n.id,action:'reject'})}>Отклонить</AppButton></div></div>)}</div>}</AppCard>}):groups.slice(0,visibleCount).map(([id,items],index)=>{const key=`${tab}-${id}`,open=expanded[key]??index<5;const first=items[0];const names=[...new Set((first.responsibles||[]).filter(r=>r.is_active&&r.name).map(r=>r.name!))];const ids=items.filter(approvable).map(i=>i.id);return <AppCard colorPrefix="w" className="p-0" key={key}><GroupHeader name={first.student_name||'Студент'} path={studentPath(id)} count={items.length} open={open} onToggle={()=>toggle(key,index)} names={names} actions={tab==='changes'?<><AppButton size="sm" colorPrefix="w" disabled={busy||!ids.length} onClick={()=>batch.mutate(ids)}>Подтвердить все ({ids.length})</AppButton>{scope==='all'&&<details className="relative"><summary aria-label={`Действия: ${first.student_name}`} className="list-none cursor-pointer rounded-ctl p-2 hover:bg-w-panel2"><MoreHorizontal className="h-4 w-4"/></summary><div className="absolute right-0 z-10 mt-2 min-w-40 rounded-ctl border border-w-line bg-w-panel p-2 shadow-lg">{!first.is_mine&&<button disabled={assign.isPending} onClick={()=>assign.mutate(id)} className="w-full rounded-ctl px-3 py-2 text-left text-sm hover:bg-w-panel2">Взять студента</button>}<Link className="block px-3 py-2 text-sm hover:bg-w-panel2" to={studentPath(id)}>Карточка студента</Link></div></details>}</>:undefined}/>{open&&<div className="px-4 sm:px-5">{items.map(i=><ProposalRow key={i.id} insight={i} departing={departing.has(i.id)} disabled={busy} onApprove={tab==='changes'?()=>review.mutate({id:i.id,action:'approve'}):undefined} onReject={tab==='changes'?()=>review.mutate({id:i.id,action:'reject'}):undefined}/>)}</div>}</AppCard>})}
      {groupCount>visibleCount&&<div className="text-center"><AppButton colorPrefix="w" variant="subtle" onClick={()=>setVisibleCount(n=>n+PAGE_SIZE)}>Показать ещё ({Math.min(PAGE_SIZE,groupCount-visibleCount)})</AppButton><p className="mt-2 text-xs text-w-muted">Показано {visibleCount} из {groupCount} групп</p></div>}
    </div>}</div>
  </div>
}

function GroupHeader({name,path,count,open,onToggle,names=[],actions,label='изменений'}:{name:string;path?:string;count:number;open:boolean;onToggle:()=>void;names?:string[];actions?:React.ReactNode;label?:string}){
  return <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"><div className="flex min-w-0 items-center gap-3"><button aria-label={`${open?'Свернуть':'Развернуть'} группу ${name}`} aria-expanded={open} onClick={onToggle} className="shrink-0 rounded-ctl p-1 hover:bg-w-panel2"><ChevronDown className={cn('h-4 w-4 transition-transform',!open&&'-rotate-90')}/></button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{path?<Link className="font-bold hover:underline" to={path}>{name}</Link>:<span className="font-bold">{name}</span>}<span className="rounded-pill bg-w-panel2 px-2 py-0.5 text-xs text-w-muted">{count} {label==='конспектов'?plural(count,'конспект','конспекта','конспектов'):plural(count,'изменение','изменения','изменений')}</span></div>{names.length>0&&<p title={names.join(', ')} className="mt-1 text-xs text-w-muted">{names.slice(0,2).map(shortName).join(', ')}{names.length>2?` +${names.length-2}`:''}</p>}</div></div><div className="ml-auto flex items-center gap-2">{actions}</div></div>
}
function blank(v:unknown){return v==null||v===''||(Array.isArray(v)&&!v.length)}
function Value({value,field}:{value:unknown;field:string}){
  if(typeof value==='string'&&/^https?:\/\//.test(value)){let label='Ссылка';try{const u=new URL(value);label=u.hostname==='docs.google.com'?'Google Doc':u.hostname==='drive.google.com'?'Google Drive':u.hostname}catch{/* display as link */}return <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-pill border border-w-line bg-w-panel2 px-2 py-0.5 text-xs font-semibold hover:underline">{label} ↗</a>}
  const text=field==='degree_level'&&typeof value==='string'?DEGREE_LEVEL_LABELS[value as DegreeLevel]||value:humanizeInsightValue(value)
  return <>{text.replace(/—/g,'не заполнено')}</>
}
function ProposalRow({insight:i,departing,disabled,onApprove,onReject}:{insight:InsightWithDiff;departing?:boolean;disabled?:boolean;onApprove?:()=>void;onReject?:()=>void}){
  const [full,setFull]=useState(false)
  const excerpt=i.source_excerpt||''
  const pending=i.status==='pending'
  return <div className={cn('flex flex-col gap-3 border-t border-w-line py-4 text-sm transition-all duration-200 lg:flex-row lg:items-start',departing&&'translate-x-2 opacity-0')}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-w-muted lg:w-32 lg:flex-col lg:items-start"><span className="rounded-pill border border-w-line bg-w-panel2 px-2 py-1">{sourceLabel(i.insight_type)}</span><span>{when(i.source_created_at||i.created_at)}</span>{pending&&i.confidence<CONFIDENT&&<span className="rounded-pill border border-amber-500/40 bg-amber-500/15 px-2 py-1 font-semibold text-amber-800 dark:text-amber-300">Проверьте · {Math.round(i.confidence*100)}%</span>}{pending&&i.risk_level==='sensitive'&&<span className="text-xs font-semibold text-w-ink">Чувствительные данные</span>}{!pending&&<span>{i.status==='approved'?'Подтверждено':'Отклонено'}</span>}</div>
    <div className="min-w-0 flex-1 space-y-2">{i.diff.map(d=><p key={d.field} className="[overflow-wrap:anywhere]"><span className="text-w-muted">{TELEGRAM_FIELD_LABELS_RU[d.field]||d.field}: </span>{pending&&!blank(d.old_value)&&<><span className="text-w-muted line-through"><Value field={d.field} value={d.old_value}/></span><span className="mx-2 text-w-muted">→</span></>}<strong className="font-bold"><Value field={d.field} value={d.new_value}/></strong>{pending&&blank(d.old_value)&&<span className="ml-2 text-xs text-w-muted">новое</span>}</p>)}{Object.entries(i.unmatched_fields||{}).map(([field,value])=><p key={field} className="text-sm [overflow-wrap:anywhere]"><span className="text-w-muted">{({context_note:'Заметка',suggested_but_uncertain:'Требует проверки'}[field]||TELEGRAM_FIELD_LABELS_RU[field]||field)}: </span><Value field={field} value={value}/></p>)}{excerpt&&<div className="text-xs text-w-muted"><p className={cn('italic [overflow-wrap:anywhere]',!full&&'line-clamp-1')}>{i.source_sender&&`${i.source_sender}: `}{excerpt.replace(/—/g,',')}</p>{excerpt.length>100&&<button className="mt-1 underline underline-offset-2" onClick={()=>setFull(v=>!v)}>{full?'Свернуть':'Показать полностью'}</button>}</div>}</div>
    {onApprove&&onReject&&<div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">{approvable(i)&&<AppButton size="sm" colorPrefix="w" disabled={disabled} onClick={onApprove}>Подтвердить</AppButton>}<AppButton size="sm" colorPrefix="w" variant="ghost" disabled={disabled} onClick={onReject}>Отклонить</AppButton></div>}
  </div>
}
function plural(n:number,one:string,few:string,many:string){return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many}
