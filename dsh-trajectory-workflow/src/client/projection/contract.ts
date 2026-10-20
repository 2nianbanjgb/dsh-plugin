import type { RequestView } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Message } from '@deepseek-ai/dsh-llm/types'

/** Assistant request enriched with its model-visible Session surface. */
export type WorkflowAssistantRequest = Extract<RequestView, { purpose: 'assistant' }> & {
  /** Complete provider-neutral messages array reconstructed at dispatch. */
  readonly messages?: readonly Message[]
}

/** Provider request consumed by the Workflow presentation. */
export type WorkflowRequestView =
  | WorkflowAssistantRequest
  | Extract<RequestView, { purpose: 'compaction' }>
