/**
 * Client half of dsh-better-tools: mounts a tiny React widget that proves the
 * client bundle loaded in the web shell AND that the host↔client loop works —
 * the widget pings the plugin's own host route (`/better-tools/api/ping`) and
 * renders the host service's answer.
 *
 * The bundle is a module-table consumer only (react + react-dom/client, both
 * provided by the web shell). It injects `slots` purely to demonstrate the
 * client runtime wiring; the read-only `ctx.slots.snapshot()` call below is
 * safe on undeclared slots (returns []) and never throws.
 */
import { createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '../context-types.ts'

/** Services required before mounting: the client runtime's slot registry. */
export const inject = ['slots']

const PLUGIN = 'dsh-better-tools'
const VERSION = '0.1.0'

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots).
 */
export function apply(ctx: Context): void {
  // A failure anywhere in the client lifecycle must never take the app down
  // silently: log with the plugin prefix and pin a visible diagnostic strip so
  // a blank page is never the only symptom.
  const fail = (phase: string, error: unknown): void => {
    console.error(`[${PLUGIN}] ${phase} error:`, error)
    try {
      const bar = document.createElement('div')
      bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483001;max-width:70vw;padding:8px 12px;'
        + 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2a1a1;background:#1b1b22;'
        + 'border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap'
      bar.textContent = `[${PLUGIN}] ${phase} error: ${error instanceof Error ? error.message : String(error)}`
      document.body.appendChild(bar)
    } catch {
      // Nothing left to report with.
    }
  }

  try {
    // Read-only proof the slots service is wired (undeclared slots → []).
    const slotCount = ctx.slots.snapshot().length

    ctx.effect(() => {
      let root: Root | undefined
      const host = document.createElement('div')
      host.setAttribute('data-dsh-better-tools', '')
      document.body.appendChild(host)
      root = createRoot(host)
      root.render(createElement(StatusWidget, { slotCount }))
      return () => {
        root?.unmount()
        host.remove()
      }
    }, `${PLUGIN}: widget mount`)
  } catch (error) {
    fail('load', error)
  }
}

/** Connection state of the host↔client ping. */
type HostState = 'loading' | 'ok' | 'error' | 'timeout'

/** The status pill: shows the plugin identity, the wired-slot count, and the host ping result. */
function StatusWidget({ slotCount }: { slotCount: number }): ReturnType<typeof createElement> {
  const [hostState, setHostState] = useState<HostState>('loading')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      if (alive) setHostState('timeout')
    }, 5000)
    void fetch('/better-tools/api/ping', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { plugin?: string; version?: string }) => {
        if (!alive) return
        window.clearTimeout(timer)
        setHostState('ok')
        setDetail(`${data.plugin ?? '?'}@${data.version ?? '?'}`)
      })
      .catch((error: unknown) => {
        if (!alive) return
        window.clearTimeout(timer)
        setHostState('error')
        setDetail(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const color = hostState === 'ok' ? '#4ade80' : hostState === 'loading' ? '#94a3b8' : '#f87171'
  const line = hostState === 'ok'
    ? `host: ${detail}`
    : hostState === 'loading'
      ? 'host ping …'
      : hostState === 'timeout'
        ? 'host ping timed out'
        : `host error: ${detail}`

  return createElement(
    'div',
    {
      'data-dsh-better-tools': 'true',
      style: {
        position: 'fixed',
        left: '12px',
        bottom: '12px',
        zIndex: 2147483000,
        font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#e2e8f0',
        background: 'rgba(15,23,42,0.92)',
        border: `1px solid ${color}`,
        borderRadius: '10px',
        padding: '8px 12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
        maxWidth: '60vw',
      },
    },
    createElement('div', { style: { fontWeight: 700 } }, `🧰 ${PLUGIN} v${VERSION}`),
    createElement('div', { style: { color: '#94a3b8' } }, `client slots declared: ${String(slotCount)}`),
    createElement('div', { style: { color } }, line),
  )
}
