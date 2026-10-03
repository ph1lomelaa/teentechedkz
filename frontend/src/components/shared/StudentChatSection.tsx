import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/primitives/accordion'
import { useAuth } from '@/contexts/AuthContext'
import { chatApi } from '@/api/chat'
import { ChatThread } from '@/components/shared/ChatThread'

export const StudentChatSection: React.FC<{ studentId: string; hasPortalAccess?: boolean }> = ({ studentId, hasPortalAccess = true }) => {
  const { user } = useAuth()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['staff-conversation', studentId],
    queryFn: () => chatApi.staffConversation(studentId),
    enabled: hasPortalAccess,
    retry: false,
  })

  // A chat conversation requires a linked student portal account. Skip both
  // the impossible request and its global error toast for students without one.
  if (!hasPortalAccess) return null

  return (
    <AccordionItem value="chat" className="border border-gray-200 rounded-card px-4">
      <AccordionTrigger className="text-base font-semibold">
        <span className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-gray-500" />
          Чат со студентом
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <p className="text-sm text-gray-500 py-2">Загрузка…</p>
        ) : isError || !data ? (
          <p className="text-sm text-gray-400 py-2">
            Не удалось загрузить чат. Попробуйте обновить карточку.
          </p>
        ) : user ? (
          <div className="py-1">
            <ChatThread conversationId={data.id} currentUserId={user.id} heightClass="h-[380px]" />
          </div>
        ) : null}
      </AccordionContent>
    </AccordionItem>
  )
}
