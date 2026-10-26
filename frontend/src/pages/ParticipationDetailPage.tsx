import { useParams } from 'react-router-dom'
import { ParticipationPath } from '@/components/activities/ParticipationPath'

export function ParticipationDetailPage() {
  const { participationId = '' } = useParams()
  return <ParticipationPath participationId={participationId} />
}
