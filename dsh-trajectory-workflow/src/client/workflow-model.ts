/** Turn and model-call projection for the visual Workflow view. */

import type { Message } from '@deepseek-ai/dsh-llm/types'
import type {
  WorkflowCellProps,
} from './projection/record.ts'
import type { WorkflowAssistantRequest, WorkflowRequestView } from './projection/contract.ts'
import type { WorkflowProjectionTurnModel } from './projection/layout.ts'

type AssistantRequest = WorkflowAssistantRequest

/** Lifecycle shown by a workflow turn or model call. */
export type WorkflowStatus = 'waiting' | 'running' | 'complete' | 'error'

/** Provider-reported token buckets normalized for one Workflow model call. */
export interface WorkflowCallUsage {
  readonly inputTotal: number | undefined
  readonly inputUncached: number | undefined
  readonly cacheRead: number | undefined
  readonly cacheWrite: number | undefined
  readonly output: number | undefined
}

/** One model request and its response/tool activity. */
export interface WorkflowCallModel {
  readonly id: string
  readonly turn: number
  readonly step: number
  readonly number: number
  readonly request: AssistantRequest | undefined
  /** Complete provider-neutral message history sent with this request. */
  readonly messages: readonly Message[]
  readonly inputs: readonly WorkflowCellProps[]
  readonly response: WorkflowCellProps | undefined
  readonly tools: readonly WorkflowCellProps[]
  readonly usage: WorkflowCallUsage | undefined
  readonly status: WorkflowStatus
  readonly startedAt: number | null
  readonly durationMs: number | null
}

/** One user-initiated turn and every model request inside it. */
export interface WorkflowTurnModel {
  readonly turn: number
  readonly prompt: string
  readonly promptPreview: string
  /** Whether the loaded history window contains the user message that opened this turn. */
  readonly hasPrompt: boolean
  readonly startedAt: number | null
  readonly durationMs: number | null
  readonly calls: readonly WorkflowCallModel[]
  readonly toolCount: number
  readonly status: WorkflowStatus
}

/** Complete workflow summary for the current loaded history window. */
export interface WorkflowModel {
  readonly turns: readonly WorkflowTurnModel[]
  readonly requestCount: number
  readonly toolCount: number
  readonly durationMs: number | null
}

/** Timing boundaries already projected by the Session object layer. */
export type WorkflowTurnTimings = ReadonlyMap<
  number,
  { readonly startTime: number; readonly endTime?: number }
>

function stepNumber(title: string): number | null {
  const match = /^Step (\d+)$/.exec(title)
  return match === null ? null : Number(match[1])
}

function preview(cell: WorkflowCellProps | undefined): string {
  if (cell === undefined) return ''
  return (cell.previewMarkdown ?? cell.text).replace(/\s+/g, ' ').trim()
}

function truncatePrompt(value: string): string {
  const characters = Array.from(value)
  return characters.length > 20 ? `${characters.slice(0, 20).join('')}…` : value
}

function callUsage(response: WorkflowCellProps | undefined): WorkflowCallUsage | undefined {
  if (response === undefined) return undefined
  const hasInput = response.input !== undefined
    || response.cacheRead !== undefined
    || response.cacheWrite !== undefined
  if (!hasInput && response.output === undefined) return undefined
  return {
    inputTotal: hasInput
      ? (response.input ?? 0) + (response.cacheRead ?? 0) + (response.cacheWrite ?? 0)
      : undefined,
    inputUncached: response.input,
    cacheRead: response.cacheRead,
    cacheWrite: response.cacheWrite,
    output: response.output,
  }
}

function callStatus(
  request: AssistantRequest | undefined,
  response: WorkflowCellProps | undefined,
  tools: readonly WorkflowCellProps[],
): WorkflowStatus {
  if (request?.status === 'error' || response?.isError === true || tools.some(tool => tool.isError === true)) {
    return 'error'
  }
  if (request?.status === 'running'
    || tools.some(tool => tool.timeSeconds === null
      && tool.outputDetail === undefined
      && tool.result === undefined
      && tool.resultPreviewMarkdown === undefined)) {
    return 'running'
  }
  if (request?.status === 'complete' || response !== undefined || tools.length > 0) return 'complete'
  return 'waiting'
}

function callDuration(
  request: AssistantRequest | undefined,
  cells: readonly WorkflowCellProps[],
): number | null {
  if (request !== undefined && request.completedAt !== null) {
    return Math.max(0, request.completedAt - request.startedAt)
  }
  const durations = cells
    .map(cell => cell.timeSeconds)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  return durations.length === 0 ? null : Math.max(...durations) * 1_000
}

function turnStatus(calls: readonly WorkflowCallModel[]): WorkflowStatus {
  if (calls.some(call => call.status === 'running')) return 'running'
  return calls.at(-1)?.status ?? 'waiting'
}

function turnDuration(
  turn: number,
  calls: readonly WorkflowCallModel[],
  timings: WorkflowTurnTimings,
): number | null {
  const timing = timings.get(turn)
  if (timing?.endTime !== undefined) return Math.max(0, timing.endTime - timing.startTime)
  const starts = calls
    .map(call => call.startedAt)
    .filter((value): value is number => value !== null)
  const ends = calls.flatMap(call => call.startedAt === null || call.durationMs === null
    ? []
    : [call.startedAt + call.durationMs])
  if (starts.length === 0 || ends.length === 0) return null
  return Math.max(0, Math.max(...ends) - Math.min(...starts))
}

/**
 * Fold the Trajectory layout into a user-turn index and model-call rows.
 * @param turns - Existing replay-safe Trajectory turn layout.
 * @param requests - Provider request lifecycles from the same projection.
 * @param timings - Session-owned turn timing boundaries.
 * @returns Visual workflow model ordered by user turn and step.
 */
export function deriveWorkflowModel(
  turns: readonly WorkflowProjectionTurnModel[],
  requests: readonly WorkflowRequestView[],
  timings: WorkflowTurnTimings = new Map(),
): WorkflowModel {
  const assistantRequests = requests.filter(
    (request): request is AssistantRequest => request.purpose === 'assistant',
  )
  const requestsByStep = new Map(
    assistantRequests.map(request => [`${request.turn}:${request.step}`, request] as const),
  )
  const workflowTurns = turns.flatMap((entry): WorkflowTurnModel[] => {
    if (entry.turn === null) return []
    const turn = entry.turn
    const prologue = entry.groups
      .filter(group => group.title === 'Message')
      .flatMap(group => group.cells)
    const opening = prologue.find(cell => cell.kind === 'user' && cell.opensTurn === true)
      ?? prologue.find(cell => cell.kind === 'user')
    const callGroups = entry.groups.flatMap(group => stepNumber(group.title) === null ? [] : [group])
    const calls = callGroups.flatMap((group, index): WorkflowCallModel[] => {
      const step = stepNumber(group.title)
      if (step === null) return []
      const request = requestsByStep.get(`${turn}:${step}`)
      const response = group.cells.find(cell => cell.kind === 'message' && cell.requestOnly !== true)
      const tools = group.cells.filter(cell => cell.kind === 'tool' || cell.kind === 'subtool')
      const inputs = [
        ...(step === 1 ? prologue.filter(cell => cell.kind === 'user' || cell.kind === 'context') : []),
        ...group.cells.filter(cell => cell.kind === 'user' || cell.kind === 'context' || cell.kind === 'system'),
      ]
      if (request === undefined && response === undefined && tools.length === 0) return []
      const cells = [...inputs, ...(response === undefined ? [] : [response]), ...tools]
      return [{
        id: `${turn}:${step}`,
        turn,
        step,
        number: index + 1,
        request,
        messages: request?.messages ?? [],
        inputs,
        response,
        tools,
        usage: callUsage(response),
        status: callStatus(request, response, tools),
        startedAt: request?.startedAt ?? response?.startedAt ?? null,
        durationMs: callDuration(request, cells),
      }]
    })
    const timing = timings.get(turn)
    const openingPrompt = preview(opening)
    const prompt = openingPrompt || `Turn ${turn}`
    return [{
      turn,
      prompt,
      promptPreview: truncatePrompt(prompt),
      hasPrompt: openingPrompt !== '',
      startedAt: timing?.startTime ?? opening?.startedAt ?? calls[0]?.startedAt ?? null,
      durationMs: turnDuration(turn, calls, timings),
      calls,
      toolCount: calls.reduce((total, call) => total + call.tools.length, 0),
      status: turnStatus(calls),
    }]
  })
  const starts = workflowTurns
    .map(turn => turn.startedAt)
    .filter((value): value is number => value !== null)
  const ends = workflowTurns.flatMap(turn => turn.startedAt === null || turn.durationMs === null
    ? []
    : [turn.startedAt + turn.durationMs])
  return {
    turns: workflowTurns,
    requestCount: workflowTurns.reduce((total, turn) => total + turn.calls.length, 0),
    toolCount: workflowTurns.reduce((total, turn) => total + turn.toolCount, 0),
    durationMs: starts.length === 0 || ends.length === 0
      ? null
      : Math.max(0, Math.max(...ends) - Math.min(...starts)),
  }
}
