import { describe, expect, it } from 'vitest'
import type { RequestView } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkflowProjectionTurnModel } from '../src/client/projection/layout.ts'
import { deriveWorkflowModel } from '../src/client/workflow-model.ts'

function request(
  turn: number,
  step: number,
  status: 'running' | 'complete' | 'error',
): RequestView {
  return {
    purpose: 'assistant',
    startSeq: turn * 10 + step,
    turn,
    step,
    startedAt: turn * 10_000 + step * 1_000,
    completedAt: status === 'running' ? null : turn * 10_000 + step * 1_000 + 500,
    status,
    prompt: {
      config: { provider: 'test', model: 'deepseek-test' },
      system: 'Be precise.',
      tools: [],
    },
  } as unknown as RequestView
}

describe('deriveWorkflowModel', () => {
  it('groups model requests by user turn and numbers calls within each turn', () => {
    const turns: readonly WorkflowProjectionTurnModel[] = [
      {
        turn: 1,
        groups: [
          {
            title: 'Message',
            cells: [{ index: 1, kind: 'user', text: 'Inspect the workspace', opensTurn: true, timeSeconds: null }],
          },
          {
            title: 'Step 1',
            cells: [
              { index: 2, kind: 'message', text: 'I will inspect it.', timeSeconds: 0.5 },
              {
                index: 3, kind: 'tool', text: 'read', callId: 'read-1', timeSeconds: 0.2,
                outputDetail: 'file contents',
              },
            ],
          },
          {
            title: 'Step 2',
            cells: [{ index: 4, kind: 'message', text: 'Done.', timeSeconds: 0.5 }],
          },
        ],
      },
      {
        turn: 2,
        groups: [
          {
            title: 'Message',
            cells: [{ index: 5, kind: 'user', text: 'Run the checks', opensTurn: true, timeSeconds: null }],
          },
          {
            title: 'Step 1',
            cells: [{ index: 6, kind: 'tool', text: 'bash', callId: 'bash-1', timeSeconds: null }],
          },
        ],
      },
    ]
    const model = deriveWorkflowModel(
      turns,
      [request(1, 1, 'complete'), request(1, 2, 'complete'), request(2, 1, 'running')],
      new Map([
        [1, { startTime: 10_000, endTime: 14_000 }],
        [2, { startTime: 20_000 }],
      ]),
    )

    expect(model.turns.map(turn => ({
      turn: turn.turn,
      prompt: turn.prompt,
      promptPreview: turn.promptPreview,
      hasPrompt: turn.hasPrompt,
      numbers: turn.calls.map(call => call.number),
      status: turn.status,
    }))).toEqual([
      {
        turn: 1, prompt: 'Inspect the workspace', promptPreview: 'Inspect the workspac…', hasPrompt: true,
        numbers: [1, 2], status: 'complete',
      },
      {
        turn: 2, prompt: 'Run the checks', promptPreview: 'Run the checks', hasPrompt: true,
        numbers: [1], status: 'running',
      },
    ])
    expect(model.turns[0]?.durationMs).toBe(4_000)
    expect(model.requestCount).toBe(3)
    expect(model.toolCount).toBe(2)
  })

  it('truncates the turn prompt preview after twenty Unicode characters', () => {
    const prompt = '这是一个包含中文和 emoji 🚀 的长提示词，需要截断'
    const model = deriveWorkflowModel([{
      turn: 7,
      groups: [
        {
          title: 'Message',
          cells: [{ index: 1, kind: 'user', text: prompt, opensTurn: true, timeSeconds: null }],
        },
        {
          title: 'Step 1',
          cells: [{ index: 2, kind: 'message', text: 'Done.', timeSeconds: 0.1 }],
        },
      ],
    }], [request(7, 1, 'complete')])

    expect(Array.from(model.turns[0]?.promptPreview ?? '')).toHaveLength(21)
    expect(model.turns[0]?.promptPreview).toBe(`${Array.from(prompt).slice(0, 20).join('')}…`)
  })

  it('marks a prompt as unavailable when the loaded window starts inside a turn', () => {
    const model = deriveWorkflowModel([{
      turn: 8,
      groups: [{
        title: 'Step 1',
        cells: [{ index: 1, kind: 'message', text: 'Continuing.', timeSeconds: 0.1 }],
      }],
    }], [request(8, 1, 'complete')])

    expect(model.turns[0]).toMatchObject({
      turn: 8,
      prompt: 'Turn 8',
      promptPreview: 'Turn 8',
      hasPrompt: false,
    })
  })

  it('surfaces failed calls and treats settled tools without timing as complete', () => {
    const turns: readonly WorkflowProjectionTurnModel[] = [{
      turn: 3,
      groups: [{
        title: 'Step 1',
        cells: [
          { index: 1, kind: 'message', text: 'Failed', isError: true, timeSeconds: null },
          {
            index: 2, kind: 'tool', text: 'write', timeSeconds: null,
            resultPreviewMarkdown: 'written',
          },
        ],
      }],
    }]

    const failed = deriveWorkflowModel(turns, [request(3, 1, 'complete')])
    expect(failed.turns[0]?.status).toBe('error')

    const settled = deriveWorkflowModel([{
      turn: 4,
      groups: [{
        title: 'Step 1',
        cells: [{ index: 1, kind: 'tool', text: 'write', timeSeconds: null, result: 'written' }],
      }],
    }], [request(4, 1, 'complete')])
    expect(settled.turns[0]?.status).toBe('complete')
  })

  it('uses the latest completed call as the turn outcome after a recovered failure', () => {
    const turns: readonly WorkflowProjectionTurnModel[] = [{
      turn: 5,
      groups: [
        {
          title: 'Step 1',
          cells: [{ index: 1, kind: 'tool', text: 'bash', isError: true, timeSeconds: 0.2 }],
        },
        {
          title: 'Step 2',
          cells: [{ index: 2, kind: 'message', text: 'Recovered and completed.', timeSeconds: 0.3 }],
        },
      ],
    }]

    const recovered = deriveWorkflowModel(
      turns,
      [request(5, 1, 'complete'), request(5, 2, 'complete')],
    )

    expect(recovered.turns[0]?.calls.map(call => call.status)).toEqual(['error', 'complete'])
    expect(recovered.turns[0]?.status).toBe('complete')
  })

  it('reports total input separately from disjoint cache buckets', () => {
    const turns: readonly WorkflowProjectionTurnModel[] = [{
      turn: 6,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'message',
          text: 'Done.',
          timeSeconds: 0.25,
          input: 157,
          cacheRead: 8_000,
          cacheWrite: 200,
          output: 340,
        }],
      }],
    }]

    const model = deriveWorkflowModel(turns, [request(6, 1, 'complete')])

    expect(model.turns[0]?.calls[0]?.usage).toEqual({
      inputTotal: 8_357,
      inputUncached: 157,
      cacheRead: 8_000,
      cacheWrite: 200,
      output: 340,
    })
  })
})
