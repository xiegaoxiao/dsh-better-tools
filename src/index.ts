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
import type { BetterToolsHttpRequest, BetterToolsHttpResponse, Context, ShellPreference } from './context-types.ts'

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
const VERSION = '0.1.0'

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
  gitbash: 'Prefer the Git Bash shell: use the `bash` tool for shell commands unless the task explicitly requires PowerShell.',
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

  // ── Model-facing tool ────────────────────────────────────────────────────
  // A sample tool: proves the tool registry wiring. A real plugin would bind
  // to the calling agent's session through `exec.agent.session.id` and scope
  // every operation to it (see DSH-better-sidebar's terminal_* tools).
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
  // A real plugin would gate these behind the same browser-trust fence as the
  // /api gateway (see DSH-better-sidebar's trust-fence.ts).
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
