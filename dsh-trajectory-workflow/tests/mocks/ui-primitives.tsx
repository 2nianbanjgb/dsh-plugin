import type { ReactNode } from 'react'

export function CodeBlock({ children }: { children?: ReactNode }) {
  return <pre>{children}</pre>
}

export function Modal({
  open, title, children,
}: {
  open: boolean
  title: string
  children?: ReactNode
}) {
  return open ? <div role="dialog" aria-label={title}>{children}</div> : null
}

export async function writeClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText === undefined) return false
  await navigator.clipboard.writeText(value)
  return true
}
