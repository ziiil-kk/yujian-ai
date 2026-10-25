#!/bin/bash
# 舆见 AI —— 日常就用这一个：双击它，浏览器会自动打开产品页面
cd "$(dirname "$0")" || exit 1

# 保险：确保所有 .command 文件都可执行（权限丢失时 macOS 会拒绝双击运行）
for _f in *.command; do [ -e "$_f" ] && chmod +x "$_f" 2>/dev/null; done

echo "════════════════════════════════════════"
echo "  舆见 AI · 启动中"
echo "════════════════════════════════════════"
echo

pause() { read -n 1 -s -r -p "按任意键关闭此窗口…"; echo; }

fail() {
  echo
  echo "❌ $1"
  echo
  pause
  exit 1
}

URL="http://localhost:3000"

# ---------- 1. 服务已经在跑：不重复启动，直接开浏览器 ----------
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -s -m 3 "$URL/share-guide.html" 2>/dev/null | grep -q "舆见"; then
    echo "· 舆见 AI 已经在运行了"
  else
    echo "· 3000 端口上已经有服务在运行"
  fi
  echo "· 正在打开浏览器…"
  open "$URL" >/dev/null 2>&1
  echo
  echo "如果没有自动跳出浏览器，手动打开：$URL"
  echo
  pause
  exit 0
fi

# ---------- 2. 找到 Node ----------
NODE_BIN="$(command -v node 2>/dev/null)"
[ -x "$NODE_BIN" ] || fail "没有找到可用的 Node.js 运行环境。请先安装 Node.js 18 或以上版本：https://nodejs.org"
[ -f node_modules/next/package.json ] || fail "依赖缺失，项目文件可能不完整。"
echo "· 运行环境就绪（Node $("$NODE_BIN" -v)）"

# ---------- 3. 需要时重新构建 ----------
NEEDS_BUILD=1
if [ -f ".next/BUILD_ID" ]; then
  NEWER="$(find app lib components data -newer .next/BUILD_ID 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEEDS_BUILD=0
fi

if [ "$NEEDS_BUILD" = "1" ]; then
  echo "· 代码有更新，正在构建（约 15 秒，只需一次）…"
  if ! "$NODE_BIN" node_modules/next/dist/bin/next build > /tmp/yujian-build.log 2>&1; then
    echo
    tail -25 /tmp/yujian-build.log
    fail "构建失败，以上是错误信息。"
  fi
  echo "· 构建完成"
else
  echo "· 已有最新版本，跳过构建"
fi

# ---------- 4. 启动服务 ----------
echo "· 正在启动服务…"
"$NODE_BIN" node_modules/next/dist/bin/next start -p 3000 > /tmp/yujian-demo-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' INT TERM

READY=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -m 2 "$URL/"; then READY=1; break; fi
  sleep 0.5
done

if [ "$READY" != "1" ]; then
  echo
  tail -20 /tmp/yujian-demo-server.log
  fail "服务启动失败，以上是日志。"
fi

echo "· 服务已就绪，正在打开浏览器…"
open "$URL" >/dev/null 2>&1

echo
echo "════════════════════════════════════════"
echo "  ✅ 已打开： $URL"
echo "════════════════════════════════════════"
echo
echo "· 浏览器没自动跳出来的话，手动输入上面这个地址"
echo "· 这个窗口要保持打开，关掉窗口就等于关闭服务"
echo "· 想分享给别人看：另外双击一次 share.command"
echo

wait "$SERVER_PID"
echo
echo "服务已停止。"
pause
