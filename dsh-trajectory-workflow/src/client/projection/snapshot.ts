import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'

const EMPTY_LIST: readonly never[] = []

/** Stable empty value used until the Trajectory projection has a snapshot. */
export const EMPTY_WORKFLOW_SNAPSHOT: TrajectorySnapshot = {
  eventNodes: EMPTY_LIST,
  eventLocations: new Map(),
  requests: EMPTY_LIST,
  callSchemas: new Map(),
  partial: null,
  runningCalls: EMPTY_LIST,
}
