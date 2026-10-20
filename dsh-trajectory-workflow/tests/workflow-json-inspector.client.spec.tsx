// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { zh, type WorkflowKey } from '../src/client/locales.ts'
import { WorkflowJsonInspector } from '../src/client/WorkflowJsonInspector.tsx'

const t: PropsLocale<'workflow'>['t'] = key => zh[key as WorkflowKey]
const DATA = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Inspect the workspace' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
  ],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WorkflowJsonInspector', () => {
  it('renders system directly and expands the tools list while keeping tool items collapsed', () => {
    render(
      <>
        <WorkflowJsonInspector data={{ system: 'Follow the instructions' }} label="系统提示词" t={t} />
        <WorkflowJsonInspector
          data={{ tools: [{ name: 'read', parameters: { type: 'object' } }] }}
          label="工具定义"
          t={t}
        />
      </>,
    )

    const system = screen.getByRole('tree', { name: '系统提示词 JSON' })
    expect(system.textContent).toContain('"system"')
    expect(system.textContent).toContain('Follow the instructions')

    const tools = screen.getByRole('tree', { name: '工具定义 JSON' })
    expect(tools.textContent).toContain('"tools"')
    expect(tools.textContent).not.toContain('"name"')
    expect(within(tools).getAllByRole('button', { name: '收起 JSON 节点' })).toHaveLength(2)
    expect(within(tools).getAllByRole('button', { name: '展开 JSON 节点' })).toHaveLength(1)
    fireEvent.click(within(tools).getByRole('button', { name: '展开 JSON 节点' }))
    expect(tools.textContent).toContain('"name"')
    expect(tools.textContent).toContain('"read"')
  })

  it('starts at the messages list and leaves every message item collapsed', () => {
    render(<WorkflowJsonInspector data={DATA} label="消息" t={t} />)

    const tree = screen.getByRole('tree', { name: '消息 JSON' })
    expect(tree.textContent).toContain('"messages"')
    expect(tree.textContent).not.toContain('"role"')
    expect(within(tree).getAllByRole('button', { name: '收起 JSON 节点' })).toHaveLength(2)
    expect(within(tree).getAllByRole('button', { name: '展开 JSON 节点' })).toHaveLength(2)

    fireEvent.click(within(tree).getAllByRole('button', { name: '展开 JSON 节点' })[0]!)
    expect(tree.textContent).toContain('"role"')
    expect(tree.textContent).toContain('"user"')
    expect(tree.textContent).toContain('Inspect the workspace')
  })

  it('uses icon-only actions to copy and open the large JSON dialog', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<WorkflowJsonInspector data={DATA} label="消息" t={t} />)

    const copy = screen.getByRole('button', { name: '复制' })
    expect(copy.querySelector('svg')).not.toBeNull()
    expect(copy.textContent).toBe('')
    fireEvent.click(copy)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(DATA, null, 2))
      expect(screen.getAllByRole('button', { name: '已复制' }).length).toBeGreaterThan(0)
    })

    const expand = screen.getByRole('button', { name: '放大查看 JSON' })
    expect(expand.querySelector('svg')).not.toBeNull()
    fireEvent.click(expand)

    const dialog = screen.getByRole('dialog', { name: '消息 · JSON' })
    expect(within(dialog).getByRole('tree', { name: '消息 · JSON' }).textContent).toContain('"messages"')
    expect(within(dialog).getAllByRole('button', { name: '展开 JSON 节点' })).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭 JSON 查看器' }))
    expect(screen.queryByRole('dialog', { name: '消息 · JSON' })).toBeNull()
  })
})
