// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const PLUGIN_ID = 'dsh-plugin-agent-workflow'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}
type Win = { __ModuleLoader__?: { load(handoff: Handoff): void } }

function readBundle(): string | undefined {
  try {
    return readFileSync(resolve('lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const element of document.querySelectorAll('style')) element.remove()
})

describe('Workflow tsdown client artifact', () => {
  const code = readBundle()

  it.skipIf(code === undefined)('hands off as its own module without stale client-runtime imports', async () => {
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: (value) => { handoff = value } }
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff?.id).toBe(PLUGIN_ID)
    const requested: string[] = []
    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-ui-primitives', {}],
    ])
    const exports = handoff!.factory((specifier) => {
      requested.push(specifier)
      const value = modules.get(specifier)
      if (value === undefined) throw new Error(`unexpected require: ${specifier}`)
      return value
    })
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'sessions', 'locale'])
    expect(requested).not.toContain('@deepseek-ai/dsh-client-runtime/client')
    expect(requested).not.toContain('@deepseek-ai/dsh-client-ui-trajectory/client')
    expect(document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`).length).toBeGreaterThan(0)
  })
})
