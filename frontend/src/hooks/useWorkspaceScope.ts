import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { WorkspaceScopeParams } from '@/api/workspace'

export function useWorkspaceScope() {
  const { user } = useAuth()
  const canSupervise = ['admin', 'mzk_manager', 'academic_head'].includes(user?.role || '')
  const [searchParams] = useSearchParams()
  const mentorId = searchParams.get('mentor_id') || null

  const scope = canSupervise && searchParams.get('scope') !== 'mine' ? 'all' : 'mine'

  const params = useMemo<WorkspaceScopeParams>(
    () => (mentorId ? { mentor_id: mentorId } : { scope }),
    [mentorId, scope],
  )

  return {
    mentorId,
    params,
    isPreview: Boolean(mentorId),
    isMineScope: !mentorId && scope === 'mine',
  }
}
