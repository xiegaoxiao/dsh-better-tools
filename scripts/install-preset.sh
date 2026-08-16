#!/usr/bin/env bash
# =============================================================================
# dsh-better-tools 预设部署脚本（macOS / Linux / Windows Git Bash）
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
# 用法：
#   bash scripts/install-preset.sh [--dry-run]
# 环境变量：DSH_HOME（默认 ~/.dsh）
# =============================================================================
set -euo pipefail

PRESET_ID="cordis-gitbash"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../presets/$PRESET_ID"
DSH_HOME="${DSH_HOME:-${HOME:-${USERPROFILE:-}}/.dsh}"
TARGET="$DSH_HOME/.agent-presets/$PRESET_ID"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "用法: bash scripts/install-preset.sh [--dry-run]"
      echo "把 vendor 的 $PRESET_ID 预设部署到 \$DSH_HOME/.agent-presets/$PRESET_ID"
      exit 0
      ;;
    *) echo "未知参数: $arg（用 -h 查看帮助）" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[32m[preset]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$SRC" ] || die "未找到预设源目录: $SRC"

say "预设源:   $SRC"
say "部署目标: $TARGET"
[ "$DRY_RUN" = true ] && { say "（--dry-run）以上为将要执行的操作，未做任何修改。"; exit 0; }

# 已存在则先备份（时间戳后缀），避免覆盖丢失本地改动
if [ -e "$TARGET" ]; then
  BAK="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$TARGET" "$BAK"
  warn "已备份现有预设到 $BAK"
fi

mkdir -p "$DSH_HOME/.agent-presets"
cp -R "$SRC" "$TARGET"
[ -f "$TARGET/agent.cordis.yml" ] || die "部署校验失败：目标目录缺少 agent.cordis.yml"

say "部署完成 → $TARGET"
say "新开会话（选择 $PRESET_ID 预设）即生效；无需重启 dsh web。"
say "验证：新会话里让 AI 执行 bash 命令，应显示与 pwsh 相同的可点击终端卡片。"
