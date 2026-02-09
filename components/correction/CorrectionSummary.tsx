'use client'

import { hasCorrectionIssues } from '@/lib/corrections/client'
import { type CorrectionAnalysis } from '@/types/correction'

export default function CorrectionSummary({
  analysis,
  originalText,
  align = 'right',
  onOpenDetails,
}: {
  analysis: CorrectionAnalysis
  originalText: string
  align?: 'left' | 'right'
  onOpenDetails?: () => void
}) {
  const hasIssues = hasCorrectionIssues(analysis, originalText)

  if (!hasIssues) {
    return (
      <div className={`mt-1 flex ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600"
          title="No corrections needed"
          aria-label="No corrections needed"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415 0l-3-3a1 1 0 011.415-1.42l2.293 2.295 6.543-6.545a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>
    )
  }

  return (
    <div className={`mt-1 flex items-start gap-2 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-xs rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Corrected</p>
        <p className="text-sm text-green-900 break-words whitespace-pre-wrap">{analysis.correctedSentence}</p>
      </div>
      {onOpenDetails && (
        <button
          type="button"
          onClick={onOpenDetails}
          className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
          title="Open correction explanation"
          aria-label="Open correction explanation"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  )
}
