import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

type ErrorMeta = Record<string, string | number | boolean | undefined>

export function createRequestId(): string {
  return randomUUID()
}

function summarizeError(error: unknown): Record<string, string | number> {
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown }).status
    const summary: Record<string, string | number> = {
      errorName: error.name || 'Error',
    }
    if (typeof status === 'number') {
      summary.status = status
    }
    return summary
  }

  return {
    errorType: typeof error,
  }
}

export function logServerError(
  scope: string,
  requestId: string,
  error: unknown,
  meta?: ErrorMeta
) {
  console.error(`[${scope}] requestId=${requestId}`, {
    ...meta,
    ...summarizeError(error),
  })
}

export function internalServerError(message: string, requestId: string) {
  return NextResponse.json(
    {
      error: message,
      requestId,
    },
    { status: 500 }
  )
}
