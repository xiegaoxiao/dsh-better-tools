# install.md — AI 给 AI 的安装指南

> 阅读对象：**在目标机器上执行的 AI 代理**。本文是逐步操作指令：每步给出精确命令与预期输出，完成一步验证一步再继续。目标机器 = 一台新的 / 尚未装过本插件的 DSH 机器。
>
> 目标：让目标机器获得
> 1. **dsh-better-tools 插件**（host 服务 + 路由 + 侧边栏按钮 + Shell 优先开关 + 全局 shell 偏好提示）
> 2. **cordis-gitbash 预设**（自定义 Git Bash 工具，带与 pwsh 相同的可点击终端卡片）

## 0. 前置检查（全部通过才继续）

在目标机器执行并核对：

```bash
node --version        # 期望 ≥ 20（缺失 → 装 Node.js 并加入 PATH 后重试）
dsh --version         # 期望输出版本号（缺失 → 先装 DSH 并至少跑过一次 `dsh web`）
pnpm --version        # 缺失 → npm install -g pnpm（dsh plugin 依赖 pnpm）
```

`dsh web` 至少成功启动过一次（确保 `~/.dsh/profiles/web/` 已初始化）：

```bash
ls ~/.dsh/profiles/web/package.json   # 文件存在即 OK；否则先跑一次 `dsh web` 再 Ctrl+C
```

平台：主要目标 **Windows + Git Bash**（预设的 bash 工具依赖真实 Git Bash）。macOS/Linux 可装插件，但 `gitbash` 默认偏好建议改为 `off`。

## 1. 安装插件（npm）

```bash
dsh plugin --profile web add dsh-better-tools
```

预期：
- 输出 `+ dsh-better-tools@0.1.0`（或 `link:` 本地路径——开发安装时）
- 退出码 0

验证（三项都满足才算装好）：

```bash
node -e "const p=require(require('os').homedir()+'/.dsh/profiles/web/package.json'); console.log('dep:', p.dependencies?.['dsh-better-tools']); console.log('bundles:', p.dsh?.profile?.bundles)"
# 期望 dep 非空，且 bundles 数组包含 "dsh-better-tools"
```

若 pnpm 报 `Ignored build scripts`：进入 `~/.dsh/profiles/web` 跑 `pnpm approve-builds --all`，重跑上一条命令。

## 2. 重启 dsh web（host 半生效的必要步骤）

host 半改动**必须重启进程**，刷新页面不够。重启方式按部署形态：
- 手动终端：Ctrl+C 停掉当前 `dsh web`，重新运行 `dsh web`
- pm2：`pm2 restart dsh-web`

重启后确认进程在监听（默认 3080）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/` 期望 `200`。

## 3. 验证 host 半（路由 + 设置）

```bash
# ① ping 路由
curl -s http://127.0.0.1:3080/better-tools/api/ping
# 期望 {"ok":true,"name":"dsh-better-tools","version":"0.1.0","time":<ms>}

# ② shell 偏好读取（默认 gitbash）
curl -s http://127.0.0.1:3080/better-tools/api/shell
# 期望 {"ok":true,"shell":"gitbash","options":["off","gitbash","pwsh"]}

# ③ 写入（示例：切到 pwsh）
curl -s -X PUT -H "content-type: application/json" -d '{"shell":"pwsh"}' http://127.0.0.1:3080/better-tools/api/shell
# 期望 {"ok":true,"shell":"pwsh"}

# ④ 持久化确认
grep -A2 "better-tools:" ~/.dsh/settings.yaml   # 期望 shell: pwsh

# ⑤ 切回默认（可选）
curl -s -X PUT -H "content-type: application/json" -d '{"shell":"gitbash"}' http://127.0.0.1:3080/better-tools/api/shell
```

故障：`PUT` 返回 `settings namespace "better-tools" is not registered` → 服务器还在跑旧 host 半，回第 2 步重启；若重启后仍复现，检查 `dsh plugin` 是否真的把包装进 profile（第 1 步验证）。

## 4. 验证 client 半（UI）

- 浏览器打开 DSH GUI，**硬刷新**（Cmd/Ctrl+Shift+R）。
- 侧边栏底部（设置按钮旁）出现 🧰 图标按钮（官方拼图图标），点击弹出居中 modal。
- modal 内「宿主状态」显示 `host ok · dsh-better-tools@0.1.0`（绿）。
- modal 内「Shell 优先」三个选项可点选，点选后无报错（若显示 `设置读写失败` → 回到第 3 步排查路由）。

## 5. 部署预设（bash 终端卡片）

从 npm 安装的包内直接调用：

```bash
# Git Bash / macOS / Linux
bash ~/.dsh/profiles/web/node_modules/dsh-better-tools/scripts/install-preset.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File `
  "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-better-tools\scripts\install-preset.ps1"
```

或从仓库 clone：

```bash
git clone https://github.com/xiegaoxiao/dsh-better-tools
bash dsh-better-tools/scripts/install-preset.sh
```

预期：输出 `部署完成`；已存在同目录会先备份（`.bak-<时间戳>`）。

验证：

```bash
ls ~/.dsh/.agent-presets/cordis-gitbash/
# 期望出现：agent.cordis.yml  preset.yml  tool-gitbash-v2.mjs  skills/
grep -c "presentCall\|presentResult\|card: 'terminal'" ~/.dsh/.agent-presets/cordis-gitbash/tool-gitbash-v2.mjs
# 期望 ≥ 1（终端卡片渲染已包含）
```

## 6. 验证预设行为（端到端）

1. 在 DSH GUI **新建会话**，选择 `cordis-gitbash` 预设。
2. 让 Agent 执行一条 bash 命令（如 `ls`）。
3. 期望：会话中出现与 `pwsh` 相同的**可点击终端卡片**（命令标题、cwd 头部、输出、退出码徽标），不是纯文本卡片。
4. 若 Agent 仍显示「Shell 偏好」旧行为：新会话会重新加载预设与全局提示，无需重启；确认第 5 步部署与第 2 步重启已完成。

## 7. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `dsh plugin` 报 pnpm 不存在 | 缺 pnpm | `npm install -g pnpm` |
| `Ignored build scripts` | pnpm 拦构建脚本 | profile 目录跑 `pnpm approve-builds --all` |
| 侧边栏没有按钮 / 按钮显示 `host error: HTTP 404` | host 半没挂上 | 回第 2 步重启；检查 profile `cordis.patch.yml` 无旧手动挂载行（双挂载会出两个按钮） |
| PUT shell 返回 500 `not registered` | 服务器跑旧 host 半 | 重启；仍复现则检查 bundle 是否真在清单里 |
| 弹窗提示 `设置读写失败` | 路由或设置服务异常 | 用第 3 步 curl 逐项定位 |
| bash 卡片仍不可点击 | 预设未部署 / 旧会话 | 执行第 5 步并新开会话 |
| 版本发布 < 24h 安装报 `minimum release age` | npm 策略 | 等 24h 或重跑 |

## 8. 回滚

```bash
# 移除插件（卸载依赖并同步 bundles）
dsh plugin --profile web remove dsh-better-tools

# 移除预设（或从 .bak-<时间戳> 恢复旧版）
rm -rf ~/.dsh/.agent-presets/cordis-gitbash
```

移除插件后重启 `dsh web` 生效。
