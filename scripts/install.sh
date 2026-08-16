#!/usr/bin/env bash
# =============================================================================
# dsh-better-tools 一键安装脚本（官方 CLI 方式，macOS / Linux / Windows Git Bash）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add dsh-better-tools@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）：CLI 的 bundle 协调会把它
# 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载——无需手动写
# cordis.patch.yml 挂载行。符合仓库硬约束：不修改 DSH 源码，插件永远作为
# 独立包被 profile 引用。
#
# 用法：
#   bash scripts/install.sh [版本] [--restart] [--dry-run]
#
#   版本         npm 版本号/范围，缺省为 latest。示例：0.1.0、^0.1.0、latest
#   --restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅打印提示）
#   --dry-run    只打印将要执行的操作，不写任何文件
#   -h/--help    打印本帮助
#
# 环境（均可省略，脚本会自动探测）：
#   DSH_HOME    默认 ~/.dsh
#   DSH_CMD     默认优先用 PATH 上的 `dsh`，缺省回退 npx -y --package @deepseek-ai/dsh
# =============================================================================
set -euo pipefail

for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    cat <<'EOF'
dsh-better-tools 一键安装脚本

用法：bash scripts/install.sh [版本] [--restart] [--dry-run]

  版本         npm 版本号/范围，缺省 latest。示例：0.1.0、^0.1.0、latest
  --restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅打印提示）
  --dry-run    只打印将要执行的操作，不写任何文件

环境变量（可省略）：DSH_HOME（默认 ~/.dsh）、DSH_CMD（dsh 命令）
EOF
    exit 0
  fi
done

DSH_HOME="${DSH_HOME:-${HOME:-${USERPROFILE:-}}/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
PKG="dsh-better-tools"
DSH_CMD="${DSH_CMD:-dsh}"

RESTART=false
DRY_RUN=false
VERSION_SPEC=""
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) : ;;
    -*) echo "未知参数: ${arg}（用 -h 查看帮助）" >&2; exit 2 ;;
    *) VERSION_SPEC="$arg" ;;
  esac
done

say()  { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

dsh_cli() {
  if command -v "$DSH_CMD" >/dev/null 2>&1; then
    printf '%s' "$DSH_CMD"
  elif command -v npx >/dev/null 2>&1; then
    printf 'npx -y --package @deepseek-ai/dsh dsh'
  else
    die "未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用），或用 DSH_CMD 指定 dsh 路径。"
  fi
}

command -v node >/dev/null 2>&1 || die "未找到 node（DSH 运行需要 Node.js ≥ 20），请先安装 Node.js 并加入 PATH。"

say "目标 profile: $PROFILE_DIR"
say "将执行: $(dsh_cli) plugin --profile web add $PKG${VERSION_SPEC:+@$VERSION_SPEC}"
[ "$DRY_RUN" = true ] && { say "（--dry-run）以上为将要执行的操作，未做任何修改。"; exit 0; }

"$(dsh_cli)" plugin --profile web add "$PKG${VERSION_SPEC:+@$VERSION_SPEC}"

say "安装完成。"
say "请硬刷新浏览器（Cmd/Ctrl+Shift+R）。"
say "验证："
say "  1. 页面左下角出现 🧰 dsh-better-tools 小徽标（client half 已挂载，host ping 显示 green）；"
say "  2. 任意会话可用 better_tools_ping 工具（host half 已挂载）。"

if [ "$RESTART" = true ]; then
  if command -v pm2 >/dev/null 2>&1; then
    say "重启 dsh-web：pm2 restart dsh-web"
    pm2 restart dsh-web
  else
    warn "--restart 需要 pm2；未检测到 pm2，请自行重启 dsh web 服务。"
  fi
fi
