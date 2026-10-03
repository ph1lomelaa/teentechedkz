import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccessRequestItem } from '@/api/accessRequests'
import { RequestRow, type RequestRowProps } from './RequestRow'

const item: AccessRequestItem = {
  id: 'r1',
  user: { id: 'u1', email: 'a@x.kz', name: 'А', is_active: false },
  requested_role: 'student',
  full_name: 'Тулегенова Алия',
  phone: '+7 701 000 00 05',
  city: null,
  direction: null,
  candidates: [
    {
      id: 'c1',
      full_name: 'Тулегенова Алия Мухтаровна',
      phone: '+77010000005',
      intake_year: 2026,
      reason: 'phone',
      reason_label: 'телефон',
      is_free: false,
      portal_owner: { user_id: 'u9', email: 'old@x.kz', last_login_at: null, is_active: true },
    },
  ],
  suggested_student: null,
  confidence: null,
  method: null,
  method_label: null,
  status: 'new',
  created_at: '2026-10-01T00:00:00Z',
}

const props = (over: Partial<RequestRowProps>): RequestRowProps => ({
  item,
  group: 'busy',
  canDecide: true,
  showCheckbox: false,
  checked: false,
  busy: false,
  onToggle: vi.fn(),
  onLink: vi.fn(),
  onReplace: vi.fn(),
  onApproveMentor: vi.fn(),
  onCreateStudent: vi.fn(),
  onReject: vi.fn(),
  onCloseLinked: vi.fn(),
  onPickOther: vi.fn(),
  ...over,
})

describe('права в строке заявки', () => {
  it('админ видит главную кнопку', () => {
    render(<ul><RequestRow {...props({})} /></ul>)
    expect(screen.getByRole('button', { name: /Заменить кабинет/ })).toBeTruthy()
  })
  it('менеджер: ни одной кнопки действия, причина названа, сравнение доступно', () => {
    render(<ul><RequestRow {...props({ canDecide: false })} /></ul>)
    expect(screen.queryByRole('button', { name: /Заменить кабинет/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Другие действия/ })).toBeNull()
    expect(screen.getByText('Только просмотр')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Показать сравнение/ })).toBeTruthy()
  })
  it('ошибка массового действия видна красной подписью', () => {
    render(<ul><RequestRow {...props({ error: 'Заявка не найдена или уже обработана' })} /></ul>)
    expect(screen.getByRole('alert').textContent).toContain('уже обработана')
  })
})
