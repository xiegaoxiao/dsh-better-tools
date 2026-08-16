/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share.
 *
 * A third-party plugin resolves outside the DSH monorepo's single cordis
 * instance, so the upstream `declare module 'cordis'` augmentations from the
 * @deepseek-ai packages may not reach this Context — and the public `cordis`
 * package does not declare the DSH-vendored runtime members (`ctx.effect`,
 * service properties). The members below mirror the actual runtime shapes
 * this plugin touches:
 * - webServer: @deepseek-ai/dsh-host-webserver (the WebServer)
 * - tools:     @deepseek-ai/dsh-tools (the ToolRuntime)
 * - slots:     @deepseek-ai/dsh-client-runtime (the client SlotRegistry)
 * - effect:    the DSH-vendored cordis lifecycle helper
 *
 * This file MUST stay FREE of Node.js types (`node:http`, `node:stream`,
 * `Buffer`): it is part of the CLIENT-reachable declaration graph (the client
 * bundle imports `Context` from here), so a Node import here would leak into
 * the browser-only build and trip the client-bundle purity gate. The HTTP
 * faces below are therefore structural mirrors with plain interfaces.
 */
import type { Context } from 'cordis'

/** The request face route handlers see (structural subset of node's IncomingMessage). */
export interface BetterToolsHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}

/** The response face route handlers write to (structural subset of node's ServerResponse). */
export interface BetterToolsHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface BetterToolsWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: BetterToolsHttpRequest, res: BetterToolsHttpResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface BetterToolsWebServer {
  register(route: BetterToolsWebRoute): () => void
}

/** The tools service face (mirror of @deepseek-ai/dsh-tools' ToolRuntime). */
export interface BetterToolsToolsService {
  register(tool: unknown): () => void
}

/** The client slots service face (mirror of the runtime SlotRegistry — only the read used here). */
export interface BetterToolsSlotsService {
  snapshot(root?: string): readonly unknown[]
}

/** The small host service this plugin provides under `ctx.betterTools`. */
export interface BetterToolsService {
  /** Plugin package name. */
  name: string
  /** Plugin version (kept in sync with package.json). */
  version: string
  /** Health probe: returns the identity and the current epoch ms. */
  ping(): { ok: true; name: string; version: string; time: number }
}

declare module 'cordis' {
  interface Context {
    webServer: BetterToolsWebServer
    tools: BetterToolsToolsService
    slots: BetterToolsSlotsService
    /**
     * The host service this plugin provides (see src/index.ts). On the host
     * plane it is a real service; on the client plane it is undefined (the
     * client reaches the host through the /better-tools/api routes instead).
     */
    betterTools: BetterToolsService
    /** Register a lifecycle callback (DSH-vendored cordis): runs at plugin activation; its returned cleanup runs at disposal. */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
