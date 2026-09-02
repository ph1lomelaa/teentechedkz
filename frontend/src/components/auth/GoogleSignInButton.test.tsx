import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/api/auth'
import { GoogleSignInButton } from './GoogleSignInButton'

vi.mock('@/api/auth', () => ({
  authApi: { googleConfig: vi.fn() },
}))

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    vi.mocked(authApi.googleConfig).mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  it('keeps React content out of the container owned by Google Identity', () => {
    const { container } = render(
      <GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />,
    )

    const googleHolder = container.querySelector('.w-full.overflow-hidden.rounded-ctl')
    expect(googleHolder).toBeEmptyDOMElement()
    expect(googleHolder?.nextElementSibling).toHaveAttribute('aria-hidden', 'true')
  })
})