/**
 * Client half of dsh-better-tools: a sidebar entry, not a floating badge.
 *
 * The web shell's sidebar declares the additive `sidebar.footer.action` list
 * slot — the footer row next to the Settings button, which the Cordis panel
 * also uses. This plugin registers one occupant button there through
 * `ctx.slots.inject(...)` (which waits for the declaration, so client load
 * order across plugins never matters); clicking it opens a Settings-style
 * modal dialog.
 *
 * The dialog mirrors the Settings modal (mask + centered panel + Escape +
 * close-focus) and renders a settings-style group: the host status plus the
 * plugin's real feature — a "shell preference" toggle (Off / Git Bash /
 * PowerShell) persisted through the plugin's own host route
 * `/better-tools/api/shell`, which the host applies to EVERY agent session
 * via a host-global system-prompt section.
 *
 * The button mirrors the shell's native footer-action chrome: an icon + label
 * in the wide column, a round icon in the collapsed rail. All styles reuse the
 * shell's own theme variables (`--dsw-*`).
 */
import { createElement, Fragment, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { IconCordisPluginOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, ShellPreference } from '../context-types.ts'

/** Services required before mounting: the client runtime's slot registry. */
export const inject = ['slots']

const PLUGIN = 'dsh-better-tools'
const VERSION = '0.1.0'

/** Connection state of the host↔client ping. */
type HostState = 'loading' | 'ok' | 'error' | 'timeout'

const STATUS: Record<HostState, { color: string; label: string }> = {
  loading: { color: '#94a3b8', label: 'host ping …' },
  ok: { color: '#4ade80', label: 'host ok' },
  error: { color: '#f87171', label: 'host error' },
  timeout: { color: '#fbbf24', label: 'host timeout' },
}

/** Shell-preference choices shown in the settings-style group. */
const SHELL_OPTIONS: ReadonlyArray<{ id: ShellPreference; label: string; hint: string }> = [
  { id: 'off', label: '关闭', hint: '不强制，按任务选择' },
  { id: 'gitbash', label: 'Git Bash', hint: '优先用 bash 工具' },
  { id: 'pwsh', label: 'PowerShell', hint: '优先用 pwsh 工具' },
]

/** Button chrome — mirrors the Settings trigger button exactly (same geometry, hover, rail). */
const chrome = {
  trigger: { boxSizing: 'border-box' as const, cursor: 'pointer', width: 'calc(100% + 8px)', height: 34, color: 'var(--dsw-alias-label-primary)', background: '0 0', border: 'none', borderRadius: 12, flex: 'none' as const, alignItems: 'center' as const, gap: 8, margin: '4px -4px', padding: '6px 2px 6px 10px', fontFamily: 'inherit', fontSize: 14, lineHeight: '22px', display: 'flex' as const, overflow: 'hidden' as const },
  rail: { borderRadius: '50%', justifyContent: 'center' as const, gap: 0, width: 36, height: 36, margin: '8px 0 10px', padding: 0 },
  label: { whiteSpace: 'nowrap' as const, overflow: 'hidden' as const },
}

/** Attribute the button carries so the :hover rule below can target it. */
const TRIGGER_ATTR = 'data-dsh-better-tools-trigger'

/**
 * Inject the tiny stylesheet for the button's :hover background (inline styles
 * cannot express it). Mirrors the shell's own data-plugin-css pattern; a
 * no-op once present.
 */
function injectTriggerStyle(): void {
  if (typeof document === 'undefined') return
  const tagId = `${PLUGIN}/trigger`
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = tagId
  tag.textContent = `[${TRIGGER_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`
  document.head.appendChild(tag)
}

/** Modal dialog — mirrors the Settings modal (mask + centered panel + Escape). */
const dialog = {
  overlay: { zIndex: 1000, justifyContent: 'center', alignItems: 'center', display: 'flex' as const, position: 'fixed' as const, inset: 0 },
  mask: { background: 'var(--dsw-alias-bg-mask-1)', backdropFilter: 'var(--dsw-mask-blur)', position: 'absolute' as const, inset: 0 },
  panel: { zIndex: 1, background: 'var(--dsw-alias-bg-layer-2)', width: 520, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 48px)', boxShadow: 'var(--dsw-shadow-lv3)', borderRadius: 16, flexDirection: 'column' as const, display: 'flex' as const, position: 'relative' as const, overflow: 'hidden' as const },
  header: { boxSizing: 'border-box' as const, flex: 'none' as const, justifyContent: 'space-between', alignItems: 'center' as const, gap: 8, minHeight: 54, padding: '12px 14px 8px 16px', display: 'flex' as const, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  title: { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 500, lineHeight: '24px' },
  close: { cursor: 'pointer', width: 28, height: 28, color: 'var(--dsw-alias-label-primary)', background: '0 0', border: 'none', borderRadius: 28, justifyContent: 'center', alignItems: 'center', padding: 0, display: 'inline-flex' as const },
  body: { flex: 1, minHeight: 0, padding: '4px 16px 16px', overflowY: 'auto' as const },
}

/** Settings-style group chrome (title + description + option row). */
const settings = {
  group: { borderBottom: '1px solid var(--dsw-alias-border-l2)', flexDirection: 'column' as const, gap: 8, padding: '14px 0', display: 'flex' as const },
  groupLast: { borderBottom: 'none' },
  title: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 500, lineHeight: '22px' },
  desc: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' },
  optionRow: { flexWrap: 'wrap' as const, gap: 8, display: 'flex' as const },
  option: { boxSizing: 'border-box' as const, border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', background: '0 0', borderRadius: 10, alignItems: 'center' as const, gap: 6, padding: '8px 14px', fontSize: 13, lineHeight: '20px', display: 'inline-flex' as const },
  optionSelected: { background: 'var(--dsw-alias-bg-module-platform)', borderColor: 'var(--dsw-static-neutral-bluish-400)' },
  check: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, lineHeight: '20px' },
  row: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px', display: 'flex' as const, gap: 10 },
  rowKey: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none' as const, width: 64, fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12, lineHeight: '20px' },
  error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '18px' },
}

/**
 * The sidebar footer button + Settings-style modal dialog.
 * `wide` mirrors the shell sidebar state (false = collapsed icon-only rail).
 */
function BetterToolsButton({ wide }: { wide: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  const [hostState, setHostState] = useState<HostState>('loading')
  const [detail, setDetail] = useState('')
  const [shell, setShell] = useState<ShellPreference>('off')
  const [shellLoaded, setShellLoaded] = useState(false)
  const [shellBusy, setShellBusy] = useState(false)
  const [shellError, setShellError] = useState('')
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      if (alive) setHostState('timeout')
    }, 5000)
    void fetch('/better-tools/api/ping', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { name?: string; plugin?: string; version?: string }) => {
        if (!alive) return
        window.clearTimeout(timer)
        setHostState('ok')
        // The route answers with `name` (the tool answers with `plugin`).
        setDetail(`${data.name ?? data.plugin ?? '?'}@${data.version ?? '?'}`)
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

  // Load the persisted shell preference each time the dialog opens.
  useEffect(() => {
    if (!open) return
    let alive = true
    setShellError('')
    void fetch('/better-tools/api/shell', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { ok?: boolean; shell?: string }) => {
        if (!alive) return
        const value = SHELL_OPTIONS.some((o) => o.id === data.shell) ? data.shell as ShellPreference : 'off'
        setShell(value)
        setShellLoaded(true)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setShellLoaded(false)
        setShellError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [open])

  // Persist a selection through the plugin's own route (optimistic UI).
  const selectShell = (id: ShellPreference): void => {
    if (shellBusy || shell === id) return
    setShell(id)
    setShellError('')
    setShellBusy(true)
    void fetch('/better-tools/api/shell', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shell: id }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { ok?: boolean; shell?: string }) => {
        if (data.ok) setShell(SHELL_OPTIONS.some((o) => o.id === data.shell) ? data.shell as ShellPreference : id)
        else setShellError('写入失败')
      })
      .catch((error: unknown) => {
        setShellError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setShellBusy(false))
  }

  // Escape closes the dialog (listener lives only while open, like Settings).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Focus the close button when the dialog opens (like Settings).
  useEffect(() => {
    if (open) closeButton.current?.focus()
  }, [open])

  const status = STATUS[hostState]
  return createElement(
    Fragment,
    null,
    createElement(
      'button',
      {
        type: 'button',
        style: wide ? chrome.trigger : { ...chrome.trigger, ...chrome.rail },
        [TRIGGER_ATTR]: '',
        'aria-label': `dsh-better-tools (${status.label})`,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
      },
      createElement(IconCordisPluginOutline14, { size: wide ? 16 : 18 }),
      wide && createElement('span', { style: chrome.label }, 'better-tools'),
    ),
    open && createElement(
      'div',
      { style: dialog.overlay, role: 'presentation' },
      createElement('div', { style: dialog.mask, 'aria-hidden': 'true', onClick: () => setOpen(false) }),
      createElement(
        'div',
        { style: dialog.panel, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        createElement(
          'div',
          { style: dialog.header },
          createElement('span', { id: titleId, style: dialog.title }, `${PLUGIN} v${VERSION}`),
          createElement('button', { ref: closeButton, type: 'button', style: dialog.close, onClick: () => setOpen(false) }, '✕'),
        ),
        createElement(
          'div',
          { style: dialog.body },
          createElement(
            'div',
            { style: settings.group },
            createElement('span', { style: settings.title }, '宿主状态'),
            createElement('div', { style: settings.row },
              createElement('span', { style: settings.rowKey }, 'host'),
              createElement('span', { style: { color: status.color } }, `${status.label}${detail ? ` · ${detail}` : ''}`),
            ),
          ),
          createElement(
            'div',
            { style: { ...settings.group, ...settings.groupLast } },
            createElement('span', { style: settings.title }, 'Shell 优先'),
            createElement('span', { style: settings.desc },
              '修改后，所有模式 / 会话的 Agent 执行 shell 命令时都会优先使用所选 shell。'),
            createElement(
              'div',
              { style: settings.optionRow },
              SHELL_OPTIONS.map((option) => {
                const selected = shell === option.id
                return createElement(
                  'button',
                  {
                    key: option.id,
                    type: 'button',
                    style: selected ? { ...settings.option, ...settings.optionSelected } : settings.option,
                    'aria-pressed': selected,
                    onClick: () => selectShell(option.id),
                  },
                  selected && createElement('span', { style: settings.check }, '✓'),
                  createElement('span', {}, option.label),
                )
              }),
            ),
            shellError !== '' && createElement('div', { style: settings.error }, `设置读写失败：${shellError}`),
          ),
        ),
      ),
    ),
  )
}

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
    // The button's :hover background comes from a tiny injected stylesheet.
    injectTriggerStyle()
    // Read-only proof the slots service is wired (undeclared slots → []).
    ctx.slots.snapshot()
    // Register into the shell's additive sidebar-footer slot. inject() waits
    // for the declaration, so client load order across plugins never matters.
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
      { name: 'sidebar.footer.action', id: PLUGIN },
      BetterToolsButton,
    ))
  } catch (error) {
    fail('load', error)
  }
}
