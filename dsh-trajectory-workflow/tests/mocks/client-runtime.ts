export function contextForm(): string {
  return 'context'
}

export function contextProvenance(): null {
  return null
}

export function displayFailureMessage(value: unknown): string {
  return String(value)
}

export function emptyAssistantBlock(): Record<string, never> {
  return {}
}

export function isTokenDelta(): boolean {
  return false
}

export function toAssistantBlock(value: unknown): unknown {
  return value
}

export function toAssistantBlocks(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}
