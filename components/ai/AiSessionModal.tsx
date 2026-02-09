'use client'

import { useState } from 'react'
import { LANGUAGES } from '@/lib/constants/languages'

export type AiSessionFormValues = {
  name: string
  responseLanguage: string
  responseLevel: '' | 'beginner' | 'intermediate' | 'advanced'
  systemPrompt: string
}

export default function AiSessionModal({
  mode,
  initialValues,
  saving,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit'
  initialValues: AiSessionFormValues
  saving?: boolean
  onSave: (values: AiSessionFormValues) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<AiSessionFormValues>(initialValues)

  function handleChange<K extends keyof AiSessionFormValues>(key: K, value: AiSessionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{mode === 'create' ? 'New AI Chat' : 'Edit AI Chat'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={values.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="AI 2025-01-31"
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Response Language</label>
            <select
              value={values.responseLanguage}
              onChange={(e) => handleChange('responseLanguage', e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">No preference</option>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Response Level</label>
            <select
              value={values.responseLevel}
              onChange={(e) => handleChange('responseLevel', e.target.value as AiSessionFormValues['responseLevel'])}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">No preference</option>
              <option value="beginner">Beginner (A1-A2)</option>
              <option value="intermediate">Intermediate (B1-B2)</option>
              <option value="advanced">Advanced (C1-C2)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
            <textarea
              value={values.systemPrompt}
              onChange={(e) => handleChange('systemPrompt', e.target.value)}
              placeholder="Optional instructions for the AI..."
              className="min-h-[120px] w-full rounded border border-gray-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional. This is merged with language and level instructions when set.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(values)}
            disabled={saving}
            className="rounded-lg bg-azure px-4 py-2 text-white hover:bg-azure/90 disabled:opacity-60"
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Create Chat' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
