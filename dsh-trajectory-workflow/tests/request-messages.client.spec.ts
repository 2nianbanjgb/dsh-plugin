import { describe, expect, it } from 'vitest'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Message } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { attachRequestMessages } from '../src/client/request-messages.ts'
import type { WorkflowRequestView } from '../src/client/projection/contract.ts'

function message(id: string, role: 'system' | 'developer' | 'user' | 'assistant', text: string): Message {
  return {
    id: id as Message['id'],
    role,
    content: [{ type: 'text', text }],
    source: role === 'assistant'
      ? { kind: 'model', provider: 'test', model: 'test' }
      : role === 'system' ? { kind: 'system-prompt' } : { kind: 'user' },
  } as Message
}

function event(
  seq: number,
  type: string,
  data: unknown,
  surfaceOp?: SessionEvent['surfaceOp'],
): SessionEvent {
  return {
    type, seq, time: seq, data,
    ...(surfaceOp === undefined ? {} : { surfaceOp }),
  } as SessionEvent
}

function window(events: readonly SessionEvent[]): SessionEventWindow {
  const entries = events.map(item => ({ type: 'event' as const, event: item }))
  return {
    entries,
    hasMore: false,
    revision: 1,
    change: { kind: 'replace', entries },
  }
}

function request(
  turn: number,
  step: number,
  startSeq: number,
  resultSeq?: number,
): WorkflowRequestView {
  return {
    purpose: 'assistant', turn, step, startSeq,
    startedAt: startSeq,
    completedAt: resultSeq ?? null,
    status: resultSeq === undefined ? 'error' : 'complete',
    ...(resultSeq === undefined ? {} : { resultSeq }),
  }
}

describe('attachRequestMessages', () => {
  it('reconstructs the growing surface before each completed response', () => {
    const system = message('system', 'system', 'system')
    const user = message('user', 'user', 'question')
    const assistant = message('assistant', 'assistant', 'calling tool')
    const tool = message('tool', 'user', 'tool result')
    const events = [
      event(0, 'system/message', { turn: 0, step: 0, message: system }, 'append'),
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'user/message', user, 'append'),
      event(4, 'request/header', { header: {}, reason: 'initial' }),
      event(5, 'assistant/message', { turn: 1, step: 1, message: assistant, stream: [] }, 'append'),
      event(6, 'tool/result', { turn: 1, step: 1, message: tool }, 'append'),
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'step/start', { turn: 1, step: 2 }),
      event(9, 'request/header', { header: {}, reason: 'series' }),
      event(10, 'assistant/message', { turn: 1, step: 2, message: assistant, stream: [] }, 'append'),
    ]
    const attached = attachRequestMessages([
      request(1, 1, 2, 5),
      request(1, 2, 8, 10),
    ], window(events))

    expect(attached[0]?.purpose === 'assistant' && attached[0].messages?.map(item => item.id))
      .toEqual(['system', 'user'])
    expect(attached[1]?.purpose === 'assistant' && attached[1].messages?.map(item => item.id))
      .toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('applies surface replacements before the next request', () => {
    const system = message('system', 'system', 'system')
    const user = message('user', 'user', 'question')
    const summary = message('summary', 'user', 'summary')
    const response = message('response', 'assistant', 'done')
    const events = [
      event(0, 'system/message', { turn: 0, step: 0, message: system }, 'append'),
      event(1, 'user/message', user, 'append'),
      event(2, 'assistant/message', { turn: 1, step: 1, message: response, stream: [] }, 'append'),
      event(3, 'user/message', summary, {
        op: 'replace', startSeq: 1, endSeq: 2,
      } as SessionEvent['surfaceOp']),
      event(4, 'step/start', { turn: 2, step: 1 }),
      event(5, 'assistant/message', { turn: 2, step: 1, message: response, stream: [] }, 'append'),
    ]
    const [attached] = attachRequestMessages([request(2, 1, 4, 5)], window(events))

    expect(attached?.purpose === 'assistant' && attached.messages?.map(item => item.id))
      .toEqual(['system', 'summary'])
  })

  it('uses step/end as the boundary for a failed request without a response', () => {
    const before = message('before', 'user', 'before')
    const after = message('after', 'user', 'after')
    const events = [
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'user/message', before, 'append'),
      event(3, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
      event(6, 'user/message', after, 'append'),
    ]
    const [attached] = attachRequestMessages([request(1, 1, 1)], window(events))

    expect(attached?.purpose === 'assistant' && attached.messages?.map(item => item.id))
      .toEqual(['before'])
  })
})
