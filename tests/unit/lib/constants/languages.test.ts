import { describe, it, expect } from 'vitest'
import { getLanguageName, LANGUAGES } from '@/lib/constants/languages'

describe('languages', () => {
  it('returns matching language name', () => {
    expect(getLanguageName('en')).toBe('English')
    expect(getLanguageName('es')).toBe('Spanish')
  })

  it('returns code when missing from list', () => {
    expect(getLanguageName('xx')).toBe('xx')
  })

  it('handles null/undefined', () => {
    expect(getLanguageName(null)).toBeNull()
    expect(getLanguageName(undefined)).toBeNull()
  })

  it('LANGUAGES contains unique codes', () => {
    const codes = LANGUAGES.map((lang) => lang.code)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })
})
