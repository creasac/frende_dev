import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import MarkdownMessage from '@/components/ai/MarkdownMessage'

describe('MarkdownMessage link sanitization', () => {
  it('renders https links', () => {
    render(<MarkdownMessage content="[Docs](https://example.com/docs)" />)
    const link = screen.getByRole('link', { name: 'Docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
  })

  it('renders mailto links', () => {
    render(<MarkdownMessage content="[Email](mailto:test@example.com)" />)
    const link = screen.getByRole('link', { name: 'Email' })
    expect(link).toHaveAttribute('href', 'mailto:test@example.com')
  })

  it('blocks javascript scheme links', () => {
    render(<MarkdownMessage content="[Click me](javascript:evil)" />)
    expect(screen.queryByRole('link', { name: 'Click me' })).not.toBeInTheDocument()
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('blocks non-allowlisted schemes', () => {
    render(<MarkdownMessage content="[Inline](data:text/html;base64,abcd)" />)
    expect(screen.queryByRole('link', { name: 'Inline' })).not.toBeInTheDocument()
    expect(screen.getByText('Inline')).toBeInTheDocument()
  })

  it('blocks relative links without an allowlisted scheme', () => {
    render(<MarkdownMessage content="[Internal](/dashboard)" />)
    expect(screen.queryByRole('link', { name: 'Internal' })).not.toBeInTheDocument()
    expect(screen.getByText('Internal')).toBeInTheDocument()
  })
})
