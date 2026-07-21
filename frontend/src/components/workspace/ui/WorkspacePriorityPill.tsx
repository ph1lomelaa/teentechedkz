import { WorkspaceStatusPill } from './WorkspaceStatusPill'

export function WorkspacePriorityPill({ priority }: { priority?: string | null }) {
  const normalized = priority || 'normal'
  if (['high', 'urgent', 'critical'].includes(normalized)) {
    return <WorkspaceStatusPill tone="danger">Высокий</WorkspaceStatusPill>
  }
  if (['medium', 'normal'].includes(normalized)) {
    return <WorkspaceStatusPill tone="accent">Средний</WorkspaceStatusPill>
  }
  return <WorkspaceStatusPill>Низкий</WorkspaceStatusPill>
}
