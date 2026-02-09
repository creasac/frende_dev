import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: () => <div data-testid="mock-next-image" />,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: vi.fn() } }),
}))

import SignupPage from '@/app/signup/page'

describe('SignupPage', () => {
  it('renders form fields', () => {
    render(<SignupPage />)
    expect(screen.getByTestId('signup-form')).toBeInTheDocument()
    expect(screen.getByTestId('signup-display-name')).toBeInTheDocument()
    expect(screen.getByTestId('signup-username')).toBeInTheDocument()
    expect(screen.getByTestId('signup-language')).toBeInTheDocument()
    expect(screen.getByTestId('signup-email')).toBeInTheDocument()
    expect(screen.getByTestId('signup-password')).toBeInTheDocument()
    expect(screen.getByTestId('signup-submit')).toBeInTheDocument()
  })
})
