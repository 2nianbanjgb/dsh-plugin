/** Browser plugin registering the visual Workflow conversation view. */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only imports load the current client Context and slot declarations.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { en, NS, zh } from './locales.ts'
import { WorkflowView, type WorkflowViewInjected } from './WorkflowView.tsx'

export { WorkflowJsonInspector } from './WorkflowJsonInspector.tsx'
export { WorkflowToolResult, WorkflowView } from './WorkflowView.tsx'
export type { WorkflowViewInjected } from './WorkflowView.tsx'
export { deriveWorkflowModel } from './workflow-model.ts'
export type {
  WorkflowCallModel, WorkflowCallUsage, WorkflowModel, WorkflowStatus,
  WorkflowTurnModel, WorkflowTurnTimings,
} from './workflow-model.ts'
export type { WorkflowKey } from './locales.ts'

/** Required services: the conversation slot, Session paging, trajectory projection, and localization. */
export const inject = ['slots', 'sessions', 'locale']

/** Register the independently installable Workflow view tab. */
export function apply(ctx: Context): void {
  // Published host and client packages both merge `ctx.sessions`; this plugin
  // consumes the client object layer supplied by api-session-controller.
  const sessions = ctx.sessions as unknown as ISessions
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow: dictionaries')
  const t = ctx.locale.bind(NS)
  const loadOlder = (sessionId: SessionId): (() => Promise<boolean>) => {
    const binding = sessions.binding(sessionId)
    const session = binding?.session
    if (binding === undefined || session === undefined) {
      throw new Error(`ui-workflow: session "${sessionId}" is unavailable`)
    }
    return async () => {
      const before = binding.eventSource.getSnapshot().revision
      await session.loadOlder()
      return binding.eventSource.getSnapshot().revision !== before
    }
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'workflow',
    order: 15,
    locale: NS,
    label: () => t('view.workflow'),
    inject: (sessionId: SessionId): WorkflowViewInjected => ({
      loadOlder: loadOlder(sessionId),
      eventWindow: () => {
        const binding = sessions.binding(sessionId)
        if (binding === undefined) {
          throw new Error(`ui-workflow: session "${sessionId}" is unavailable`)
        }
        return binding.eventSource.getSnapshot()
      },
    }),
  }, WorkflowView))
}
