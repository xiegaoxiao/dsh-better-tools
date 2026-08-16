# dsh-better-tools

DSH (DeepSeek Harness) 双半插件 + vendor 的 agent 预设，打包为一个 npm 包，提供统一的「better shell」体验。

本仓库面向 **AI 维护者**：本文档是技术事实与操作命令，不含用户向宣传。**安装/部署请走 `install.md`**（AI 给 AI 的安装指南）。

## 1. 组件与平面

| 组件 | 平面 | 源码 | 分发 |
| --- | --- | --- | --- |
| host 半 | host 组合（profile bundle） | `src/index.ts` | npm 包 |
| client 半 | web shell | `src/client/index.tsx` | npm 包 |
| cordis-gitbash 预设 | agent preset | `presets/cordis-gitbash/` | npm 包内 vendor 副本 |

- **host 半**：进程级、全会话共享（服务/工具/路由/全局提示）。
- **client 半**：浏览器 web shell 内，只消费模块表。
- **预设**：按会话加载；与插件正交，可独立部署。

## 2. 能力清单（事实）

- 侧边栏 `sidebar.footer.action` 槽注册一个设置式按钮（官方 `IconCordisPluginOutline14`），点击弹出居中 modal。
- modal 内含：宿主状态（ping `/better-tools/api/ping`）+ **Shell 优先**开关（`off | gitbash | pwsh`），读写 `/better-tools/api/shell`。
- host 注册设置命名空间 `better-tools.shell`（schemastery 枚举，默认 `gitbash`），持久化于用户设置文档。
- host 注册**全局** systemPrompt 段落 + 变量：每次模型步组装时实时读设置 → **无论预设/模式，所有会话**的 Agent 都被指示优先用所选 shell。
- 工具 `better_tools_ping`（演示用）。
- vendor 的预设内 `bash` 工具（真实 Git Bash、非沙箱）通过 `presentCall`/`presentResult` 声明 `card: 'terminal'`，与官方 `pwsh` 一样渲染可点击终端卡片。

## 3. 挂载机制

```
dsh plugin --profile web add dsh-better-tools
  └─ pnpm add（装进 profile）
      └─ reconcile dsh.profile.bundles（发现 dsh.bundle.patch 声明 → 追加进 bundles）
          └─ profile boot 合成（bundles 的 cordis.patch.yml 叠 + profile 自己的）
              └─ insert better-tools 行 → host 组合；dsh.client → client 半
```

关键声明：`package.json → dsh.bundle.patch`（`./cordis.patch.yml`）、`dsh.client`（`platform: web` + inject 包列表）；`cordis.patch.yml` 只有一行 `insert { id: better-tools, name: 'dsh-better-tools' }`。client 产物首行必须是 `window.__ModuleLoader__.load({ id: "dsh-better-tools", ... })`（`id` == `package.json name`）。

## 4. 硬约束与踩坑记录（改代码前必读）

- **零写入 DSH 源码**；挂载只走 bundle 机制。
- **client 半禁值导入其他插件代码**：只准 `require` 模块表条目（react / react-dom / cordis / `@deepseek-ai/dsh-client-*` 平台包）。`tsdown.config.ts` 的 `CLIENT_EXTERNALS` + `purityGatePlugin` 固化该纪律。
- **`better-tools` 命名空间不在 `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` allowlist**（无法改 DSH 源码添加）→ web client 走官方 `api.settings` 会被 `settings-not-exposed` 拒；本插件改走**自有路由** `/better-tools/api/shell` 中转 host 的 `ctx.settings`。
- **settings / systemPrompt 必须顶层硬注入**（`export const inject = ['webServer','tools','settings','systemPrompt']`）。在 `apply` 里嵌套 `ctx.inject(['settings'], cb)` 实测不可靠（注册不落地）。
- **`settings.register()` 返回值是 scope 对象**（`{get,watch,update,replace}`），**不是** effect disposer——绝不能在 `ctx.effect(() => settings.register(...))` 里 return 它，否则 cordis 抛 `Invalid effect` 且后续 effect 全被打断。
- `src/context-types.ts` 必须零 Node 依赖（client 可达声明图）。

## 5. 仓库地图

| 路径 | 角色 |
| --- | --- |
| `src/index.ts` | host 半：服务、设置命名空间、systemPrompt 段落、工具、`/better-tools/api/*` 路由 |
| `src/client/index.tsx` | client 半：侧边栏按钮 + modal（宿主状态 + Shell 优先） |
| `src/context-types.ts` | cordis Context 增强（双半共享、零 Node 依赖） |
| `cordis.patch.yml` | bundle 挂载补丁（唯一 insert 行） |
| `tsdown.config.ts` | host ESM + client CJS 双产物构建 |
| `presets/cordis-gitbash/` | vendor 的预设（agent.cordis.yml、tool-gitbash-v2.mjs、skills） |
| `scripts/install*.{sh,ps1}` | 插件安装 + 预设部署 |
| `install.md` | AI 给 AI 的安装指南 |
| `AGENTS.md` | 本仓库接入文档（开发向） |

## 6. 构建 / 类型检查 / 产物门槛

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # lib/index.js（host ESM）+ lib/client.js（client CJS）+ lib/types
```

验收门槛（改动后人工核对）：

- [ ] `lib/client.js` 首行 `window.__ModuleLoader__.load({ id: "dsh-better-tools", ... })`
- [ ] `lib/client.js` 无 `require("node:...")` / 非平台 `@deepseek-ai/*` 值导入
- [ ] `lib/index.js` 外部化 `@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等（运行时从 profile/回退目录解析）
- [ ] `dsh --profile web --dump-config` 组合树含 `better-tools` 行

## 7. 发布

```bash
npm run build
npm publish --otp <6位码>   # 账号开 2FA 时；或配置 bypass-2FA 的 granular token
```

发布前 `npm publish --dry-run` 核对 tarball 内容（22 文件：lib、presets、scripts、src、文档）。

## 8. 安装 / 部署

见 `install.md`（含前置检查、逐步命令、预期输出、故障排查、回滚）。速览：

- 插件：`dsh plugin --profile web add dsh-better-tools`，装完**重启 `dsh web`**。
- 预设：`bash ~/.dsh/profiles/web/node_modules/dsh-better-tools/scripts/install-preset.sh`，新会话生效。

## 9. 许可

MIT。
