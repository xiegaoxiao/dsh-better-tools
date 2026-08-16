/**
 * dsh-better-tools host half: provides a small `betterTools` host service,
 * registers one model-facing tool (`better_tools_ping`), mounts JSON routes
 * under `/better-tools/api` (ping + the shell-preference setting), and
 * contributes a host-global system-prompt section that tells EVERY agent
 * session — regardless of preset/mode — which shell to prefer for shell
 * commands, driven by a durable `better-tools` settings namespace.
 *
 * This started as a MINIMAL scaffold of the DSH "host half" of a dual-half
 * plugin; the shell-preference feature extends it along the same seams:
 * - settings: `ctx.settings.register()` owns the `better-tools` namespace;
 *   the web client reaches it through OUR route (the official /api settings
 *   wire keeps an allowlist in dsh-host-apiproxy, so a plugin-owned namespace
 *   is not exposed to the browser there).
 * - systemPrompt: `ctx.systemPrompt.variable()/section()` register a global
 *   section whose text re-reads the setting on every assembly, so a toggle
 *   takes effect on the next model step of every session — no restart.
 *
 * Conventions:
 * - `export const name` matches package.json `name` (bundle identity).
 * - `export const inject` lists the services required before mounting.
 * - every side effect is wrapped in `ctx.effect(...)` so disposal (and HMR)
 *   unwinds it cleanly.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BetterToolsHttpRequest, BetterToolsHttpResponse, BetterToolsSpawnHandle, BetterToolsSubprocessService, Context, ShellPreference } from './context-types.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-better-tools'

/**
 * Services required before mounting: the web server routes, the model tool
 * registry, and the two host services the shell-preference feature rides on
 * (the settings provider and the system-prompt registry). They are always
 * composed in the web profile (dsh-base ships them). Hard injection — rather
 * than a nested `ctx.inject` inside `apply` — guarantees they are available
 * synchronously when `apply` registers the namespace and the prompt section
 * (a nested `ctx.inject` proved unreliable for the settings service here).
 */
export const inject = ['webServer', 'tools', 'settings', 'systemPrompt']

/** Plugin version, kept in sync with package.json `version`. */
const VERSION = '0.1.1'

// ── Shell-preference setting ────────────────────────────────────────────────
/** Settings namespace owned by this plugin (persisted in the user-settings document). */
const SHELL_NAMESPACE = settingsNamespace('better-tools')
/** Field carrying the selected shell preference. */
const SHELL_FIELD = 'shell'
/** Accepted values: off, or one of the shells the agent may be told to prefer. */
const SHELL_OPTIONS: readonly ShellPreference[] = ['off', 'gitbash', 'pwsh']
/** Default when the user-settings document has no override. */
const DEFAULT_SHELL: ShellPreference = 'gitbash'
/** Durable settings schema; validates the user layer and fills the default. */
const ShellSettingsSchema = z.object({ [SHELL_FIELD]: z.union([...SHELL_OPTIONS]).default(DEFAULT_SHELL) })

/** The system-prompt variable name the shell-preference section interpolates. */
const SHELL_PROMPT_VARIABLE = 'better_tools_shell_preference'

/** Human text per option for the model-facing prompt section. */
const SHELL_PROMPT_TEXT: Record<ShellPreference, string> = {
  gitbash: 'Prefer the `gitbash` tool — a real Git Bash spawned directly, available on every preset — for shell commands unless the task explicitly requires PowerShell. (The standard `bash` tool is not a real Git Bash on Windows; use `gitbash`.)',
  pwsh: 'Prefer the PowerShell shell: use the `pwsh` tool for shell commands unless the task explicitly requires Git Bash.',
  off: 'Use whichever shell fits the task (no forced preference).',
}

/** Read the current shell preference, tolerating an absent settings provider. */
function readShellPreference(ctx: Context): ShellPreference {
  const settings = ctx.get('settings')
  const section = settings?.get(SHELL_NAMESPACE)
  const value = section?.[SHELL_FIELD]
  return SHELL_OPTIONS.includes(value as ShellPreference) ? value as ShellPreference : DEFAULT_SHELL
}

// ── Real Git Bash tool (global) ─────────────────────────────────────────────
// The official `bash` tool routes through `ctx.shell`, which on Windows is the
// pwsh executor (dsh-shell's win32 layer swaps the POSIX rows) — so on the
// default `standard` preset the `bash` tool does NOT provide a real Git Bash
// and agents fall back to pwsh. This plugin registers a GLOBAL `gitbash` tool
// that spawns real Git Bash directly via `ctx.subprocess` (unconfined, because
// Git Bash cannot start under the harness file sandbox), so the shell
// preference is effective on every preset/mode.

/** True for an absolute Windows path (drive letter, UNC, or a root-relative path). */
function isAbsoluteWin(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
}

/** Join a base dir and a relative path with backslashes (Windows). */
function joinWinPath(base: string, rel: string): string {
  const b = base.replace(/[\\/]+$/, '')
  const r = rel.replace(/^[\\/]+/, '')
  return b + '\\' + r.split(/[\\/]/).join('\\')
}

/** Resolve Git Bash via the subprocess resolver, with common install-location fallbacks. */
async function resolveGitBash(subprocess: BetterToolsSubprocessService): Promise<string> {
  try {
    return await subprocess.resolveExecutable('bash')
  } catch {
    const candidates = [
      'E:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files\\Git\\cmd\\bash.exe',
    ]
    for (const candidate of candidates) {
      try {
        return await subprocess.resolveExecutable(candidate)
      } catch {
        // try next candidate
      }
    }
    throw new Error('Git Bash (bash.exe) was not found on this machine')
  }
}

/** One captured stream with its truncation marker. */
interface GitBashStream {
  text: string
  truncated: boolean
  spillPath?: string
}

function gitBashStreamText(read: GitBashStream | undefined): string {
  if (read === undefined) return ''
  if (!read.truncated) return read.text
  return read.text + (read.spillPath !== undefined ? `\n[output truncated; full output: ${read.spillPath}]` : '\n[output truncated]')
}

/** Render the gitbash result as the model-facing text (marker contract identical to the shell tools). */
function renderGitBashResult(value: { exitCode: number | null; signal: string | null; timedOut: boolean; aborted: boolean; timeoutMs: number; stdout?: GitBashStream; stderr?: GitBashStream }): string {
  const out = gitBashStreamText(value.stdout)
  const err = gitBashStreamText(value.stderr)
  let body = out
  if (err !== '') {
    if (body !== '' && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body === '') body = '(no output)'
  const markers: string[] = []
  if (value.timedOut) markers.push(`[timed out after ${value.timeoutMs}ms]`)
  if (value.aborted) markers.push('[aborted]')
  if (value.signal !== null && value.signal !== undefined) markers.push(`[killed by signal: ${value.signal}]`)
  else if (value.exitCode !== 0 && value.exitCode !== null) markers.push(`[exit code: ${value.exitCode}]`)
  if (markers.length > 0) {
    if (!body.endsWith('\n')) body += '\n'
    body += markers.join('\n')
  }
  return body
}

/**
 * Recover the terminal exit pill from the rendered result text — the inverse
 * of the `[exit code: N]` / `[killed by signal: X]` markers above. Copied from
 * `@deepseek-ai/dsh-shell` (kept local to avoid an extra runtime dependency).
 */
function parseExitStatus(text: string): { body: string; exitCode?: number; signal?: string } {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) {
    return { body: text.slice(0, signal.index), signal: signal[1] }
  }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) {
    return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  }
  return { body: text, exitCode: 0 }
}

/**
 * Collect a request body as UTF-8 text. The route handler receives node's
 * IncomingMessage; this helper stays free of node types so context-types.ts
 * (client-reachable) never leaks them.
 */
function readBody(req: BetterToolsHttpRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    req.on('data', (chunk: unknown) => {
      chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk)))
    })
    req.on('end', () => {
      const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(new TextDecoder().decode(merged))
    })
    req.on('error', reject)
  })
}

/** JSON reply helper. */
function sendJson(res: BetterToolsHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

/**
 * Plugin body: provide the host service, register the sample tool, own the
 * shell-preference setting (durable + global prompt), and mount the JSON API.
 * All contributions are `ctx.effect`-wrapped so a reload disposes them.
 * @param ctx - host plugin context (webServer, tools, settings, systemPrompt).
 */
export function apply(ctx: Context): void {
  const service: Context['betterTools'] = {
    name,
    version: VERSION,
    ping: () => ({ ok: true, name, version: VERSION, time: Date.now() }),
  }

  // ── Host service ─────────────────────────────────────────────────────────
  ctx.effect(
    () => ctx.provide('betterTools', service),
    'dsh-better-tools: provide betterTools service',
  )

  // ── Shell-preference setting (durable) ───────────────────────────────────
  // `settings` is hard-injected (guaranteed by the top-level inject list), so
  // the namespace registers synchronously here. `register` self-manages its
  // effect on the settings service's fiber; the scope object it returns is a
  // reader/writer handle, NOT an effect disposer — never return it from the
  // effect callback (cordis rejects non-disposer effect results).
  ctx.effect(
    () => {
      ctx.settings.register(SHELL_NAMESPACE, ShellSettingsSchema)
    },
    'dsh-better-tools: register better-tools settings namespace',
  )

  // ── Shell-preference system prompt (every session, every mode) ──────────
  // A host-global section + live variable: each model-step assembly re-reads
  // the setting, so toggling it takes effect immediately, on every agent
  // session regardless of its preset/mode.
  ctx.effect(
    () => {
      const disposeVariable = ctx.systemPrompt.variable(SHELL_PROMPT_VARIABLE, () => {
        return SHELL_PROMPT_TEXT[readShellPreference(ctx)]
      })
      const disposeSection = ctx.systemPrompt.section({
        name: 'better-tools:shell-preference',
        order: 50,
        text: `{{${SHELL_PROMPT_VARIABLE}}}`,
      })
      return () => {
        disposeSection()
        disposeVariable()
      }
    },
    'dsh-better-tools: shell-preference system prompt',
  )

  // ── Real Git Bash tool (global) ──────────────────────────────────────────
  // Registered only when `ctx.subprocess` is composed (always in the web
  // profile). This is what makes the `gitbash` shell preference actually work
  // on the default `standard` preset: a real Git Bash, spawned directly and
  // unconfined, with the same terminal-card rendering as the official pwsh.
  //
  // IMPORTANT: do NOT resolve subprocess with a bare `ctx.get('subprocess')`
  // inside `apply`. The host composition activates rows by service
  // availability, not row order — so when this plugin's apply runs, the
  // subprocess fiber may not be active yet, `ctx.get` (strict) returns
  // undefined, and the gitbash tool silently never registers (the exact bug
  // this line fixes). Waiting through a nested `ctx.inject(['subprocess'], …)`
  // defers registration until subprocess is actually available, on every boot
  // order. Note the ARRAY argument: the string form `ctx.inject('subprocess', …)`
  // breaks `Inject.resolve` (it Object.keys the string into index keys), which
  // is why this plugin's own comment history calls nested inject "unreliable".
  ctx.inject(['subprocess'], (subCtx) => {
    const subprocess = subCtx.get('subprocess')
    if (subprocess === undefined) return
    let bashResolve: Promise<string> | undefined
    const getBash = (): Promise<string> => {
      bashResolve ??= resolveGitBash(subprocess)
      return bashResolve
    }
    return ctx.tools.register(defineTool({
      name: 'gitbash',
      description:
        'Execute a shell command via real Git Bash (`bash -c`) and return its stdout/stderr. '
        + 'Unlike the standard `bash` tool (which on Windows routes through the PowerShell executor), '
        + 'this tool spawns actual Git Bash directly, so bash/POSIX syntax works everywhere. '
        + 'Use bash/POSIX style (`ls`, `grep`, `sed`, `cat`, `&&`, pipes, `$VAR`) and POSIX-style paths. '
        + 'Each call runs in a fresh Git Bash process: no state (cwd, variables, functions) persists between calls — '
        + 'pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. '
        + 'IMPORTANT: Git Bash (MSYS2) cannot start under the harness file sandbox (its signal pipe is denied by the '
        + 'restricted token), so this tool runs UNCONFINED with full filesystem access, like your own terminal — '
        + 'only touch files you are meant to touch. Long output is truncated to its tail; the full output is saved '
        + 'to a file whose path is reported when available.',
      parameters: {
        command: { type: 'string', description: 'The bash command to execute via Git Bash.', required: true },
        description: { type: 'string', description: 'Clear, concise description of what this command does in active voice, 5-10 words. Examples: "List files in current directory"; "Show git status"; "Count lines in a file".', required: true },
        workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds; the process tree is killed on expiry. Defaults to 120000.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true, description: 'Process exit code, or null when killed by a signal.' },
            signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'Killing signal name, or null when the process exited.' },
            timedOut: { type: 'boolean', required: true, description: 'Whether the command hit the timeout.' },
            aborted: { type: 'boolean', required: true, description: 'Whether the call was aborted.' },
            timeoutMs: { type: 'number', required: true, description: 'The applied timeout in milliseconds.' },
            stdout: { type: 'object', required: true, additionalProperties: false, properties: {
              text: { type: 'string', required: true, description: 'Captured stdout text.' },
              truncated: { type: 'boolean', required: true, description: 'Whether output exceeded the in-memory cap.' },
              spillPath: { type: 'string', description: 'Path to the spilled full output when truncated.' },
            } },
            stderr: { type: 'object', required: true, additionalProperties: false, properties: {
              text: { type: 'string', required: true, description: 'Captured stderr text.' },
              truncated: { type: 'boolean', required: true, description: 'Whether output exceeded the in-memory cap.' },
              spillPath: { type: 'string', description: 'Path to the spilled full output when truncated.' },
            } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: renderGitBashResult(value as Parameters<typeof renderGitBashResult>[0]),
        }],
      },
      presentCall: (args) => {
        const a = args as { command?: string; description?: string; workdir?: string }
        return {
          card: 'terminal',
          title: a.command ?? '',
          ...(a.description !== undefined && a.description !== '' ? { description: a.description } : {}),
          ...(a.workdir !== undefined && a.workdir !== '' ? { cwd: a.workdir } : {}),
        }
      },
      presentResult: (args, result) => {
        const content = Array.isArray(result.content) && result.content.length === 1 ? result.content[0] : undefined
        if (content === undefined || content.type !== 'text') return undefined
        const raw = content.text
        if (result.isError) {
          return {
            card: 'generic',
            content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }],
          }
        }
        const { body, ...exit } = parseExitStatus(raw)
        return { card: 'terminal', output: body, ...exit }
      },
      execute: async (args, exec) => {
        const a = args as { command?: unknown; description?: unknown; workdir?: unknown; timeoutMs?: unknown }
        const e = exec as { agent?: { session?: { header?: { cwd?: string } } }; signal: { aborted: boolean } }
        if (typeof a.command !== 'string' || a.command.trim().length === 0) throw new Error('invalid command: expected a non-empty string')
        if (typeof a.description !== 'string' || a.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
        if (a.timeoutMs !== undefined && (typeof a.timeoutMs !== 'number' || !Number.isFinite(a.timeoutMs) || a.timeoutMs <= 0)) {
          throw new Error('invalid timeoutMs: expected a positive number')
        }
        const bashExe = await getBash()
        const timeoutMs = a.timeoutMs !== undefined ? Math.min(Math.floor(a.timeoutMs), 3600000) : 120000
        const headerCwd = e.agent?.session?.header?.cwd
        let workdir = typeof a.workdir === 'string' && a.workdir.length > 0 ? a.workdir : headerCwd
        if (workdir === undefined) {
          const policySvc = ctx.get('sandboxPolicy') as { workspaceRoot?: string } | undefined
          if (policySvc !== undefined) workdir = policySvc.workspaceRoot
        }
        if (workdir === undefined) throw new Error('no working directory: pass `workdir` or run inside a session')
        if (!isAbsoluteWin(workdir) && headerCwd !== undefined) workdir = joinWinPath(headerCwd, workdir)

        const argv = [bashExe, '-c', a.command]
        let proc: BetterToolsSpawnHandle
        try {
          proc = subprocess.spawn({
            argv,
            cwd: workdir,
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: 400000, spill: { maxBytes: 4000000 } },
              stderr: { maxBytes: 400000, spill: { maxBytes: 4000000 } },
            },
            graceMs: 3000,
            signal: e.signal,
            })
          } catch (err) {
            throw new Error('failed to start Git Bash: ' + String(err && err instanceof Error ? err.message : err))
          }

          // Host-process deadline (plain host timer, cleared on settlement).
          let timedOut = false
          const deadlineTimer = setTimeout(() => {
            timedOut = true
            try {
              proc.terminate()
            } catch {
              // process already gone
            }
          }, timeoutMs)
          let outcome: { exitCode: number; signal: string | null }
          try {
            outcome = await proc.done
          } catch (err) {
            clearTimeout(deadlineTimer)
            throw new Error('Git Bash process failed to start: ' + String(err && err instanceof Error ? err.message : err))
          }
          clearTimeout(deadlineTimer)

          const readOut = (reader: BetterToolsSpawnHandle['collected']['stdout']): GitBashStream | undefined => {
            if (reader === undefined) return undefined
            const r = reader.readFrom(0)
            const out: GitBashStream = { text: r.text, truncated: r.lossy }
            if (r.spillPath !== undefined) out.spillPath = r.spillPath
            return out
          }
          return {
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            timedOut,
            aborted: e.signal.aborted,
            timeoutMs,
            stdout: readOut(proc.collected.stdout) ?? { text: '', truncated: false },
            stderr: readOut(proc.collected.stderr) ?? { text: '', truncated: false },
          }
        },
      }))
  })

  // ── Model-facing tool ────────────────────────────────────────────────────
  // A sample tool: proves the tool registry wiring. A real plugin would bind
  // to the calling agent's session through `exec.agent.session.id` and scope
  // every operation to it.
  ctx.effect(
    () => ctx.tools.register(defineTool({
      name: 'better_tools_ping',
      description:
        'Ping the dsh-better-tools host plugin and learn its identity and version. '
        + 'A minimal sample tool demonstrating how a host plugin contributes model-facing tools '
        + 'to every agent in the deployment.',
      parameters: {
        message: {
          type: 'string',
          description: 'Optional message to echo back in the result.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true, description: 'Always true on success.' },
            plugin: { type: 'string', required: true, description: 'Plugin package name.' },
            version: { type: 'string', required: true, description: 'Plugin version.' },
            echo: { type: 'string', required: true, description: 'The echoed message ("pong" when none was given).' },
          },
        },
        render: (_args, value): ContentBlock[] => {
          const v = value as { ok: boolean; plugin: string; version: string; echo: string }
          return [{
            type: 'text',
            text: `better_tools_ping → ${v.ok ? 'pong' : 'fail'} (${v.plugin}@${v.version}, echo=${v.echo})`,
          }]
        },
      },
      execute: (args: { message?: string }) => Promise.resolve({
        ok: true,
        plugin: name,
        version: VERSION,
        echo: args.message ?? 'pong',
      }),
    })),
    'dsh-better-tools: register better_tools_ping tool',
  )

  // ── Web routes ───────────────────────────────────────────────────────────
  // A tiny JSON API under /better-tools/api:
  //   GET  /better-tools/api/ping  → host identity/health
  //   GET  /better-tools/api/shell → { ok, shell, options } (current preference)
  //   PUT  /better-tools/api/shell → body { shell } → persists the preference
  // A real plugin would gate these behind the same browser-trust fence the
  // official /api gateway applies to its own routes.
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/better-tools/api',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const pathname = url.pathname
        if (req.method === 'GET' && pathname === '/better-tools/api/ping') {
          sendJson(res, 200, service.ping())
          return
        }
        if (req.method === 'GET' && pathname === '/better-tools/api/shell') {
          sendJson(res, 200, { ok: true, shell: readShellPreference(ctx), options: SHELL_OPTIONS })
          return
        }
        if (req.method === 'PUT' && pathname === '/better-tools/api/shell') {
          const settings = ctx.get('settings')
          if (settings === undefined) {
            sendJson(res, 503, { ok: false, error: 'settings service unavailable' })
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(await readBody(req))
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
            return
          }
          const shell = (parsed as { shell?: unknown } | null)?.shell
          if (!SHELL_OPTIONS.includes(shell as ShellPreference)) {
            sendJson(res, 400, { ok: false, error: `shell must be one of ${SHELL_OPTIONS.join(', ')}` })
            return
          }
          try {
            await settings.update(SHELL_NAMESPACE, { [SHELL_FIELD]: shell })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            return
          }
          sendJson(res, 200, { ok: true, shell })
          return
        }
        sendJson(res, 404, { ok: false, error: 'not found' })
      },
    }),
    'dsh-better-tools: /better-tools/api routes',
  )
}
