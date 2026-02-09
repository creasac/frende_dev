'use client'

import { useEffect } from 'react'
import { type CorrectionAnalysis } from '@/types/correction'

export default function CorrectionDetailsModal({
  open,
  onClose,
  analysis,
  originalText,
  feedbackLanguage,
}: {
  open: boolean
  onClose: () => void
  analysis: CorrectionAnalysis | null
  originalText: string
  feedbackLanguage?: string | null
}) {
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open])

  if (!open || !analysis) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Correction details"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Correction Details</h2>
            <p className="text-xs text-gray-500">
              Feedback language: {feedbackLanguage || 'en'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50"
            aria-label="Close correction details"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-900">
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Original</p>
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 whitespace-pre-wrap break-words">
              {originalText}
            </p>
          </section>

          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Corrected</p>
            <p className="rounded-lg border border-green-200 bg-green-50 p-3 whitespace-pre-wrap break-words">
              {analysis.correctedSentence}
            </p>
          </section>

          <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Score</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{analysis.overallScore}/100</p>
          </section>

          {analysis.issues.length > 0 && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Issues</p>
              <div className="space-y-2">
                {analysis.issues.map((issue, index) => (
                  <div key={`${issue.type}-${index}`} className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-600">
                      {issue.type} • {issue.position || 'unknown position'}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      <span className="font-medium">From:</span> {issue.original || '-'}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      <span className="font-medium">To:</span> {issue.correction || '-'}
                    </p>
                    {issue.explanation && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-gray-700">
                        {issue.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {analysis.wordSuggestions.length > 0 && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Word Suggestions</p>
              <div className="space-y-2">
                {analysis.wordSuggestions.map((suggestion, index) => (
                  <div key={`${suggestion.original}-${index}`} className="rounded-lg border border-gray-200 p-3">
                    <p className="font-medium">{suggestion.original || '-'}</p>
                    {suggestion.alternatives.length > 0 && (
                      <p className="mt-1 text-gray-700">{suggestion.alternatives.join(', ')}</p>
                    )}
                    {suggestion.reason && (
                      <p className="mt-1 text-gray-600">{suggestion.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(analysis.praise || analysis.tip) && (
            <section className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Praise</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-green-900">{analysis.praise || '-'}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Tip</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-blue-900">{analysis.tip || '-'}</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
