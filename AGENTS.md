# dsh-better-tools 接入文档

> 面向**本仓库的 AI / 插件开发者**：仓库在做什么、代码该往哪放、怎么扩展、有哪些硬约束。

## 0. 仓库硬约束

- **禁止修改 DeepSeek Harness (DSH) 源码**：对官方源码 checkout（`C:\Users\Pladin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` 等）零写入。插件永远作为独立 npm 包被 profile 引用。
- **挂载只走 `cordis.patch.yml` + profile bundle 机制**（`~/.dsh/profiles/<profile>/`），不反向侵入 DSH。
- **client 半禁值导入其他插件代码**：跨插件协作只走 cordis 服务（host 半）或 HTTP/WS 路由；type-only 导入可自由共享。
- **`lib/` 与 `node_modules/` 不入库**（`gitignore`），构建产物 `npm run build` 生成。

## 1. 架构速览：两个平面

DSH 的扩展有两个**正交平面**：

1. **Agent preset**（如你的 `cordis-gitbash`）：一个会话由哪些能力组成——提示词、工具、技能。按会话挂载，存在 `~/.dsh/.agent-presets/<id>/`。
2. **Host 组合 / profile bundle**（本仓库）：整个 web 应用的能力与长相——host 服务、路由、客户端 UI。进程级常驻，存在 `~/.dsh/profiles/web/`，作为 npm 包被 `dsh plugin add` 安装。

本仓库是**第 2 种**的最小实例。一个「host/client 双半插件」：

- **host 半**（`src/index.ts` → `lib/index.js`，Node ESM）：跑在 DSH 的 Node 进程里。可 `ctx.provide` 服务、`ctx.tools.register` 工具、`ctx.webServer.register` 路由。
- **client 半**（`src/client/index.tsx` → `lib/client.js`，浏览器 CJS 闭包）：跑在浏览器 web shell 里。挂 React UI、注册 slot、订阅状态。
- 两者不共享运行时符号：host 是进程内 API，client 通过插件自有 HTTP/WS 路由或 cordis 服务（client 半 `ctx.provide` 的跨客户端插件服务）交互。

## 2. 挂载机制（为什么 `dsh plugin add` 一条命令搞定）

```
dsh plugin --profile web add dsh-better-tools
  └─ pnpm add dsh-better-tools           # 装进 profile 的 package.json + node_modules
      └─ reconcile dsh.profile.bundles   # 发现 package.json 声明 dsh.bundle.patch →
                                         # 把 dsh-better-tools 追加进 bundles 层栈并写回
          └─ profile boot 合成           # 按 bundles 顺序叠每个包的 cordis.patch.yml +
                                         # profile 自己的 cordis.patch.yml → loader entries
              └─ insert better-tools 行  # host 半进 host 组合；dsh.client 声明 →
                                         # client 半被 web shell 组合（/plugins/<id>/client.js）
```

三层元数据各司其职：

| 文件 / 字段 | 作用 |
| --- | --- |
| `package.json → dsh.bundle.patch` | 告诉 CLI「我是 bundle 层，把我加进 bundles」 |
| `cordis.patch.yml` | bundle 层的实际补丁内容（唯一的 `insert` 行） |
| `package.json → dsh.client` | 告诉 client-modules「我有 client 半，`platform: web`，需要哪些包先激活」 |
| `src/client/index.tsx → export const inject` | 声明本 client 插件要注入的 **服务名**（区别于上面的**包名**边） |

> ⚠️ 平台模块表（web shell 提供）：client 半只能 `require` react、react-dom、cordis、`@deepseek-ai/dsh-client-*` 平台包等模块表种子词。`tsdown.config.ts` 的 `CLIENT_EXTERNALS` + `purityGatePlugin` 把这条纪律固化进构建。

## 3. 代码地图

| 文件 | 角色 | 改它做什么 |
| --- | --- | --- |
| `src/context-types.ts` | 结构化的 `Context` 增强（`declare module 'cordis'`） | 新增/修改服务面、工具注册、slot 用法时同步这里 |
| `src/index.ts` | host 半 | 加 host 服务、模型工具、Web 路由 |
| `src/client/index.tsx` | client 半 | 加客户端 UI、slot 注册、状态订阅 |
| `cordis.patch.yml` | bundle 挂载行 | 一般不动 |
| `tsdown.config.ts` | 双产物构建 | 加 client 依赖 / 懒加载 chunk 时改 |
| `package.json` | 包清单 + `dsh.*` 声明 | 加 peer/dev 依赖、bump 版本 |

`src/context-types.ts` **必须是零 Node 依赖**（client 可达声明图）：不要 `import 'node:http'` 之类，HTTP 面用结构化接口（`BetterToolsHttpRequest/Response`）。

## 4. 如何扩展

### 4.1 加一个模型工具（host 半）

在 `src/index.ts` 里再 `ctx.effect(() => ctx.tools.register(defineTool({ ... })))` 一段。要点：

- `parameters` 里**可选字段省略 `required`**（dsh-tools 约定：只写 `required: true`，缺省即可选——`required: false` 会类型报错）；
- `output.schema` 的必填字段写 `required: true`；`render(args, value): ContentBlock[]` 是纯文本投影，规范值留在 `execute` 的返回值；
- 真实插件要把工具**绑定到调用会话**：`execute` 第二参 `exec` 上的 `exec.agent.session.id` 作为作用域（参考 DSH-better-sidebar 的 `terminal_*` 工具）。

### 4.2 加一个 Web 路由（host 半）

`ctx.webServer.register({ kind: 'prefix', path: '/better-tools/xxx', handler })`。真实插件要套 DSH-better-sidebar 那套浏览器信任围栏（`trust-fence.ts`），并且所有操作按 `sessionId` 限定在会话 cwd 内。

### 4.3 加 host 服务（host 半）

`ctx.effect(() => ctx.provide('betterTools', { ... }))`。其他插件 `inject: ['betterTools']` 即可消费；client 半不能直接读 host 服务——通过 `/better-tools/api/*` 路由中转。

### 4.4 加客户端 UI / slot（client 半）

- 最简单：在 `src/client/index.tsx` 里再挂一个 portal 根（本仓库 `StatusWidget` 就是例子）；
- 正规：`ctx.slots.register({ name: 'xxx.slot', ... }, Component)`——**必须先确认该 slot 已声明**（`ctx.slots.snapshot()` 可查），注册进未声明 slot 会在加载期 throw；
- 状态订阅用 client runtime 的 `sessions` / `connection` 等服务的 `getSnapshot() + subscribe()`（uSES 模式）。

### 4.5 加新的 `@deepseek-ai/*` 平台包依赖

- 加到 `package.json` 的 `peerDependencies`（运行期从 profile 解析，避免重复实例化）；
- client 半**用到它的值**时，把它加进 `tsdown.config.ts` 的 `CLIENT_EXTERNALS`；
- 只当类型用（`import type`）则不用加——会被擦除、不触发纯度门。

## 5. 构建与验收门

```bash
npm run typecheck   # tsc --noEmit：结构类型 + 无 Node 泄漏进 client 声明图
npm run build       # 产物：lib/index.js + lib/client.js(+map) + lib/types/*.d.ts
```

验收清单（改动后人工核对）：

- [ ] `lib/client.js` 首行是 `window.__ModuleLoader__.load({ id: "dsh-better-tools", ... })`（`id` 与 `package.json name` 一致）
- [ ] `lib/client.js` 里没有 `require("node:...")` 或非平台 `@deepseek-ai/*` 值导入
- [ ] `lib/index.js` 外部化 `@deepseek-ai/dsh-tools`（运行时从 profile 解析）
- [ ] 真实挂载后：左下角徽标 green、`better_tools_ping` 工具可用、`/better-tools/api/ping` 返回 JSON

## 6. 参考

- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)——本仓库架构的完整工业版（懒加载 chunk、settings 命名空间、WebSocket、信任围栏、服务化基座）。
- DSH 官方源码（只读参考）：`C:\Users\Pladin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\`（`lib/plugin-*.js` 的 bundle 协调、`node_modules/@deepseek-ai/dsh-client-modules` 的 client 组合、`dsh-host-webserver` / `dsh-tools` / `dsh-client-runtime` 的类型）。
