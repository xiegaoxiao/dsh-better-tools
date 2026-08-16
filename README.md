# dsh-better-tools

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">一个「better shell」双半插件：侧边栏 Shell 偏好开关 + Git Bash 终端卡片</b><br /><br />
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://www.npmjs.com/package/dsh-better-tools"><img alt="npm" src="https://img.shields.io/npm/v/dsh-better-tools" /></a>
  <img alt="Shell 偏好" src="https://img.shields.io/badge/-Shell%20偏好-4d6bfe" /> <img alt="侧边栏按钮" src="https://img.shields.io/badge/-侧边栏按钮-4d6bfe" /> <img alt="Git Bash 终端卡片" src="https://img.shields.io/badge/-Git%20Bash%20终端卡片-4d6bfe" /> <img alt="全局生效" src="https://img.shields.io/badge/-全局生效-4d6bfe" /><br /><br />
  <b>侧边栏独立入口 + 设置式弹窗</b>，一键切换 Agent 的 shell 偏好（Git Bash / PowerShell / 关闭），<br />
  并内置**全局真实 Git Bash 工具**（`gitbash`），任何预设/模式下都有与官方 <code>pwsh</code> 同款的可点击终端卡片。
</div>

## ✨ 功能一览

- **🧰 侧边栏入口**：`sidebar.footer.action` 槽注册的设置式按钮（官方拼图图标，与设置按钮同款风格），收起侧边栏时自动变圆形图标
- **⚙️ Shell 优先开关**：点击弹设置式居中弹窗，三个选项——关闭 / Git Bash / PowerShell；点选即写入 DSH 设置文档（`better-tools.shell`，默认 `gitbash`）
- **🌏 全局生效**：host 注册的全局系统提示段落**实时读设置**——无论选择哪个 Agent 预设 / 模式，所有会话的模型都被指示优先使用所选 shell，切换后下一个模型步骤即生效
- **📺 Git Bash 终端卡片**（**全局 `gitbash` 工具**）：插件在 host 注册真实 Git Bash 工具（经 `ctx.subprocess` 直接 spawn、非沙箱），**任何预设/模式**可用；与官方 `pwsh` 一样显示可点击终端卡片（命令标题、cwd 头部、实时输出、退出码徽标）
- **🔌 服务化**：宿主服务 `ctx.betterTools`、模型工具 `better_tools_ping`、JSON 路由 `/better-tools/api/ping`、`/better-tools/api/shell`（GET 读 / PUT 写）
- **⚡ 零侵入**：不修改 DSH 源码，靠 `dsh.bundle.patch` + profile bundles 一条命令自动挂载

> 🔌 **两个平面**：插件（host/client 双半，npm 包）提供侧边栏、全局偏好与**全局 `gitbash` 工具**（真实 Git Bash，任何预设可用）；`cordis-gitbash` 预设（agent preset）提供技能目录与预设体验。两者正交、分别部署，安装指南见 [install.md](./install.md)（AI 给 AI 的安装指南）。

## 🆕 最近更新

<small>v0.1.0</small>

> 📝 **说明**：首个发布版本。包含侧边栏 Shell 偏好开关、全局系统提示联动、`/better-tools/api/shell` 路由，以及 vendor 的 cordis-gitbash 预设（bash 终端卡片）。随包发布 4 个安装/部署脚本，支持跨机器一键部署。

| 功能 | 说明 |
|---|---|
| 🧰 侧边栏入口 | `sidebar.footer.action` 槽注册设置式按钮，居中弹窗展示宿主状态 + Shell 优先开关 |
| ⚙️ Shell 偏好 | `off / gitbash / pwsh`，持久化于 `better-tools.shell` 设置命名空间，全局 systemPrompt 实时联动 |
| 📺 Git Bash 终端卡片 | 全局 `gitbash` 工具（`ctx.subprocess` 直接 spawn）声明 `presentCall`/`presentResult`（`card: 'terminal'`），与 pwsh 同款；任何预设可用 |
| 🚀 跨机器分发 | 已发布 npm（`dsh-better-tools@0.1.0`）+ GitHub（`xiegaoxiao/dsh-better-tools`）；插件安装脚本 + 预设部署脚本随包 |

## 🚀 安装

**前置**：已装好 DSH（`dsh web` 能正常运行），Node.js ≥ 20，pnpm（`dsh plugin` 依赖）。

### ① 插件（侧边栏按钮 + Shell 偏好）

**macOS / Linux / Windows Git Bash**：

```sh
curl -fsSL https://raw.githubusercontent.com/xiegaoxiao/dsh-better-tools/main/scripts/install.sh | bash
```

**Windows（PowerShell 5.1+ / pwsh）**：

```powershell
irm https://raw.githubusercontent.com/xiegaoxiao/dsh-better-tools/main/scripts/install.ps1 | iex
```

等价手动命令：

```sh
dsh plugin --profile web add dsh-better-tools
```

装完**重启 `dsh web`**（host 半改动生效），硬刷新浏览器（Cmd/Ctrl+Shift+R）。

### ② cordis-gitbash 预设（技能 + 预设体验）

插件已内置全局 `gitbash` 工具，终端卡片**不依赖**预设；部署预设是为了获得 cordis-gitbash 的技能目录与预设体验。

```sh
# Git Bash / macOS / Linux（从 npm 安装的包内直接调用）
bash ~/.dsh/profiles/web/node_modules/dsh-better-tools/scripts/install-preset.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File `
  "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-better-tools\scripts\install-preset.ps1"
```

已存在同目录会先带时间戳备份。预设按**会话**加载：新开会话（选 `cordis-gitbash`）即生效，无需重启。

<details>
<summary><b>脚本内部做了什么（技术细节）</b></summary>

- `install.sh` / `install.ps1`：执行 `dsh plugin --profile web add dsh-better-tools`——登记依赖 → 识别包内 `dsh.bundle.patch` → 自动注册进 `dsh.profile.bundles`；幂等可重复执行。
- `install-preset.sh` / `install-preset.ps1`：把包内 vendor 的 `presets/cordis-gitbash/` 拷贝到 `$DSH_HOME/.agent-presets/cordis-gitbash/`；已存在先备份（`.bak-<时间戳>`）。
- `curl | bash` / `irm | iex` 会执行远程代码——脚本已随仓库开源（`scripts/`），可先下载审阅。

</details>

<details>
<summary><b>从源码安装 / 开发（可选，替代 npm 方式）</b></summary>

```text
1. git clone https://github.com/xiegaoxiao/dsh-better-tools.git && cd dsh-better-tools
   npm install && npm run build
2. ~/.dsh/profiles/web/package.json 的 dependencies 写 "dsh-better-tools": "link:<克隆目录绝对路径>"
3. ~/.dsh/profiles/web/cordis.patch.yml 追加挂载行：
   - insert:
       - id: better-tools
         name: 'dsh-better-tools'
4. 在 ~/.dsh/profiles/web 执行 pnpm install
5. 重启 dsh web，硬刷新浏览器
```

更新：`git pull && npm install && npm run build` → 重启 dsh web。切回 npm 通道时把依赖改回 `"dsh-better-tools": "^0.1.0"` 再 `pnpm install`。

</details>

<details>
<summary><b>更新与回滚</b></summary>

```sh
# 更新插件
dsh plugin --profile web add dsh-better-tools

# 回滚插件
dsh plugin --profile web remove dsh-better-tools

# 回滚预设（或从 .bak-<时间戳> 恢复旧版）
rm -rf ~/.dsh/.agent-presets/cordis-gitbash
```

移除插件后重启 `dsh web` 生效。

</details>

<details>
<summary><b>常见问题</b></summary>

| 现象 | 原因与解决 |
|---|---|
| 报 `Ignored build scripts` | pnpm 11 拦截构建脚本。跑 `pnpm approve-builds --all`。 |
| 报 `minimum release age` / 版本不足 24h | 装的版本发布不足 24 小时。等 24h 或重跑。 |
| 侧边栏没有按钮 / 弹窗显示 `host error: HTTP 404` | host 半没挂上。重启 `dsh web`；检查 profile `cordis.patch.yml` 无旧手动挂载行。 |
| 弹窗提示 `设置读写失败` | 用 `curl http://127.0.0.1:3080/better-tools/api/shell` 定位路由；PUT 返回 `not registered` 说明服务器还在跑旧 host 半，需重启。 |
| bash 卡片仍不可点击 | 预设未部署或还在旧会话。执行安装 ② 并新开会话。 |
| macOS / Linux 上提示「优先 Git Bash」 | 默认偏好是 `gitbash`（Windows 语义）。在弹窗里切到「关闭」。 |

</details>

## 🔌 服务化 / 能力

| 能力 | 位置 | 说明 |
|---|---|---|
| 宿主服务 `ctx.betterTools` | `src/index.ts` | `ping()` 健康探针，供其他插件消费 |
| 模型工具 `better_tools_ping` | `src/index.ts` | 演示工具，所有会话可用 |
| 路由 `/better-tools/api/ping` | `src/index.ts` | 宿主健康 JSON |
| 路由 `/better-tools/api/shell` | `src/index.ts` | `GET` 读偏好、`PUT` 写偏好（枚举校验） |
| 设置命名空间 `better-tools.shell` | `src/index.ts` | schemastery 枚举 `off/gitbash/pwsh`，默认 `gitbash` |
| 全局 systemPrompt 段落 | `src/index.ts` | 变量实时读设置，注入每个会话 |
| 侧边栏按钮 + 弹窗 | `src/client/index.tsx` | `sidebar.footer.action` 槽 + 设置式 modal |

接入文档：[`AGENTS.md`](./AGENTS.md)（仓库内维护）· [`install.md`](./install.md)（AI 给 AI 的安装指南）。

## 🛠️ 开发与构建

```sh
npm install      # @deepseek-ai/* 已发布到 npm，直接解析
npm run typecheck  # tsc --noEmit
npm run build    # → lib/index.js（host ESM）+ lib/client.js（client CJS）+ lib/types
npm run watch    # tsdown --watch
```

**架构**：单 npm 包、host/client 双半结构——host（`src/index.ts`）：服务 + 设置命名空间 + 全局 systemPrompt + 工具 + `/better-tools/api/*` 路由；client（`src/client/index.tsx`）：侧边栏按钮 + 设置式弹窗。client 半只消费平台模块表（react / cordis / `@deepseek-ai/dsh-client-*`），跨插件协作走 cordis 服务与自有 HTTP 路由，构建期 `purityGatePlugin` 固化该纪律。

## 🔐 安全

- `/better-tools/api/shell` 的 `PUT` 会写设置文档；真实部署建议套上与官方 `/api` 一致的浏览器信任围栏（当前为演示性开放路由）
- 全局 `gitbash` 工具与预设内 `bash` 工具均**非沙箱**（Git Bash 无法在 harness 文件沙箱下启动），仅建议在可信环境使用；`pwsh` 保持沙箱

## ⚠️ 已知限制

- 设置命名空间 `better-tools` **不在** `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` allowlist（该表在 DSH 源码内，插件无法扩展）→ client 不读官方设置通道，走插件自有 `/better-tools/api/shell` 路由
- `settings` / `systemPrompt` 必须顶层硬注入；`settings.register()` 返回 scope 对象而非 effect disposer（详见 `AGENTS.md`）
- Shell 偏好默认 `gitbash` 是 Windows 语义；macOS / Linux 建议切「关闭」
- 插件与预设是两个平面：装插件不会自动部署预设，需分别执行安装 ① ②

## 🖥️ 平台支持

Windows 为主目标（`gitbash` 工具与预设依赖真实 Git Bash）；macOS / Linux 可安装插件（`gitbash` 偏好建议关闭）。跨机器部署链路：npm 发布 + GitHub raw 一键脚本，均已在 Windows 验证。

## 🔗 链接

- [install.md](./install.md)——AI 给 AI 的安装指南（含前置检查、预期输出、故障排查、回滚）
- [AGENTS.md](./AGENTS.md)——仓库接入文档（架构、扩展、踩坑记录）
- [GitHub 仓库](https://github.com/xiegaoxiao/dsh-better-tools)
- [npm 包](https://www.npmjs.com/package/dsh-better-tools)
