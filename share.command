#!/bin/bash
# 舆见 AI —— 一键分享给别人看
# 双击本文件即可运行。它会：启动服务 → 打通外网通道 → 给出一个链接。
# 把链接发给别人，对方用手机就能打开。按 Control + C 结束分享。

cd "$(dirname "$0")" || exit 1

echo "════════════════════════════════════════"
echo "  舆见 AI · 一键分享"
echo "════════════════════════════════════════"
echo

pause() { read -n 1 -s -r -p "按任意键关闭此窗口…"; echo; }

# ---------- 1. 运行环境 ----------
NODE_BIN="$(command -v node 2>/dev/null)"
[ -x "$NODE_BIN" ] || { echo "❌ 没有可用的 Node.js 运行环境。"; echo; pause; exit 1; }
[ -f node_modules/next/package.json ] || { echo "❌ 依赖缺失，请先运行 start.command。"; echo; pause; exit 1; }

# ---------- 2. 本地服务 ----------
SERVER_PID=""
TUNNEL_PID=""
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "· 本地服务已在运行，直接复用"
else
  NEEDS_BUILD=1
  if [ -f ".next/BUILD_ID" ]; then
    NEWER="$(find app lib components data -newer .next/BUILD_ID 2>/dev/null | head -1)"
    [ -z "$NEWER" ] && NEEDS_BUILD=0
  fi
  if [ "$NEEDS_BUILD" = "1" ]; then
    echo "· 正在构建（约 15 秒）…"
    if ! "$NODE_BIN" node_modules/next/dist/bin/next build > /tmp/yujian-share-build.log 2>&1; then
      echo "❌ 构建失败："; tail -20 /tmp/yujian-share-build.log; echo; pause; exit 1
    fi
  fi
  echo "· 正在启动本地服务…"
  "$NODE_BIN" node_modules/next/dist/bin/next start -p 3000 > /tmp/yujian-share-server.log 2>&1 &
  SERVER_PID=$!
  READY=0
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null -m 2 http://127.0.0.1:3000/; then READY=1; break; fi
    sleep 1
  done
  if [ "$READY" != "1" ]; then
    echo "❌ 服务启动超时："; tail -20 /tmp/yujian-share-server.log
    kill "$SERVER_PID" 2>/dev/null; echo; pause; exit 1
  fi
  echo "· 本地服务已就绪"
fi

cleanup() {
  if [ -n "$TUNNEL_PID" ]; then kill "$TUNNEL_PID" 2>/dev/null; fi
  if [ -n "$SERVER_PID" ]; then
    echo
    echo "· 正在关闭本次启动的本地服务…"
    kill "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# ---------- 3. 同一 Wi-Fi 的快捷方式 ----------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null)"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en1 2>/dev/null)"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ifconfig en0 2>/dev/null | awk '/inet /{print $2; exit}')"
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ifconfig 2>/dev/null | awk '/inet /{if ($2 != "127.0.0.1") {print $2; exit}}')"
fi

# ---------- 4. 等链接出现 ----------
LINK_KIND="temp"
wait_url() {
  LOG_FILE="$1"; URL_PATTERN="$2"; MAX_SECS="$3"
  WAITED=0
  while [ "$WAITED" -lt "$MAX_SECS" ]; do
    FOUND="$(grep -Eo "$URL_PATTERN" "$LOG_FILE" 2>/dev/null | head -1)"
    if [ -n "$FOUND" ]; then echo "$FOUND"; return 0; fi
    kill -0 "$TUNNEL_PID" 2>/dev/null || return 1
    sleep 1
    WAITED=$((WAITED + 1))
  done
  return 1
}

show_link() {
  echo
  echo "════════════════════════════════════════"
  echo "  ✅ 分享链接已生成（对方在任何网络都能打开）"
  echo "════════════════════════════════════════"
  echo
  echo "        $1"
  echo
  if [ "$LINK_KIND" = "stable" ]; then
    echo "  ↑ 固定链接：以后每次运行都是这个地址，可以存下来反复用"
  else
    echo "  ↑ 临时链接：每次运行都会换一个，这个窗口关掉就失效"
  fi
  echo
  if printf '%s' "$1" | pbcopy 2>/dev/null; then
    echo "  已复制到剪贴板，粘贴发给对方就行。"
  fi
  echo
  echo "────────────────────────────────────────"
  echo "⚠️  链接是公开的，拿到链接的人都能打开。演示数据无所谓，别放真实敏感内容。"
  echo "⚠️  分享期间这台电脑要保持开机、不要合盖睡眠，这个窗口也不要关。"
  echo "⚠️  按 Control + C 结束分享，链接随即失效。"
  if [ -n "$LAN_IP" ]; then
    echo
    echo "ℹ️  如果对方就坐在你旁边、连的是同一个 Wi-Fi，用 http://$LAN_IP:3000 更快。"
  fi
  echo "────────────────────────────────────────"
}

# ---------- 5. 依次尝试三个通道 ----------
try_channel() {
  CH_NAME="$1"; CH_PATTERN="$2"; CH_WAIT="$3"; CH_KIND="$4"; shift 4
  echo "· 尝试通道：$CH_NAME"
  : > /tmp/yujian-tunnel.log
  "$@" > /tmp/yujian-tunnel.log 2>&1 &
  TUNNEL_PID=$!
  if LINK="$(wait_url /tmp/yujian-tunnel.log "$CH_PATTERN" "$CH_WAIT")"; then
    LINK_KIND="$CH_KIND"
    return 0
  fi
  kill "$TUNNEL_PID" 2>/dev/null; TUNNEL_PID=""
  return 1
}

echo "· 正在打通外网通道…（每个通道最多等 25 秒）"
echo

# 1) serveo.net —— 链接名固定，方便反复分享
if try_channel "固定链接通道" 'https://[a-z0-9.-]+\.serveo\.net' 25 stable \
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 -o ConnectTimeout=10 \
        -R yujian-ai-demo:80:localhost:3000 serveo.net; then
  show_link "$LINK"; wait "$TUNNEL_PID"; cleanup; trap - EXIT; echo; pause; exit 0
fi
echo "· 没打通，换下一种…"
echo

# 2) localhost.run —— 临时随机链接，通常更稳
if try_channel "备用通道一" 'https://[a-z0-9.-]+\.(lhr\.life|localhost\.run)' 25 temp \
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 -o ConnectTimeout=10 \
        -R 80:localhost:3000 nokey@localhost.run; then
  show_link "$LINK"; wait "$TUNNEL_PID"; cleanup; trap - EXIT; echo; pause; exit 0
fi
echo "· 没打通，换下一种…"
echo

# 3) Cloudflare —— 需要先下载一个工具，兜底用
BIN_DIR="$PWD/bin"
CF="$BIN_DIR/cloudflared"
mkdir -p "$BIN_DIR"
if [ ! -x "$CF" ] && command -v cloudflared >/dev/null 2>&1; then
  CF="$(command -v cloudflared)"
fi
if [ ! -x "$CF" ]; then
  case "$(uname -m)" in
    arm64)  ASSET="cloudflared-darwin-arm64.tgz" ;;
    x86_64) ASSET="cloudflared-darwin-amd64.tgz" ;;
    *) ASSET="" ;;
  esac
  if [ -n "$ASSET" ]; then
    echo "· 正在下载兜底通道工具（约 20 MB，国内网络可能较慢）…"
    if curl -fL --progress-bar \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET" \
        -o "$BIN_DIR/cf.tgz"; then
      tar -xzf "$BIN_DIR/cf.tgz" -C "$BIN_DIR" && rm -f "$BIN_DIR/cf.tgz" && chmod +x "$CF" 2>/dev/null
    fi
  fi
fi

if [ -x "$CF" ]; then
  if try_channel "兜底通道" 'https://[a-z0-9-]+\.trycloudflare\.com' 45 temp "$CF" tunnel --url http://localhost:3000; then
    show_link "$LINK"; wait "$TUNNEL_PID"; cleanup; trap - EXIT; echo; pause; exit 0
  fi
  echo "· 兜底通道也没打通。"
else
  echo "· 兜底通道不可用（工具没下载成功）。"
fi
echo

# ---------- 6. 全部失败 ----------
echo
echo "════════════════════════════════════════"
echo "  ⚠️  三种外网通道都没打通"
echo "════════════════════════════════════════"
echo
echo "常见原因：公司/校园网络限制、VPN 干扰、或者外网暂时不通。"
echo
if [ -n "$LAN_IP" ]; then
  echo "先试这个 —— 如果对方和你连的是同一个 Wi-Fi，"
  echo "让他在手机浏览器里打开下面这个地址，不用任何额外设置："
  echo
  echo "        http://$LAN_IP:3000"
  echo
fi
echo "排查建议："
echo "  1) 关掉 VPN 再试一次"
echo "  2) 换个网络（比如手机热点）再试一次"
echo "  3) 或者告诉我，我可以换成部署到公网的方式，那样链接是永久的"
echo
pause
