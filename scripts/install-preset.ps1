# =============================================================================
# dsh-better-tools 预设部署脚本（Windows PowerShell 5.1+ / pwsh）
#
# 把仓库/NPM 包内 vendor 的 cordis-gitbash 预设部署到本机 DSH 用户根：
#   <package>/presets/cordis-gitbash  →  $DSH_HOME/.agent-presets/cordis-gitbash
#
# 该预设包含：
#   - agent.cordis.yml          预设组合（含 Git Bash 工具、提示段落、skills）
#   - tool-gitbash-v2.mjs       自定义 Git Bash 工具（带终端卡片渲染，同 pwsh）
#   - skills/                   配套技能目录
#
# 部署后**新会话**即生效（预设按会话加载，无需重启 dsh web）。
#
# 用法（Windows）：
#   powershell -ExecutionPolicy Bypass -File scripts/install-preset.ps1 [-DryRun]
# 从 npm 安装的包内直接调用：
#   powershell -ExecutionPolicy Bypass -File `
#     "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-better-tools\scripts\install-preset.ps1"
# =============================================================================
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$PRESET_ID = 'cordis-gitbash'

function Say  { Write-Host "[preset] $args" -ForegroundColor Green }
function Warn { Write-Host "[warn]   $args" -ForegroundColor Yellow }
function Die  { Write-Host "[error]  $args" -ForegroundColor Red; exit 1 }

$Src = Join-Path $PSScriptRoot "..\presets\$PRESET_ID"
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$Target = Join-Path $DshHome ".agent-presets\$PRESET_ID"

if (-not (Test-Path $Src)) { Die "未找到预设源目录: $Src" }

Say "预设源:   $Src"
Say "部署目标: $Target"
if ($DryRun) { Say '(--DryRun) 以上为将要执行的操作，未做任何修改。'; exit 0 }

# 已存在则先备份（时间戳后缀），避免覆盖丢失本地改动
if (Test-Path $Target) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bak = "$Target.bak-$stamp"
  Rename-Item $Target $bak
  Warn "已备份现有预设到 $bak"
}

New-Item -ItemType Directory -Force -Path (Split-Path $Target -Parent) | Out-Null
Copy-Item $Src $Target -Recurse -Force
if (-not (Test-Path (Join-Path $Target 'agent.cordis.yml'))) {
  Die "部署校验失败：目标目录缺少 agent.cordis.yml"
}

Say "部署完成 → $Target"
Say '新开会话（选择 cordis-gitbash 预设）即生效；无需重启 dsh web。'
Say '验证：新会话里让 AI 执行 bash 命令，应显示与 pwsh 相同的可点击终端卡片。'
