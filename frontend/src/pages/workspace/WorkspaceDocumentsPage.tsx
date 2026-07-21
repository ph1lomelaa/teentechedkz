import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Eye, EyeOff, FileText, Search, Upload } from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { workspaceApi } from '@/api/workspace'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { DOC_TYPE_LABELS, DocType } from '@/types'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useLocalState } from '@/lib/use-local-state'
import {
  WorkspaceButton,
  WorkspaceCard,
  WorkspaceEmptyState,
  WorkspaceInput,
  WorkspacePageHeader,
  WorkspaceSelect,
  WorkspaceStatusPill,
} from '@/components/workspace/ui'

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  manual_upload: 'Ручная загрузка',
  whatsapp: 'WhatsApp',
}

export const WorkspaceDocumentsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const { params } = useWorkspaceScope()
  const [uploadStudentId, setUploadStudentId] = useState('')
  const [studentId, setStudentId] = useLocalState('workspace:documents:studentFilter', '')
  const [source, setSource] = useLocalState('workspace:documents:sourceFilter', '')
  const [search, setSearch] = useLocalState('workspace:documents:search', '')
  const [docType, setDocType] = useState<DocType>('other')
  const [file, setFile] = useState<File | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workspace', 'documents', params],
    queryFn: () => workspaceApi.documents(params),
  })

  const documents = useMemo(() => data?.items ?? [], [data?.items])
  const { data: studentsData } = useQuery({
    queryKey: ['workspace', 'documents', 'students', params],
    queryFn: () => workspaceApi.students(params),
  })
  const students = (studentsData?.items ?? []).map((item) => item.student)
  const visibleDocuments = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter((doc) =>
      (!studentId || doc.student_id === studentId)
      && (!source
        || (source === 'internal' && doc.source_message?.channel === 'internal')
        || (source === 'manual_upload' && doc.source === 'manual_upload' && !doc.source_message)
        || (!['internal', 'manual_upload'].includes(source) && doc.source === source))
      && (!q || doc.file_name.toLowerCase().includes(q) || doc.student_name.toLowerCase().includes(q)),
    )
  }, [documents, search, source, studentId])

  const toggleVisibilityMutation = useMutation({
    mutationFn: (doc: { id: string; visible_to_student?: boolean }) =>
      documentsApi.setVisibility(doc.id, !doc.visible_to_student),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student'] })
      toast({ title: 'Видимость документа обновлена' })
    },
    onError: () => toast({ title: 'Не удалось изменить видимость', variant: 'destructive' }),
  })
  const updateTypeMutation = useMutation({
    mutationFn: ({ id, docType: nextType }: { id: string; docType: DocType }) =>
      documentsApi.setType(id, nextType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student'] })
      toast({ title: 'Тип документа обновлён' })
    },
    onError: () => toast({ title: 'Не удалось изменить тип', variant: 'destructive' }),
  })
  const uploadMutation = useMutation({
    mutationFn: () => documentsApi.upload(uploadStudentId, file!, docType),
    onSuccess: () => {
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['workspace', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student'] })
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
      <WorkspacePageHeader
        eyebrow="Кабинет ментора"
        title="Документы"
        description="Все документы студентов из кабинета, Telegram, сообщений и ручных загрузок."
      />

      <WorkspaceCard className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-w-ink"><Upload className="h-4 w-4 text-w-accentText" />Загрузить документ</div>
        <div className="grid gap-2 lg:grid-cols-[240px_210px_1fr_auto]">
          <WorkspaceSelect value={uploadStudentId} onChange={(event) => setUploadStudentId(event.target.value)} className="bg-w-panel2">
            <option value="">Выберите студента</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
          </WorkspaceSelect>
          <WorkspaceSelect value={docType} onChange={(event) => setDocType(event.target.value as DocType)} className="bg-w-panel2">
            {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </WorkspaceSelect>
          <input type="file" aria-label="Выберите документ для загрузки" onChange={(event) => setFile(event.target.files?.[0] || null)} className="min-h-10 rounded-[11px] border border-w-line bg-w-panel2 px-3 py-2 text-xs text-w-muted file:mr-3 file:rounded-[8px] file:border-0 file:bg-w-accent file:px-3 file:py-1 file:font-bold file:text-black" />
          <WorkspaceButton disabled={!uploadStudentId || !file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>{uploadMutation.isPending ? 'Загружаем...' : 'Загрузить'}</WorkspaceButton>
        </div>
      </WorkspaceCard>

      <WorkspaceCard className="mb-5 grid gap-2 p-3 md:grid-cols-[1fr_240px_220px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-w-muted2" /><WorkspaceInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск документа" className="bg-w-panel2 pl-9" /></div>
        <WorkspaceSelect value={studentId} onChange={(event) => setStudentId(event.target.value)} className="bg-w-panel2"><option value="">Все студенты</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</WorkspaceSelect>
        <WorkspaceSelect value={source} onChange={(event) => setSource(event.target.value)} className="bg-w-panel2"><option value="">Все источники</option><option value="telegram">Telegram</option><option value="internal">Внутренний чат</option><option value="manual_upload">Ручная загрузка</option><option value="whatsapp">WhatsApp</option></WorkspaceSelect>
      </WorkspaceCard>

      <WorkspaceCard className="p-5">
        {isLoading ? (
          <p className="text-sm text-w-muted">Загрузка документов...</p>
        ) : visibleDocuments.length === 0 ? (
          <WorkspaceEmptyState title="Документов пока нет" text="Загрузите файл или измените выбранные фильтры." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleDocuments.map((doc) => (
              <article key={doc.id} className="rounded-[18px] border border-w-line bg-w-panel2 p-4">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-w-accentText" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-w-ink">{doc.file_name}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <WorkspaceStatusPill>
                        <Link to={`/workspace/students/${doc.student_id}#documents`} className="hover:underline">
                          {doc.student_name}
                        </Link>
                      </WorkspaceStatusPill>
                      <WorkspaceStatusPill>
                        {doc.source_message?.channel === 'internal'
                          ? 'Внутренний чат'
                          : SOURCE_LABELS[doc.source] || doc.source}
                      </WorkspaceStatusPill>
                      <WorkspaceStatusPill>{formatDate(doc.uploaded_at)}</WorkspaceStatusPill>
                      {!doc.is_verified && <WorkspaceStatusPill tone="accent">на проверке</WorkspaceStatusPill>}
                    </div>
                    <div className="mt-3 max-w-[230px]">
                      <WorkspaceSelect
                        value={doc.doc_type}
                        disabled={updateTypeMutation.isPending && updateTypeMutation.variables?.id === doc.id}
                        onChange={(event) => updateTypeMutation.mutate({ id: doc.id, docType: event.target.value as DocType })}
                        className="h-9 bg-w-panel"
                        aria-label={`Тип документа ${doc.file_name}`}
                      >
                        {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </WorkspaceSelect>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(doc.mime_type === 'application/pdf' || doc.mime_type.startsWith('image/')) && (
                        <WorkspaceButton size="sm" variant="ghost" onClick={() => previewDocument(doc.id)}><Eye className="h-3.5 w-3.5" />Просмотр</WorkspaceButton>
                      )}
                      <WorkspaceButton size="sm" variant="ghost" onClick={() => downloadDocument(doc.id, doc.file_name)}><Download className="h-3.5 w-3.5" />Скачать</WorkspaceButton>
                      <WorkspaceButton size="sm" variant="ghost" disabled={toggleVisibilityMutation.variables?.id === doc.id} onClick={() => toggleVisibilityMutation.mutate(doc)}>
                        {doc.visible_to_student ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {doc.visible_to_student ? 'Виден студенту' : 'Только staff'}
                      </WorkspaceButton>
                      {doc.source_message && (
                        <Link
                          to={`/workspace/chat?channel=all&student_id=${doc.student_id}&message_id=${doc.source_message.message_id}`}
                          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-[11px] border border-w-line px-3 py-1.5 text-[11.5px] font-black text-w-muted transition hover:border-w-accentDim hover:text-w-accentText"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />Исходное сообщение
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </WorkspaceCard>
    </div>
  )
}
