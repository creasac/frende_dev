import type { ReactNode } from 'react'
import PlaygroundClient from './PlaygroundClient'

export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlaygroundClient />
      <div className="hidden" aria-hidden="true">
        {children}
      </div>
    </>
  )
}
