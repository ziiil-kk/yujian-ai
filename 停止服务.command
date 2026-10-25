#!/bin/bash
# 舆见 AI —— 双击此文件停止占用 3000 端口的服务
echo "正在查找占用 3000 端口的服务…"
PIDS="$(lsof -ti tcp:3000 2>/dev/null)"
if [ -z "$PIDS" ]; then
  echo "· 没有找到正在运行的服务，无需操作。"
else
  echo "$PIDS" | while read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "· 已停止进程 $pid"
  done
  sleep 1
  if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "· 仍有进程占用（可能是别的程序），请在活动监视器中手动结束。"
  else
    echo "· 端口 3000 已释放。"
  fi
fi
echo
read -n 1 -s -r -p "按任意键关闭此窗口…"
