# =============================================================================
# dsh-better-tools 一键安装脚本（Windows PowerShell 5.1+ / pwsh）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add dsh-better-tools@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）：CLI 的 bundle 协调会把它
# 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载——无需手动写
# cordis.patch.yml 挂载行。符合仓库硬约束：不修改 DSH 源码。
#
# 用法（远端直取）：
#   irm https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.ps1 | iex
# 或本地：
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1 [-Version 0.1.0] [-Restart] [-DryRun]
# =============================================================================
param(
  [string]$Version = "",
  [switch]$Restart,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$PKG = 'dsh-better-tools'

function Say  { Write-Host "[install] $args" -ForegroundColor Green }
function Warn { Write-Host "[warn]   $args" -ForegroundColor Yellow }
function Die  { Write-Host "[error]  $args" -ForegroundColor Red; exit 1 }

# 定位 dsh CLI：PATH 上的 dsh 优先，否则经 npx 拉官方包
function Get-DshCli {
  if (Get-Command dsh -ErrorAction SilentlyContinue) { return 'dsh' }
  if (Get-Command npx -ErrorAction SilentlyContinue) { return 'npx -y --package @deepseek-ai/dsh dsh' }
  Die '未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用）。'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die '未找到 node（DSH 运行需要 Node.js ≥ 20）。'
}

$dsh = Get-DshCli
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
$spec = if ($Version) { "$PKG@$Version" } else { $PKG }

Say "目标 profile: $profileDir"
Say "将执行: $dsh plugin --profile web add $spec"
if ($DryRun) { Say '(--DryRun) 以上为将要执行的操作，未做任何修改。'; exit 0 }

Invoke-Expression "$dsh plugin --profile web add $spec"
if ($LASTEXITCODE -ne 0) {
  Die "dsh plugin 执行失败（exit code $LASTEXITCODE）。若是 pnpm 构建脚本被拦，先在该 profile 运行: pnpm approve-builds --all"
}

Say '安装完成。请硬刷新浏览器（Ctrl+Shift+R）。'
Say '验证:'
Say '  1. 页面左下角出现 🧰 dsh-better-tools 小徽标（client half 已挂载，host ping 显示 green）；'
Say '  2. 任意会话可用 better_tools_ping 工具（host half 已挂载）。'

if ($Restart) {
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say '重启 dsh-web：pm2 restart dsh-web'
    pm2 restart dsh-web
  } else {
    Warn '--Restart 需要 pm2；未检测到 pm2，请自行重启 dsh web 服务。'
  }
}
