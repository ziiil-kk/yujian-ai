#!/bin/bash
# 舆见 AI —— 双击此文件启动（开发模式：改动会立刻生效）
cd "$(dirname "$0")" || exit 1

# 保险：确保所有 .command 文件都可执行（权限丢失时 macOS 会拒绝双击运行）
for _f in *.command; do [ -e "$_f" ] && chmod +x "$_f" 2>/dev/null; done

# 开发模式使用独立产物目录，避免与「演示模式」的构建产物互相覆盖
export YUJIAN_DIST_DIR=".next-dev"

echo "════════════════════════════════════════"
echo "  舆见 AI · 开发模式"
echo "════════════════════════════════════════"
echo

fail() {
  echo
  echo "❌ $1"
  echo
  read -n 1 -s -r -p "按任意键关闭此窗口…"
  exit 1
}

NODE_BIN="$(command -v node 2>/dev/null)"
[ -n "$NODE_BIN" ] || fail "没有找到 Node.js。请先安装 Node.js 18 或以上版本：https://nodejs.org"
echo "· Node 版本：$("$NODE_BIN" -v)"

[ -f node_modules/next/package.json ] || fail "依赖缺失。请在项目目录执行：pnpm install  或  npm install"
echo "· 依赖完整"

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "端口 3000 已被占用。请先双击「停止服务.command」，或关闭之前那个终端窗口。"
fi
echo "· 端口 3000 空闲"

echo
echo "正在启动… 启动完成后浏览器打开： http://localhost:3000"
echo "（本窗口需要保持打开，关闭窗口即停止服务）"
echo

"$NODE_BIN" node_modules/next/dist/bin/next dev -p 3000
CODE=$?
echo
echo "⚠️  服务已退出（退出码 $CODE）。以上为最后的输出，可据此排查。"
read -n 1 -s -r -p "按任意键关闭此窗口…"
