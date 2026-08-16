/**
 * dsh-better-tools host half: provides a small `betterTools` host service,
 * registers one model-facing tool (`better_tools_ping`), and mounts a tiny
 * JSON route (`/better-tools/api/ping`).
 *
 * This is a MINIMAL scaffold of the DSH "host half" of a dual-half plugin:
 * it shows the three canonical ways a host plugin contributes capabilities
 * (service provision, tool registration, web route) while staying entirely
 * out of the DSH source tree — everything rides the profile's own
 * `webServer` / `tools` services.
 *
 * Conventions:
 * - `export const name` matches package.json `name` (bundle identity).
 * - `export const inject` lists the services required before mounting.
 * - every side effect is wrapped in `ctx.effect(...)` so disposal (and HMR)
 *   unwinds it cleanly.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Context } from './context-types.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-better-tools'

/** Services required before mounting: the web server routes and the model tool registry. */
export const inject = ['webServer', 'tools']

/** Plugin version, kept in sync with package.json `version`. */
const VERSION = '0.1.0'

/**
 * Plugin body: provide the host service, register the sample tool, mount the
 * sample route. All three are `ctx.effect`-wrapped so a reload disposes them.
 * @param ctx - host plugin context (webServer, tools).
 */
export function apply(ctx: Context): void {
  const service: Context['betterTools'] = {
    name,
    version: VERSION,
    ping: () => ({ ok: true, name, version: VERSION, time: Date.now() }),
  }

  // ── Host service ─────────────────────────────────────────────────────────
  // Provide `ctx.betterTools` to other plugins (host or client half). The
  // client half of THIS plugin is the first consumer — see src/client/index.tsx.
  ctx.effect(
    () => ctx.provide('betterTools', service),
    'dsh-better-tools: provide betterTools service',
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

  // ── Web route ────────────────────────────────────────────────────────────
  // A tiny JSON API under /better-tools/api. A real plugin would gate every
  // request behind the same browser-trust fence as the /api gateway (see
  // DSH-better-sidebar's trust-fence.ts).
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/better-tools/api',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        if (req.method === 'GET' && url.pathname === '/better-tools/api/ping') {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(service.ping()))
          return
        }
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'not found' }))
      },
    }),
    'dsh-better-tools: /better-tools/api routes',
  )
}
