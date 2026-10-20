/** Visual user-turn and model-call explorer backed by the Workflow-owned projection. */

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, LoaderCircle, MessageSquareText, Send, Workflow as WorkflowIcon, Wrench,
} from 'lucide-react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SessionEventWindow, SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  TrajectorySnapshot, UseTrajectory,
} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { UseSession } from '@deepseek-ai/dsh-client-ui-session/client'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveWorkflowLayout } from './projection/layout.ts'
import type { WorkflowCellProps } from './projection/record.ts'
import { EMPTY_WORKFLOW_SNAPSHOT } from './projection/snapshot.ts'
import {
  deriveWorkflowModel,
  type WorkflowCallModel,
  type WorkflowStatus,
  type WorkflowTurnModel,
} from './workflow-model.ts'
import { WorkflowJsonInspector } from './WorkflowJsonInspector.tsx'
import { attachRequestMessages } from './request-messages.ts'
import css from './WorkflowView.module.css'

/** Session-bound history paging for the Workflow view. */
export interface WorkflowViewInjected {
  loadOlder: () => Promise<boolean>
  eventWindow: () => SessionEventWindow
}

const EMPTY_TURN_TIMINGS = new Map<number, { readonly startTime: number; readonly endTime?: number }>()

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function formatTime(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : TIME_FORMAT.format(new Date(value))
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value < 1_000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round(value % 60_000 / 1_000)
  return `${minutes}m${seconds}s`
}

function concise(value: string | undefined, fallback: string): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  return text === '' ? fallback : text
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface DetailSection {
  readonly label: string
  readonly value: string
  readonly json?: true
  readonly tree?: object
}

function jsonSection(label: string, value: unknown): DetailSection {
  return { label, value: stringify(value), json: true }
}

function treeSection(label: string, field: string, value: unknown): DetailSection {
  const tree = { [field]: value }
  return { label, value: stringify(tree), tree }
}

function textSection(label: string, value: string): DetailSection {
  const source = value.trim()
  if (!source.startsWith('{') && !source.startsWith('[')) return { label, value }
  try {
    return { label, value: stringify(JSON.parse(source)), json: true }
  } catch {
    return { label, value }
  }
}

function statusLabel(status: WorkflowStatus, t: PropsLocale<'workflow'>['t']): string {
  switch (status) {
    case 'waiting': return t('workflow.status.waiting')
    case 'running': return t('workflow.status.running')
    case 'complete': return t('workflow.status.complete')
    case 'error': return t('workflow.status.error')
  }
}

function StatusIcon({ status }: { status: WorkflowStatus }) {
  if (status === 'complete') return <CheckCircle2 size={14} aria-hidden="true" />
  if (status === 'error') return <AlertCircle size={14} aria-hidden="true" />
  if (status === 'running') return <LoaderCircle size={14} aria-hidden="true" />
  return <Clock3 size={14} aria-hidden="true" />
}

function Status({ status, t }: { status: WorkflowStatus; t: PropsLocale<'workflow'>['t'] }) {
  return (
    <span className={`${css.status} ${css[`status_${status}`]}`}>
      <StatusIcon status={status} />
      {statusLabel(status, t)}
    </span>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className={css.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  )
}

function turnTitle(turn: WorkflowTurnModel, t: PropsLocale<'workflow'>['t']): string {
  return t('workflow.turnTitle')
    .replace('{turn}', String(turn.turn))
    .replace('{prompt}', turn.promptPreview)
}

function TurnItem({
  turn, selected, onSelect, t,
}: {
  turn: WorkflowTurnModel
  selected: boolean
  onSelect: () => void
  t: PropsLocale<'workflow'>['t']
}) {
  return (
    <button
      type="button"
      className={`${css.turnItem} ${selected ? css.turnItemSelected : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      title={turn.prompt}
    >
      <span className={css.turnTopline}>
        <strong>{turnTitle(turn, t)}</strong>
        <time>{formatTime(turn.startedAt)}</time>
      </span>
      <span className={css.turnBottomline}>
        <span>{turn.calls.length}{t('workflow.calls.suffix')} · {turn.toolCount}{t('workflow.tools.suffix')}</span>
        <Status status={turn.status} t={t} />
      </span>
    </button>
  )
}

type DetailTarget =
  | { readonly kind: 'request'; readonly key: string }
  | { readonly kind: 'response'; readonly key: string }
  | { readonly kind: 'tool'; readonly key: string; readonly tool: number }

function detailKey(target: DetailTarget): string {
  return target.kind === 'tool' ? `${target.key}:tool:${target.tool}` : `${target.key}:${target.kind}`
}

function FlowArrow() {
  return <ArrowRight className={css.arrow} size={18} strokeWidth={1.6} aria-hidden="true" />
}

function CardButton({
  className, target, selected, onSelect, children, label,
}: {
  className: string | undefined
  target: DetailTarget
  selected: boolean
  onSelect: (target: DetailTarget) => void
  children: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      className={`${css.flowCard} ${className ?? ''} ${selected ? css.flowCardSelected : ''}`}
      aria-label={label}
      aria-expanded={selected}
      onClick={() => { onSelect(target) }}
    >
      {children}
    </button>
  )
}

function RequestCard({
  call, selected, onSelect, t,
}: {
  call: WorkflowCallModel
  selected: boolean
  onSelect: (target: DetailTarget) => void
  t: PropsLocale<'workflow'>['t']
}) {
  const request = call.request
  const model = request?.requestConfig?.model ?? request?.prompt?.config.model
  const systemCount = request?.prompt?.system.trim() === '' || request?.prompt?.system === undefined ? 0 : 1
  const messageCount = call.messages.length
  const tools = request?.prompt?.tools.length ?? 0
  return (
    <CardButton
      className={css.requestCard}
      target={{ kind: 'request', key: call.id }}
      selected={selected}
      onSelect={onSelect}
      label={`${t('workflow.request')} ${call.number}`}
    >
      <span className={css.cardHeader}>
        <span className={css.cardTitle}><Send size={14} aria-hidden="true" />{t('workflow.request')}</span>
      </span>
      <span className={css.cardBody}>
        <span className={css.cardPreview}>{model ?? t('workflow.request.context')}</span>
        <span className={css.chips}>
          <span>{t('workflow.system')} {systemCount}</span>
          <span>{t('workflow.messages')} {messageCount}</span>
          <span>{t('workflow.toolDefinitions')} {tools}</span>
        </span>
      </span>
    </CardButton>
  )
}

function ResponseCard({
  call, selected, onSelect, t,
}: {
  call: WorkflowCallModel
  selected: boolean
  onSelect: (target: DetailTarget) => void
  t: PropsLocale<'workflow'>['t']
}) {
  const response = call.response
  const toolCalls = response?.sourceBlocks?.filter(block => block.type === 'tool-call').length ?? call.tools.length
  return (
    <CardButton
      className={css.responseCard}
      target={{ kind: 'response', key: call.id }}
      selected={selected}
      onSelect={onSelect}
      label={`${t('workflow.response')} ${call.number}`}
    >
      <span className={css.cardHeader}>
        <span className={css.cardTitle}><Bot size={14} aria-hidden="true" />{t('workflow.response')}</span>
      </span>
      <span className={css.cardBody}>
        <span className={css.cardPreview}>
          {response === undefined
            ? t('workflow.response.pending')
            : concise(response.previewMarkdown ?? response.text, t('workflow.response.toolOnly'))}
        </span>
        <span className={css.chips}>
          <span>{t('workflow.reasoning')} {response?.thinkingDetail === undefined ? 0 : 1}</span>
          <span>{t('workflow.content')} {response?.outputDetail === undefined ? 0 : 1}</span>
          <span>{t('workflow.toolCalls')} {toolCalls}</span>
        </span>
      </span>
    </CardButton>
  )
}

/**
 * Render the accessible status strip for one tool result.
 * @param props - Resolved status, visible label, and formatted duration.
 * @returns The live tool-result status strip.
 */
export function WorkflowToolResult({
  status, label, duration,
}: {
  status: WorkflowStatus
  label: string
  duration: string
}): ReactNode {
  const resultClass = status === 'error'
    ? css.toolResultError
    : status === 'complete' ? css.toolResultComplete : css.toolResultRunning
  return (
    <span
      className={`${css.toolResult} ${resultClass}`}
      data-tool-status={status}
      aria-live="polite"
    >
      {status === 'error'
        ? <AlertCircle size={14} aria-hidden="true" />
        : status === 'complete'
          ? <CheckCircle2 size={14} aria-hidden="true" />
          : <LoaderCircle size={14} aria-hidden="true" />}
      <span>{label}</span>
      <time>{duration}</time>
    </span>
  )
}

function ToolCard({
  call, tool, index, selected, onSelect, t,
}: {
  call: WorkflowCallModel
  tool: WorkflowCellProps
  index: number
  selected: boolean
  onSelect: (target: DetailTarget) => void
  t: PropsLocale<'workflow'>['t']
}) {
  const settled = tool.outputDetail !== undefined || tool.result !== undefined || tool.resultPreviewMarkdown !== undefined
  const status: WorkflowStatus = tool.isError === true ? 'error' : settled ? 'complete' : 'running'
  const resultLabel = status === 'error'
    ? t('workflow.status.error')
    : status === 'complete'
      ? concise(tool.resultPreviewMarkdown ?? tool.result, t('workflow.tool.complete'))
      : t('workflow.status.running')
  return (
    <CardButton
      className={tool.isError === true ? css.toolCardError : css.toolCard}
      target={{ kind: 'tool', key: call.id, tool: index }}
      selected={selected}
      onSelect={onSelect}
      label={`${t('workflow.tool')} ${tool.text || tool.callId || index + 1}`}
    >
      <span className={css.cardHeader}>
        <span className={css.cardTitle}><Wrench size={14} aria-hidden="true" />{tool.text || t('workflow.tool')}</span>
      </span>
      <span className={css.cardBody}>
        <span className={css.cardPreview}>
          {concise(tool.previewMarkdown, tool.callId ?? t('workflow.tool.call'))}
        </span>
        <WorkflowToolResult
          status={status}
          label={resultLabel}
          duration={formatDuration(tool.timeSeconds === null ? null : tool.timeSeconds * 1_000)}
        />
      </span>
    </CardButton>
  )
}

function DetailPanel({
  call, target, onClose, t,
}: {
  call: WorkflowCallModel
  target: DetailTarget
  onClose: () => void
  t: PropsLocale<'workflow'>['t']
}) {
  let title = t('workflow.request.details')
  let sections: readonly DetailSection[] = []
  if (target.kind === 'request') {
    const request = call.request
    sections = [
      treeSection(t('workflow.systemPrompt'), 'system', request?.prompt?.system ?? null),
      treeSection(t('workflow.messages'), 'messages', call.messages),
      treeSection(t('workflow.toolDefinitions'), 'tools', request?.prompt?.tools ?? []),
    ]
  } else if (target.kind === 'response') {
    title = t('workflow.response.details')
    sections = [
      textSection(t('workflow.reasoning'), call.response?.thinkingDetail || t('workflow.empty')),
      textSection(t('workflow.content'), call.response?.outputDetail || call.response?.text || t('workflow.empty')),
      jsonSection(t('workflow.metadata'), call.response?.assistantMetrics ?? {}),
    ]
  } else {
    title = t('workflow.tool.details')
    const tool = call.tools[target.tool]
    sections = [
      textSection(t('workflow.arguments'), tool?.inputDetail || tool?.previewMarkdown || t('workflow.empty')),
      textSection(t('workflow.result'), tool?.outputDetail || tool?.resultPreviewMarkdown || tool?.result || t('workflow.empty')),
      textSection(t('workflow.schema'), tool?.schemaDetail || t('workflow.empty')),
    ]
  }
  return (
    <section className={css.detailPanel} aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button type="button" onClick={onClose} aria-label={t('workflow.details.close')}>
          <ChevronUp size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={css.detailGrid}>
        {sections.map(section => (
          <section key={section.label}>
            <h4>{section.label}</h4>
            {section.tree !== undefined
              ? <WorkflowJsonInspector data={section.tree} label={section.label} t={t} />
              : section.json === true
                ? (
                  <div data-workflow-scroll-region="">
                    <CodeBlock
                      className={css.detailCode}
                      code={section.value}
                      lang="json"
                      copyLabel={t('workflow.copy')}
                      copiedLabel={t('workflow.copied')}
                    />
                  </div>
                )
                : <pre data-workflow-scroll-region="">{section.value}</pre>}
          </section>
        ))}
      </div>
    </section>
  )
}

function CallRow({
  call, detail, onDetail, t,
}: {
  call: WorkflowCallModel
  detail: DetailTarget | null
  onDetail: (target: DetailTarget | null) => void
  t: PropsLocale<'workflow'>['t']
}) {
  const selectedKey = detail === null ? null : detailKey(detail)
  const select = (target: DetailTarget): void => {
    onDetail(detailKey(target) === selectedKey ? null : target)
  }
  return (
    <article className={css.callRow}>
      <header className={css.callHeader}>
        <strong>{t('workflow.modelCall')} #{call.number}</strong>
        <span><Clock3 size={13} aria-hidden="true" />{formatTime(call.startedAt)}</span>
        <span>{formatDuration(call.durationMs)}</span>
        {call.usage?.inputTotal !== undefined && (
          <span className={css.tokenMetric}>
            <span>{t('workflow.input')} {call.usage.inputTotal.toLocaleString()}</span>
            {call.usage.inputUncached !== undefined
              && (call.usage.cacheRead !== undefined || call.usage.cacheWrite !== undefined) && (
              <small>{t('workflow.inputUncached')} {call.usage.inputUncached.toLocaleString()}</small>
            )}
            {call.usage.cacheRead !== undefined && (
              <small>{t('workflow.cacheRead')} {call.usage.cacheRead.toLocaleString()}</small>
            )}
            {call.usage.cacheWrite !== undefined && (
              <small>{t('workflow.cacheWrite')} {call.usage.cacheWrite.toLocaleString()}</small>
            )}
          </span>
        )}
        {call.usage?.output !== undefined && <span>{t('workflow.output')} {call.usage.output.toLocaleString()}</span>}
        <Status status={call.status} t={t} />
      </header>
      <div className={css.flow}>
        <RequestCard
          call={call}
          selected={selectedKey === `${call.id}:request`}
          onSelect={select}
          t={t}
        />
        <FlowArrow />
        <ResponseCard
          call={call}
          selected={selectedKey === `${call.id}:response`}
          onSelect={select}
          t={t}
        />
        {call.tools.map((tool, index) => (
          <span className={css.toolFlow} key={tool.callId ?? `${call.id}:${index}`}>
            <FlowArrow />
            <ToolCard
              call={call}
              tool={tool}
              index={index}
              selected={selectedKey === `${call.id}:tool:${index}`}
              onSelect={select}
              t={t}
            />
          </span>
        ))}
        {call.tools.length === 0 && call.response !== undefined && (
          <span className={css.finalReply}>
            <ArrowRight size={18} strokeWidth={1.6} aria-hidden="true" />
            <span><MessageSquareText size={16} aria-hidden="true" />{t('workflow.finalReply')}</span>
          </span>
        )}
      </div>
      {detail !== null && <DetailPanel call={call} target={detail} onClose={() => { onDetail(null) }} t={t} />}
    </article>
  )
}

/** Full-height Workflow conversation view. */
export function WorkflowView({
  useSession, useTrajectory, loadOlder, eventWindow, t,
}: ConvViewProps & InjectFace<WorkflowViewInjected> & PropsLocale<'workflow'> & {
  useSession: UseSession
  useTrajectory: UseTrajectory
}) {
  const inspection = useTrajectory((snapshot: TrajectorySnapshot) => snapshot ?? EMPTY_WORKFLOW_SNAPSHOT)
  const events = eventWindow()
  const requests = useMemo(
    () => attachRequestMessages(inspection.requests, events),
    [events, inspection.requests],
  )
  const turnTimings = EMPTY_TURN_TIMINGS
  const hasOlder = useSession((snapshot: SessionSnapshot) => snapshot.hasMore)
  const loadingOlder = useSession((snapshot: SessionSnapshot) => snapshot.loadingOlder)
  const layout = useMemo(() => deriveWorkflowLayout({
    nodes: inspection.eventNodes,
    eventLocations: inspection.eventLocations,
    partial: inspection.partial,
    runningCalls: inspection.runningCalls,
    requests,
    callSchemas: inspection.callSchemas,
  }), [inspection, requests])
  const model = useMemo(
    () => deriveWorkflowModel(layout, requests, turnTimings),
    [layout, requests, turnTimings],
  )
  const [historyPage, setHistoryPage] = useState(0)
  const historyLoadPending = useRef(false)
  useEffect(() => {
    if (!hasOlder || loadingOlder || historyLoadPending.current) return
    let active = true
    historyLoadPending.current = true
    void loadOlder().then((changed) => {
      historyLoadPending.current = false
      if (active && changed) setHistoryPage(page => page + 1)
    }, () => {
      historyLoadPending.current = false
    })
    return () => { active = false }
  }, [hasOlder, historyPage, loadOlder, loadingOlder])
  const [chosenTurn, setChosenTurn] = useState<number | null>(null)
  const selectedTurn = model.turns.find(turn => turn.turn === chosenTurn) ?? model.turns.at(-1)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const calls = selectedTurn?.calls ?? []
  const virtualizer = useVirtualizer({
    count: calls.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 230,
    overscan: 4,
  })
  const handleCallWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    if (event.target instanceof Element
      && event.target.closest('[data-workflow-scroll-region]') !== null) return
    const scroller = event.currentTarget
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1
    const next = Math.max(0, Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      scroller.scrollTop + event.deltaY * scale,
    ))
    if (next === scroller.scrollTop) return
    scroller.scrollTop = next
    event.preventDefault()
  }, [])

  return (
    <section
      className={css.root}
      data-conversation-composer-overlay=""
      aria-label={t('workflow.aria')}
    >
      <header className={css.summary}>
        <div className={css.summaryTitle}>
          <WorkflowIcon size={18} aria-hidden="true" />
          <strong>{t('view.workflow')}</strong>
        </div>
        <div className={css.metrics}>
          <Metric value={String(model.turns.length)} label={t('workflow.turns')} />
          <Metric value={String(model.requestCount)} label={t('workflow.modelCalls')} />
          <Metric value={String(model.toolCount)} label={t('workflow.toolCalls')} />
          <Metric value={formatDuration(model.durationMs)} label={t('workflow.totalDuration')} />
        </div>
      </header>
      <div className={css.workspace}>
        <aside className={css.turns} aria-label={t('workflow.turns')}>
          <header><strong>{t('workflow.turns')}</strong><span>{model.turns.length}</span></header>
          <div className={css.turnList}>
            {model.turns.map(turn => (
              <TurnItem
                key={turn.turn}
                turn={turn}
                selected={turn.turn === selectedTurn?.turn}
                onSelect={() => { setChosenTurn(turn.turn); setDetail(null) }}
                t={t}
              />
            ))}
          </div>
          {hasOlder && (
            <button
              type="button"
              className={css.loadOlder}
              disabled={loadingOlder}
              onClick={() => { void loadOlder() }}
            >
              {loadingOlder ? <LoaderCircle size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              {loadingOlder ? t('workflow.loadingOlder') : t('workflow.loadOlder')}
            </button>
          )}
        </aside>
        <main className={css.main}>
          {selectedTurn === undefined
            ? <div className={css.empty}>{t('workflow.emptyTurns')}</div>
            : (
              <>
                <header className={css.turnHeader}>
                  <div>
                    <strong title={selectedTurn.prompt}>{turnTitle(selectedTurn, t)}</strong>
                  </div>
                  <div>
                    <span><Clock3 size={14} aria-hidden="true" />{formatTime(selectedTurn.startedAt)}</span>
                    <span>{formatDuration(selectedTurn.durationMs)}</span>
                    <span>{selectedTurn.calls.length}{t('workflow.calls.suffix')}</span>
                    <span>{selectedTurn.toolCount}{t('workflow.tools.suffix')}</span>
                  </div>
                </header>
                <div ref={scrollRef} className={css.callScroller} onWheelCapture={handleCallWheel}>
                  {calls.length === 0
                    ? <div className={css.empty}>{t('workflow.emptyCalls')}</div>
                    : (
                      <div className={css.virtualBody} style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map((item) => {
                          const call = calls[item.index]
                          if (call === undefined) return null
                          const activeDetail = detail?.key === call.id ? detail : null
                          return (
                            <div
                              key={call.id}
                              ref={virtualizer.measureElement}
                              data-index={item.index}
                              className={css.virtualRow}
                              style={{ transform: `translateY(${item.start}px)` }}
                            >
                              <CallRow
                                call={call}
                                detail={activeDetail}
                                onDetail={setDetail}
                                t={t}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                </div>
              </>
            )}
        </main>
      </div>
    </section>
  )
}
