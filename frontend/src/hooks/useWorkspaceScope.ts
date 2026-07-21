import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { WorkspaceScopeParams } from '@/api/workspace'

export function useWorkspaceScope() {
  const [searchParams] = useSearchParams()
  const mentorId = searchParams.get('mentor_id') || null

  const params = useMemo<WorkspaceScopeParams>(
    () => (mentorId ? { mentor_id: mentorId } : { scope: 'mine' }),
    [mentorId],
  )

  return {
    mentorId,
    params,
    isPreview: Boolean(mentorId),
    isMineScope: !mentorId,
  }
}
