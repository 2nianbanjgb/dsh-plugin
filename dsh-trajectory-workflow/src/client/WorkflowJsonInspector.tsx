/** Collapsible JSON inspector used by the Workflow request details. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Braces, Maximize2, X } from 'lucide-react'
import { JsonView } from 'react-json-view-lite'
import { Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WorkflowView.module.css'

function requiredCssClass(name: keyof typeof css): string {
  const className = css[name]
  if (className === undefined) throw new Error(`Missing Workflow CSS class: ${name}`)
  return className
}

function shouldExpandNode(level: number, _value: unknown, field?: string): boolean {
  return level === 0 || field === 'messages' || field === 'tools' || level > 2
}

function CopyButton({
  copied, copyJson, size, t,
}: {
  copied: boolean
  copyJson: () => void
  size: number
  t: PropsLocale<'workflow'>['t']
}) {
  const label = copied ? t('workflow.copied') : t('workflow.copy')
  return (
    <button
      type="button"
      className={css.jsonAction}
      onClick={copyJson}
      aria-label={label}
      title={label}
    >
      {copied
        ? <Check size={size} aria-hidden="true" />
        : <Copy size={size} aria-hidden="true" />}
    </button>
  )
}

/**
 * Render an inline JSON tree with copy and large-dialog inspection actions.
 * @param props.data - JSON-compatible object shown and copied verbatim.
 * @param props.label - Section label used by accessible names and the dialog title.
 * @param props.t - Workflow locale lookup.
 * @returns The inline tree and its controlled large dialog.
 */
export function WorkflowJsonInspector({
  data, label, t,
}: {
  data: object
  label: string
  t: PropsLocale<'workflow'>['t']
}) {
  const [copied, setCopied] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const copyReset = useRef<number | null>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const serialized = useMemo(() => JSON.stringify(data, null, 2), [data])
  const dialogTitle = t('workflow.json.dialog').replace('{label}', label)
  const treeStyle = useMemo(() => ({
    container: requiredCssClass('jsonTree'),
    basicChildStyle: requiredCssClass('jsonTreeRow'),
    label: requiredCssClass('jsonKey'),
    clickableLabel: requiredCssClass('jsonClickableKey'),
    nullValue: requiredCssClass('jsonKeyword'),
    undefinedValue: requiredCssClass('jsonKeyword'),
    numberValue: requiredCssClass('jsonNumber'),
    stringValue: requiredCssClass('jsonString'),
    booleanValue: requiredCssClass('jsonKeyword'),
    otherValue: requiredCssClass('jsonValue'),
    punctuation: requiredCssClass('jsonPunctuation'),
    expandIcon: requiredCssClass('jsonExpandIcon'),
    collapseIcon: requiredCssClass('jsonCollapseIcon'),
    collapsedContent: requiredCssClass('jsonCollapsedContent'),
    childFieldsContainer: requiredCssClass('jsonChildren'),
    quotesForFieldNames: true,
    stringifyStringValues: true,
    ariaLables: {
      collapseJson: t('workflow.json.collapseNode'),
      expandJson: t('workflow.json.expandNode'),
    },
  }), [t])

  useEffect(() => () => {
    if (copyReset.current !== null) window.clearTimeout(copyReset.current)
  }, [])

  const copyJson = useCallback(() => {
    void writeClipboard(serialized).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (copyReset.current !== null) window.clearTimeout(copyReset.current)
      copyReset.current = window.setTimeout(() => {
        copyReset.current = null
        setCopied(false)
      }, 1_000)
    })
  }, [serialized])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    window.setTimeout(() => { expandButton.current?.focus() }, 0)
  }, [])

  const tree = (expanded: boolean) => (
    <JsonView
      aria-label={expanded ? dialogTitle : `${label} JSON`}
      data={data}
      style={treeStyle}
      shouldExpandNode={shouldExpandNode}
      clickToExpandNode
    />
  )

  return (
    <>
      <div className={css.jsonInspector} data-workflow-scroll-region="">
        <div className={css.jsonToolbar}>
          <span className={css.jsonLanguage}><Braces size={13} aria-hidden="true" />JSON</span>
          <div className={css.jsonActions}>
            <CopyButton copied={copied} copyJson={copyJson} size={14} t={t} />
            <button
              ref={expandButton}
              type="button"
              className={css.jsonAction}
              onClick={() => { setDialogOpen(true) }}
              aria-label={t('workflow.json.expand')}
              title={t('workflow.json.expand')}
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className={css.jsonViewport}>{tree(false)}</div>
      </div>
      <Modal
        open={dialogOpen}
        onClose={closeDialog}
        title={dialogTitle}
        className={requiredCssClass('jsonDialog')}
        headless
      >
        <header className={css.jsonDialogHeader}>
          <strong><Braces size={16} aria-hidden="true" />{dialogTitle}</strong>
          <div className={css.jsonActions}>
            <CopyButton copied={copied} copyJson={copyJson} size={15} t={t} />
            <button
              type="button"
              className={css.jsonAction}
              onClick={closeDialog}
              aria-label={t('workflow.json.close')}
              title={t('workflow.json.close')}
              autoFocus
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className={css.jsonDialogBody} data-workflow-scroll-region="">
          {tree(true)}
        </div>
      </Modal>
    </>
  )
}
