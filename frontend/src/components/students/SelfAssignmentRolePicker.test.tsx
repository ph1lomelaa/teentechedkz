import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { User } from '@/types'
import { chooseAssignmentRole } from '@/lib/assignmentRolePicker'
import { SelfAssignmentRolePicker } from './SelfAssignmentRolePicker'

const user = (specialties: string[], role = 'mentor') => ({ id: 'me', role, mentor_specialties: specialties } as User)
describe('self assignment role choice', () => {
  it('uses the sole specialty instead of assigning UP', async () => {
    render(<SelfAssignmentRolePicker user={user(['career'])} />)
    expect(await chooseAssignmentRole()).toBe('career')
  })
  it.each([[[]], [['career', 'ielts']]])('asks instead of guessing for %j', async specialties => {
    render(<SelfAssignmentRolePicker user={user(specialties)} />)
    let result!: Promise<string>
    act(() => { result = chooseAssignmentRole() })
    expect(screen.getByText('В какой роли вы будете вести ученика?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Учитель IELTS'))
    expect(await result).toBe('ielts')
  })
  it('shares a single choice for bulk self-assignment', async () => {
    render(<SelfAssignmentRolePicker user={user([])} />)
    let first!: Promise<string>, second!: Promise<string>
    act(() => { first = chooseAssignmentRole(); second = chooseAssignmentRole() })
    expect(first).toBe(second)
    fireEvent.click(screen.getByText('Ментор по УП'))
    expect(await first).toBe('lead')
  })
})
