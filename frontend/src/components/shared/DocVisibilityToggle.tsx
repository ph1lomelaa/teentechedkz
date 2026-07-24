import React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { useToast } from '@/hooks/use-toast'
import { documentsApi } from '@/api/documents'

/** Toggle whether a document is shared to the student's portal. */
export const DocVisibilityToggle: React.FC<{
  docId: string
  visible: boolean
  studentId: string
}> = ({ docId, visible, studentId }) => {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => documentsApi.setVisibility(docId, !visible),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] })
      toast({ title: visible ? 'Скрыто от студента' : 'Видно студенту' })
    },
    onError: () => toast({ title: 'Не удалось изменить', variant: 'destructive' }),
  })

  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 px-2.5 text-xs ${visible ? 'border-brand text-[#9a7d00]' : ''}`}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      title={visible ? 'Виден студенту в кабинете' : 'Скрыт от студента'}
    >
      {visible ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <EyeOff className="w-3.5 h-3.5 mr-1.5" />}
      {visible ? 'В кабинете' : 'Скрыт'}
    </Button>
  )
}
