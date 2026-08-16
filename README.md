# dsh-better-tools：DSH 双半插件脚手架（host/client dual-half）

一个**最小可用的 DeepSeek Harness (DSH) Web 插件脚手架**，复刻 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的架构——单一 npm 包、**host/client 双半结构**、靠 `dsh.bundle.patch` + profile bundles 自动挂载，**不修改 DSH 源码**。

它演示了宿主插件三种典型的贡献方式 + 客户端插件一种：

| 半边 | 贡献 | 文件 |
| --- | --- | --- |
| **host 半** | 提供 `ctx.betterTools` 服务 | `src/index.ts` |
| **host 半** | 注册模型工具 `better_tools_ping`（所有会话可用） | `src/index.ts` |
| **host 半** | 挂载 JSON 路由 `/better-tools/api/ping` | `src/index.ts` |
| **client 半** | 页面左下角挂一个小 React 徽标，并 ping host 路由验证 host↔client 回路 | `src/client/index.tsx` |

装好后打开任意 DSH 会话：左下角出现 **🧰 dsh-better-tools v0.1.0** 徽标（绿 = host 回路正常），模型还能调用 `better_tools_ping` 工具。

## 为什么做这个脚手架

你的另一个仓库 [cordis-gitbash](https://github.com/xiegaoxiao/dsh-preset-standard-gitbash) 用的是 **Agent preset**（按会话挂载的提示词/工具），而 DSH 还有第二种完全正交的扩展平面：**host 插件 / profile bundle**——进程级、全会话共享，能给整个 `dsh web` 加 host 服务、路由和客户端 UI。DSH-better-sidebar 就是这类插件的代表作。

这个仓库把那条架构路径压成最小可跑的形式，让你（或 AI）能照着抄着扩展，不用从零啃 DSH-better-sidebar 那 300+ 行 tsdown 配置和几十个源文件。

## 挂载架构（为什么一条命令就能装上）

DSH 官方 `dsh plugin` 命令 = **pnpm 转发器 + bundles 协调器**：

1. `dsh plugin --profile web add dsh-better-tools`
   - 在 `~/.dsh/profiles/web/` 里执行 `pnpm add dsh-better-tools`（装进 profile 的 `package.json` + `node_modules`）
2. **协调 `dsh.profile.bundles`**：pnpm 装完后扫描 profile 依赖，凡是 `package.json` 里声明了 `dsh.bundle.patch` 的包，自动追加进 `bundles` 层栈并写回清单
3. **启动时 profile boot 合成**：把 `bundles` 里每个包的 `cordis.patch.yml` 按序叠起来 + profile 自己的 `cordis.patch.yml` → 生成最终 loader entry 列表 → `insert` 那一行 `better-tools` 就把插件挂进 **host 组合**；同时 `dsh.client` 声明让 client 半被 web shell 组合

关键声明（都在本仓库里）：

- `package.json`：
  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-runtime", ...], "platform": "web" }
  }
  ```
- `cordis.patch.yml`（bundle 挂载层）：
  ```yaml
  - insert:
      - id: better-tools
        name: 'dsh-better-tools'
  ```

client 半的产物 `lib/client.js` 由构建时包装成 web shell 认识的注册协议：

```js
window.__ModuleLoader__.load({ id: "dsh-better-tools", factory: (require) => { ... } })
```

`id` 必须等于 `package.json` 的 `name`（client-modules 按包名组合模块表）。

## 与 cordis-gitbash（Agent preset）的区别

| 维度 | cordis-gitbash（Agent preset） | 本仓库（host 插件 / bundle） |
| --- | --- | --- |
| 扩展平面 | **preset 层**，按会话挂载 | **host 组合层**，进程级、全会话共享 |
| 挂载点 | `~/.dsh/.agent-presets/cordis-gitbash/` | `~/.dsh/profiles/web/`（npm 包） |
| 挂载方式 | 复制目录 + GUI 模式选择器选中 | `dsh plugin --profile web add dsh-better-tools` |
| 贡献 | 会话的提示词/工具/技能 | host 服务 + 路由 + 客户端 UI |
| 生命周期 | 随会话，可每会话选不同模式 | 常驻，所有会话生效 |
| 生效 | 新会话即生效 | 硬刷新浏览器（client 半热加载）；host 半改动重启 |

两者可共存：preset 决定「Agent 会话用什么能力干活」，host 插件决定「web 应用有什么能力/长相」。

## 目录结构

```
dsh-better-tools/
├── package.json           # dsh.bundle.patch + dsh.client 声明、peer/dev 依赖
├── cordis.patch.yml       # bundle 挂载补丁（唯一 insert 行）
├── tsconfig.json          # 类型检查（tsc --noEmit）
├── tsconfig.build.json    # 声明产物（lib/types/*.d.ts）
├── tsdown.config.ts       # host ESM + client CJS 双产物构建
├── src/
│   ├── context-types.ts   # 结构化的 cordis Context 增强（双半共享，零 Node 依赖）
│   ├── index.ts           # host 半：服务 + 工具 + 路由
│   └── client/
│       └── index.tsx      # client 半：React 徽标 + host ping
├── scripts/
│   ├── install.sh         # 一键安装（macOS / Linux / Git Bash）
│   └── install.ps1        # 一键安装（Windows PowerShell）
├── AGENTS.md              # 面向 AI / 插件开发者的接入文档
└── README.md              # 本文件
```

## 安装

**前置**：DSH 能跑（`dsh web` 正常）、Node ≥ 20、pnpm（`dsh plugin` 依赖 pnpm 在 PATH 上）。

```bash
# macOS / Linux / Windows Git Bash
curl -fsSL https://raw.githubusercontent.com/<owner>/dsh-better-tools/main/scripts/install.sh | bash

# Windows（PowerShell 5.1+ / pwsh）
irm https://raw.githubusercontent.com/<owner>/dsh-better-tools/main/scripts/install.ps1 | iex
```

等价手动命令（与一键脚本一致）：

```bash
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add dsh-better-tools
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）。client 半改动热加载无需重启；仅 host 半改动需重启 `dsh web`。

> 从源码安装（开发用）：`git clone` 后 `npm install && npm run build`，把 `~/.dsh/profiles/web/package.json` 的依赖写 `"dsh-better-tools": "link:<克隆目录绝对路径>"`，并在该 profile 的 `cordis.patch.yml` 追加 `- insert: [{ id: better-tools, name: 'dsh-better-tools' }]`，然后 `pnpm install`。

## 验证

1. **client 半**：页面左下角出现 🧰 徽标；徽标第三行显示 host ping 结果：
   - 绿 `host: dsh-better-tools@0.1.0` → host↔client 回路通
   - 红/黄 → 见「常见问题」
2. **host 半工具**：任意会话让 Agent 调用 `better_tools_ping`，返回 `{ ok: true, plugin: "dsh-better-tools", version: "0.1.0", echo: "pong" }`
3. **host 半路由**：浏览器开 `http://127.0.0.1:3080/better-tools/api/ping`，返回 `{"ok":true,"name":"dsh-better-tools","version":"0.1.0","time":...}`

## 开发与构建

```bash
npm install        # @deepseek-ai/* 已发布到 npm（^0.1.0-rc.6），直接解析
npm run typecheck  # tsc --noEmit
npm run build      # 产物 lib/index.js（host ESM）+ lib/client.js（client CJS）+ lib/types
npm run watch      # tsdown --watch
```

**构建要点**（详见 `tsdown.config.ts` 注释）：

- host 半是普通 Node ESM，`@deepseek-ai/*` 作为 peer 外部化，运行时从 profile 的 node_modules 解析；
- client 半是浏览器 CJS 闭包工厂，**只准**消费平台模块表条目（react / react-dom / cordis / @deepseek-ai 平台包），其余依赖内联；`purityGatePlugin` 在构建期拒绝任何其他 `@deepseek-ai/*` 值导入——跨插件协作走 cordis 服务，绝不做值导入（type-only 导入会被擦除，不触发门禁）。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 报 `Ignored build scripts` | pnpm 11 拦构建脚本；跑 `pnpm approve-builds --all` |
| 报 `minimum release age` / 版本不足 24h | 装的版本发布不足 24h；等 24h 或重跑 |
| 徽标显示 `host error: HTTP 404` | host 半没挂上（可能双挂载或只装了 client）。检查 `~/.dsh/profiles/web/cordis.patch.yml` 是否有旧手动挂载行 |
| 页面出现两个徽标 | 双挂载：bundle 通道 + 手动挂载行同时存在；删掉 profile 里手写的 `better-tools` insert 行 |
| 找不到 profile 目录 | 先跑一次 `dsh web` 初始化 `~/.dsh/profiles/web` |

## 许可

MIT。
