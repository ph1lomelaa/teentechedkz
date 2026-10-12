import { useEffect, useRef, useState } from 'react'
import type { User } from '@/types'
import { ASSIGNABLE_MENTOR_ROLES, MENTOR_ROLE_LABELS } from '@/types'
import { setAssignmentRolePicker } from '@/lib/assignmentRolePicker'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { Button } from '@/components/ui/primitives/button'

export function SelfAssignmentRolePicker({ user }: { user: User | null }) {
  const [open, setOpen] = useState(false)
  const pending = useRef<{ promise: Promise<string>; resolve: (role: string) => void; reject: (error: Error) => void } | null>(null)
  useEffect(() => {
    setAssignmentRolePicker(() => {
      if (!user) return Promise.reject(new Error('Войдите в систему'))
      const roles = [...new Set((user.mentor_specialties ?? []).filter(role => (ASSIGNABLE_MENTOR_ROLES as readonly string[]).includes(role)))]
      if (roles.length === 1) return Promise.resolve(roles[0])
      if (roles.length === 0 && user.role === 'mzk_manager') return Promise.resolve('mzk')
      if (pending.current) return pending.current.promise
      let resolve!: (role: string) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      pending.current = { promise, resolve, reject }
      setOpen(true)
      return promise
    })
    return () => {
      setAssignmentRolePicker(null)
      pending.current?.reject(new Error('Выбор роли отменён'))
      pending.current = null
    }
  }, [user])
  const finish = (role?: string) => {
    if (role) pending.current?.resolve(role)
    else pending.current?.reject(new Error('Назначение отменено'))
    pending.current = null
    setOpen(false)
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) finish() }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>В какой роли вы будете вести ученика?</DialogTitle>
        <DialogDescription>Выберите свою роль в команде ученика.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">{ASSIGNABLE_MENTOR_ROLES.map(role =>
        <Button key={role} variant="outline" onClick={() => finish(role)}>{MENTOR_ROLE_LABELS[role]}</Button>
      )}</div>
    </DialogContent>
  </Dialog>
}
