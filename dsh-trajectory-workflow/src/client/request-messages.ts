/** Reconstruct the provider-neutral message surface at each model-request boundary. */

import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Message } from '@deepseek-ai/dsh-llm/types'
import {
  deriveEventMessage, isAppendSurfaceEvent, isReplacementSurfaceEvent,
} from '@deepseek-ai/dsh-session/surface'
import type { WorkflowRequestView } from './projection/contract.ts'

interface SurfaceEntry {
  readonly seq: number
  readonly message: Message | null
}

interface SurfaceRecord extends SurfaceEntry {
  readonly operation:
    | { readonly kind: 'append' }
    | { readonly kind: 'replace'; readonly start: number; readonly end: number }
}

function applySurfaceRecord(entries: SurfaceEntry[], record: SurfaceRecord): void {
  const next = { seq: record.seq, message: record.message }
  if (record.operation.kind === 'append') {
    entries.push(next)
    return
  }
  const operation = record.operation
  const start = entries.findIndex(entry => entry.seq === operation.start)
  const end = entries.findIndex(entry => entry.seq === operation.end)
  if (start === -1 || end === -1 || start > end) {
    // A tail window can initially contain a replacement whose source range has
    // not loaded yet. Keep the replacement alone until older paging completes.
    entries.splice(0, entries.length, next)
    return
  }
  entries.splice(start, end - start + 1, next)
}

function surfaceRecords(window: SessionEventWindow): readonly SurfaceRecord[] {
  return window.entries.flatMap((entry): readonly SurfaceRecord[] => {
    if (entry.type !== 'event') return []
    const event = entry.event
    if (!isAppendSurfaceEvent(event) && !isReplacementSurfaceEvent(event)) return []
    return [{
      seq: event.seq,
      message: deriveEventMessage(event),
      operation: event.surfaceOp === 'append'
        ? { kind: 'append' }
        : {
          kind: 'replace',
          start: event.surfaceOp.startSeq,
          end: event.surfaceOp.endSeq,
        },
    }]
  })
}

function requestBoundary(
  request: Extract<WorkflowRequestView, { purpose: 'assistant' }>,
  window: SessionEventWindow,
): number {
  if (request.resultSeq !== undefined) return request.resultSeq
  const end = window.entries.find((entry) => entry.type === 'event'
    && entry.event.seq > request.startSeq
    && entry.event.type === 'step/end'
    && entry.event.data.turn === request.turn
    && entry.event.data.step === request.step)
  return end?.event.seq ?? Number.POSITIVE_INFINITY
}

/**
 * Attach the exact loaded Session surface that preceded each assistant request.
 * @param requests - Request lifecycles from the current Trajectory snapshot.
 * @param window - Current contiguous Session event window.
 * @returns Requests in their original order, with assistant messages attached.
 */
export function attachRequestMessages(
  requests: readonly WorkflowRequestView[],
  window: SessionEventWindow,
): readonly WorkflowRequestView[] {
  const records = surfaceRecords(window)
  const ordered = requests.flatMap((request, index) => request.purpose === 'assistant'
    ? [{ index, request, boundary: requestBoundary(request, window) }]
    : [])
    .sort((left, right) => left.boundary - right.boundary || left.index - right.index)
  const messages = new Map<number, readonly Message[]>()
  const surface: SurfaceEntry[] = []
  let recordIndex = 0
  for (const entry of ordered) {
    while ((records[recordIndex]?.seq ?? Number.POSITIVE_INFINITY) < entry.boundary) {
      applySurfaceRecord(surface, records[recordIndex] as SurfaceRecord)
      recordIndex += 1
    }
    messages.set(
      entry.index,
      surface.flatMap(record => record.message === null ? [] : [record.message]),
    )
  }
  return requests.map((request, index) => request.purpose === 'assistant'
    ? { ...request, messages: messages.get(index) ?? [] }
    : request)
}
