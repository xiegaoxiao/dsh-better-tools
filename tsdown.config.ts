/**
 * tsdown build for dsh-better-tools: the host-half lib (lib/index.js, ESM
 * node) plus the browser client bundle (lib/client.js, CJS closure factory).
 *
 * - `lib/index.js` — the host half (src/index.ts). Externalizes npm peers
 *   (@deepseek-ai/*, react, cordis) so they resolve from the profile's
 *   node_modules at runtime.
 * - `lib/client.js` — the client half (src/client/index.tsx). Replicates the
 *   official DSH client-bundle preset:
 *   - externals resolve through the loader module table at runtime (react,
 *     react-dom, cordis, and the @deepseek-ai platform modules),
 *   - everything else is inlined into the bundle,
 *   - the purity gate rejects any other @deepseek-ai value import: cross-plugin
 *     collaboration goes through cordis services, never value imports,
 *   - the artifact registers itself via
 *     window.__ModuleLoader__.load({ id, factory }) with the
 *     (require) => exports CJS closure shape.
 *
 * Types ship from lib/types (tsc -p tsconfig.build.json), not from tsdown.
 *
 * NOTE: `clean` stays off on both bundles — the build script removes lib/
 * wholesale before tsc runs, so a tsdown clean here would wipe the lib/types
 * declarations tsc just emitted (and `watch` must never touch them).
 */
import { builtinModules } from 'node:module'
import type { UserConfig } from 'tsdown'

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
])

/**
 * Module specifiers the web shell shares into the frozen module table (the
 * official PLATFORM_MODULES list, plus the runtime/client exemption).
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/**
 * Wire/type layers a client bundle may inline (mirror of the official
 * INLINE_SAFE list): browser-safe contract surfaces with no runtime identity
 * to share. Everything else under @deepseek-ai/* is either a module-table
 * entry (external) or a leak the purity gate rejects.
 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** A rolldown plugin as tsdown's config accepts it (contextual `this` for load/resolveId). */
type BuildPlugin = NonNullable<UserConfig['plugins']>

/** The client-bundle purity gate (see the clientBundle doc). */
function purityGatePlugin(): BuildPlugin {
  return {
    name: 'dsh-better-tools-client-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
      if (INLINE_SAFE.test(source)) return null // wire/type layer: inline is the point
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) and not an inline-safe wire layer — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

export default [
  // ── Host half: ESM node bundle. ──────────────────────────────────────────
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // ── Client half: browser bundle registered under the package name. ──────
  // The `id` MUST equal package.json `name` — the client-modules compose keys
  // on the package name.
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    // External wins for module-table entries; every other dependency inlines
    // (the reference repo's `external`/`noExternal` pair — renamed by tsdown
    // to `deps.neverBundle`/`deps.alwaysBundle`).
    deps: {
      neverBundle: (id: string) => CLIENT_EXTERNALS.includes(id),
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'import.meta.resolve': 'undefined',
    },
    // CJS output otherwise makes some transitive packages resolve their Node
    // entry even though this bundle runs in the browser. Keep browser
    // conditional exports authoritative for both source import() and
    // generated require() edges.
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    // External wins for module-table entries; every other dependency inlines
    // (see `deps` above).
    plugins: [purityGatePlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: "dsh-better-tools", factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // The CJS wrapper factory's `require` only resolves module-table entries
      // (react, cordis, ...); it cannot load relative chunk URLs in the browser.
      // Disable code splitting so the artifact is one script.
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
