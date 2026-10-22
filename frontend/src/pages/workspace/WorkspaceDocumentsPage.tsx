import { DocumentWorkflowHelp } from '@/components/shared/DocumentReviewControls'
import { DocumentList, documentName } from '@/components/shared/DocumentList'
import { invalidateDocuments } from '@/lib/queryKeys'
import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Search, Upload, X } from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { workspaceApi, type WorkspaceDocument } from '@/api/workspace'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { DOC_TYPE_LABELS, DocType } from '@/types'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import { AppButton, AppCard, AppInput, AppSelect, EmptyState, PageHeader } from '@/components/ui'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { QueryState } from '@/components/shared/QueryState'

type ReviewFilter = 'all' | 'unverified' | 'verified'

/** Сколько групп студентов раскрыто сразу — остальные свёрнуты в строку со счётчиками. */
const OPEN_BY_DEFAULT = 5

interface StudentDocs {
  studentId: string
  studentName: string
  items: WorkspaceDocument[]
  unverified: number
  latest: string
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Студенты с непроверенными файлами — выше, внутри группы — от свежих к старым. */
function groupByStudent(documents: WorkspaceDocument[]): StudentDocs[] {
  const map = new Map<string, StudentDocs>()
  for (const doc of documents) {
    const group = map.get(doc.student_id) ?? { studentId: doc.student_id, studentName: doc.student_name, items: [], unverified: 0, latest: '' }
    group.items.push(doc)
    if (!doc.is_verified) group.unverified += 1
    if (doc.uploaded_at > group.latest) group.latest = doc.uploaded_at
    map.set(doc.student_id, group)
  }
  for (const group of map.values()) group.items.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
  return [...map.values()].sort((a, b) =>
    Number(b.unverified > 0) - Number(a.unverified > 0)
    || b.latest.localeCompare(a.latest)
    || a.studentName.localeCompare(b.studentName, 'ru'))
}

export const WorkspaceDocumentsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const canManage = can('documents', 'manage')
  const { params } = useWorkspaceScope()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadStudentId, setUploadStudentId] = useState('')
  const [studentId, setStudentId] = useLocalState('workspace:documents:studentFilter', '')
  const [source, setSource] = useLocalState('workspace:documents:sourceFilter', '')
  const [reviewFilter, setReviewFilter] = useLocalState<ReviewFilter>('workspace:documents:reviewFilter', 'unverified')
  const [search, setSearch] = useLocalState('workspace:documents:search', '')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [docType, setDocType] = useState<DocType>('other')
  const [file, setFile] = useState<File | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'documents', params],
    queryFn: () => workspaceApi.documents(params),
  })

  const documents = useMemo(() => data?.items ?? [], [data?.items])
  const { data: studentsData } = useQuery({
    queryKey: ['workspace', 'documents', 'students', params],
    queryFn: () => workspaceApi.students(params),
  })
  const students = (studentsData?.items ?? []).map((item) => item.student)

  // Все фильтры, кроме проверки: от этого набора считаются счётчики вкладок.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter((doc) =>
      (!studentId || doc.student_id === studentId)
      && (!source
        || (source === 'internal' && doc.source_message?.channel === 'internal')
        || (source === 'manual_upload' && doc.source === 'manual_upload' && !doc.source_message)
        || (!['internal', 'manual_upload'].includes(source) && doc.source === source))
      && (!q || documentName(doc).toLowerCase().includes(q) || doc.file_name.toLowerCase().includes(q) || doc.student_name.toLowerCase().includes(q)),
    )
  }, [documents, search, source, studentId])
  const reviewCounts = useMemo(() => ({
    unverified: filtered.filter((doc) => !doc.is_verified).length,
    verified: filtered.filter((doc) => doc.is_verified).length,
    all: filtered.length,
  }), [filtered])
  const visibleDocuments = useMemo(
    () => filtered.filter((doc) => reviewFilter === 'all' || (reviewFilter === 'verified' ? doc.is_verified : !doc.is_verified)),
    [filtered, reviewFilter],
  )
  const groups = useMemo(() => groupByStudent(visibleDocuments), [visibleDocuments])
  const isOpen = (group: StudentDocs, index: number) => toggled[group.studentId] ?? (groups.length === 1 || index < OPEN_BY_DEFAULT)
  const allOpen = groups.every((group, index) => isOpen(group, index))
  const hasFilters = Boolean(search || studentId || source)

  const toggleVisibilityMutation = useMutation({
    mutationFn: (doc: { id: string; visible_to_student?: boolean }) =>
      documentsApi.setVisibility(doc.id, !doc.visible_to_student),
    onSuccess: () => {
      invalidateDocuments(queryClient)
      toast({ title: 'Видимость документа обновлена' })
    },
    onError: () => toast({ title: 'Не удалось изменить видимость', variant: 'destructive' }),
  })
  const uploadMutation = useMutation({
    mutationFn: () => documentsApi.upload(uploadStudentId, file!, docType),
    onSuccess: () => {
      setFile(null)
      invalidateDocuments(queryClient)
      toast({ title: 'Документ загружен' })
    },
    onError: () => toast({ title: 'Не удалось загрузить документ', variant: 'destructive' }),
  })

  const downloadDocument = async (id: string, fileName: string) => {
    try {
      const blob = await documentsApi.download(id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Не удалось скачать документ', variant: 'destructive' })
    }
  }

  const previewDocument = async (id: string) => {
    const previewTab = window.open('', '_blank')
    try {
      const blob = await documentsApi.download(id)
      const url = URL.createObjectURL(blob)
      if (previewTab) previewTab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      previewTab?.close()
      toast({ title: 'Не удалось открыть предпросмотр', variant: 'destructive' })
    }
  }

  return (
    <div className="fade-in">
      <PageHeader colorPrefix="w"
        eyebrow="Кабинет ментора"
        title="Документы"
        description="Все документы студентов из кабинета, Telegram, сообщений и ручных загрузок — по студентам."
        action={canManage ? (
          <AppButton colorPrefix="w" variant={uploadOpen ? 'subtle' : 'primary'} onClick={() => setUploadOpen((open) => !open)}>
            {uploadOpen ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {uploadOpen ? 'Закрыть' : 'Загрузить документ'}
          </AppButton>
        ) : undefined}
      />

      {canManage && uploadOpen && (
        <AppCard colorPrefix="w" className="mb-5 p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink"><Upload className="h-4 w-4 text-w-accentText" />Загрузить документ</div>
          <div className="grid gap-2 lg:grid-cols-[240px_210px_1fr_auto]">
            <AppSelect colorPrefix="w" aria-label="Студент для загрузки" value={uploadStudentId} onChange={(event) => setUploadStudentId(event.target.value)} className="bg-w-panel2">
              <option value="">Выберите студента</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
            </AppSelect>
            <AppSelect colorPrefix="w" aria-label="Тип загружаемого документа" value={docType} onChange={(event) => setDocType(event.target.value as DocType)} className="bg-w-panel2">
              {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AppSelect>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-xs text-w-muted transition hover:border-w-accentDim">
              <span className="rounded-ctl bg-w-accent px-3 py-1 font-bold text-black">Выбрать файл</span>
              <span className="truncate">{file?.name || 'Файл не выбран'}</span>
              <input
                type="file"
                aria-label="Выберите документ для загрузки"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
            <AppButton colorPrefix="w" disabled={!uploadStudentId || !file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>{uploadMutation.isPending ? 'Загружаем...' : 'Загрузить'}</AppButton>
          </div>
        </AppCard>
      )}

      <AppCard colorPrefix="w" className="mb-3 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs
            colorPrefix="w"
            value={reviewFilter}
            onChange={(value) => setReviewFilter(value as ReviewFilter)}
            tabs={[
              { value: 'unverified', label: `Нужна проверка · ${reviewCounts.unverified}` },
              { value: 'verified', label: `Проверены · ${reviewCounts.verified}` },
              { value: 'all', label: `Все · ${reviewCounts.all}` },
            ]}
          />

        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_240px_220px]">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" /><AppInput colorPrefix="w" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Документ или студент" className="bg-w-panel2 pl-9" /></div>
          <AppSelect colorPrefix="w" aria-label="Студент" value={studentId} onChange={(event) => setStudentId(event.target.value)} className="bg-w-panel2"><option value="">Все студенты</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</AppSelect>
          <AppSelect colorPrefix="w" aria-label="Источник" value={source} onChange={(event) => setSource(event.target.value)} className="bg-w-panel2"><option value="">Все источники</option><option value="telegram">Telegram</option><option value="internal">Внутренний чат</option><option value="manual_upload">Ручная загрузка</option><option value="whatsapp">WhatsApp</option></AppSelect>
        </div>
      </AppCard>
      {canManage && <DocumentWorkflowHelp />}

      {/* «Документов пока нет» на упавшем запросе отправляло искать файл, который на месте. */}
      <QueryState
        colorPrefix="w"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={groups.length === 0}
        empty={(
          <AppCard colorPrefix="w" className="p-5">
            <EmptyState
              colorPrefix="w"
              title={reviewFilter === 'unverified' && !hasFilters && documents.length > 0 ? 'Все документы проверены' : 'Документов нет'}
              description={hasFilters || reviewFilter !== 'all' ? 'Измените фильтры или откройте вкладку «Все».' : 'Загрузите файл кнопкой «Загрузить документ».'}
            />
          </AppCard>
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-w-muted">
          <span className="tabular-nums">{groups.length} {plural(groups.length, 'студент', 'студента', 'студентов')} · {visibleDocuments.length} {plural(visibleDocuments.length, 'файл', 'файла', 'файлов')}</span>
          {groups.length > 1 && (
            <button type="button" onClick={() => setToggled(Object.fromEntries(groups.map((group) => [group.studentId, !allOpen])))} className="font-bold text-w-ink hover:text-w-accentText">
              {allOpen ? 'Свернуть все' : 'Развернуть все'}
            </button>
          )}
        </div>
        <div className="space-y-3">
          {groups.map((group, index) => {
            const open = isOpen(group, index)
            return (
              <AppCard colorPrefix="w" key={group.studentId} className="p-0">
                <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5', open && 'border-b border-w-line')}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? 'Свернуть' : 'Развернуть'}: ${group.studentName}`}
                    onClick={() => setToggled((current) => ({ ...current, [group.studentId]: !open }))}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-w-muted transition-transform', !open && '-rotate-90')} aria-hidden />
                    <span className="truncate text-sm font-black text-w-ink">{group.studentName}</span>
                    <span className="shrink-0 rounded-pill bg-w-panel2 px-2 py-0.5 text-xs tabular-nums text-w-muted">
                      {group.items.length} {plural(group.items.length, 'файл', 'файла', 'файлов')}
                    </span>
                    {group.unverified > 0 && reviewFilter !== 'unverified' && (
                      <span className="shrink-0 rounded-pill bg-amber-500/15 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
                        {group.unverified} {plural(group.unverified, 'ждёт', 'ждут', 'ждут')} проверки
                      </span>
                    )}
                  </button>
                  <Link to={`/workspace/students/${group.studentId}#documents`} className="shrink-0 text-xs font-bold text-w-muted hover:text-w-accentText">
                    Карточка →
                  </Link>
                </div>
                {open && (
                  <div className="px-4 pt-3 sm:px-5">
                    <DocumentList
                      embedded
                      tone="w"
                      showTitle={false}
                      documents={group.items}
                      canManage={canManage}
                      sourceChatPath="/workspace/chat"
                      onOpen={(doc) => previewDocument(doc.id)}
                      onDownload={(doc) => downloadDocument(doc.id, documentName(doc))}
                      onChanged={() => invalidateDocuments(queryClient, group.studentId)}
                      onDelete={(doc) => documentsApi.delete(doc.id)}
                      onVisibility={(doc) => toggleVisibilityMutation.mutate(doc)}
                    />
                  </div>
                )}
              </AppCard>
            )
          })}
        </div>
      </QueryState>
    </div>
  )
}
