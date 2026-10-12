#!/usr/bin/env bash
# ==================================================
#  elephantfish - 转述对局台  (macOS / Linux)
#  用法： ./start.sh [端口]      默认端口 8010
#  停止： 在这个窗口按 Ctrl+C
# ==================================================
set -u

cd "$(dirname "$0")" || exit 1

PORT="${1:-8010}"
URL="http://localhost:${PORT}/"
SERVER_PID=""

echo "=================================================="
echo "  elephantfish - 转述对局台"
echo "=================================================="
echo

# ---------- 找 Python ----------
PY=""
for cand in python3 python pypy3 pypy; do
    if command -v "$cand" >/dev/null 2>&1; then
        PY="$cand"
        break
    fi
done
if [ -z "$PY" ]; then
    echo "[ERROR] 没找到 Python，请先安装 Python 3 再运行本脚本。"
    exit 1
fi

# ---------- 准备 Pikafish 可执行权限 ----------
chmod +x engine/pikafish/Pikafish-* 2>/dev/null || true

# ---------- 打开浏览器 ----------
open_url() {
    if command -v open >/dev/null 2>&1; then
        open "$1"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$1"
    else
        echo "      请手动打开 $1"
    fi
}

# ---------- 端口是否已监听 ----------
port_in_use() {
    local p="${1:-$PORT}"
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi
    "$PY" - "$p" <<'PYEOF'
import socket, sys
s = socket.socket()
s.settimeout(0.3)
code = s.connect_ex(("127.0.0.1", int(sys.argv[1])))
s.close()
sys.exit(0 if code == 0 else 1)
PYEOF
}

# ---------- 端口上跑的到底是谁 ----------
# 光看「端口被占」会误判：8010 这类端口上常驻着别的项目的服务（比如某个 uvicorn
# 应用），脚本会以为「服务已经在跑」，把浏览器开到别人的接口上，页面上只剩一句
# {"detail":"Not Found"}。所以拿本服务独有的 /api/health 认个脸。
# 输出：free（没人用）/ ours（本服务）/ other（别的程序）
server_identity() {
    "$PY" - "${1:-$PORT}" <<'PYEOF'
import json, socket, sys, urllib.request

port = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.3)
in_use = s.connect_ex(("127.0.0.1", port)) == 0
s.close()
if not in_use:
    print("free")
    raise SystemExit(0)

try:
    url = "http://127.0.0.1:%d/api/health" % port
    with urllib.request.urlopen(url, timeout=2) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    if isinstance(data, dict) and (data.get("engine") in ("elephantfish", "pikafish") or "pikafish_available" in data):
        print("ours")
        raise SystemExit(0)
except Exception:
    pass
print("other")
PYEOF
}

# ---------- 从 base 往后找一个空闲端口，回显端口号 ----------
find_free_port() {
    local base="${1:-$PORT}" p
    for p in $(seq $((base + 1)) $((base + 12))); do
        if ! port_in_use "$p"; then
            printf '%s\n' "$p"
            return 0
        fi
    done
    return 1
}

# ---------- 退出时收掉服务 ----------
cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo
        echo "正在停止服务 (pid $SERVER_PID) ..."
        kill "$SERVER_PID" 2>/dev/null
        wait "$SERVER_PID" 2>/dev/null
    fi
}
trap cleanup INT TERM EXIT

# ---------- 先弄清端口上的情况，免得白等一场构建 ----------
IDENT="$(server_identity "$PORT")"

if [ "$IDENT" = "ours" ]; then
    echo "[INFO] elephantfish 已经在端口 $PORT 上跑着，直接打开页面。"
    echo
    open_url "$URL"
    exit 0
fi

if [ "$IDENT" = "other" ]; then
    echo "[WARN] 端口 $PORT 被别的程序占着（不是 elephantfish），换一个端口。"
    if FREE_PORT="$(find_free_port "$PORT")"; then
        PORT="$FREE_PORT"
        URL="http://localhost:${PORT}/"
        echo "       改用端口 ${PORT}。"
    else
        echo "[ERROR] $PORT 往后 12 个端口都不空闲，请手动指定，例如 ./start.sh 8030"
        exit 1
    fi
    echo
fi

# ---------- 前端构建检查（未构建或源码有更新时自动构建） ----------
NEED_BUILD="no"
if [ ! -f "frontend/dist/index.html" ]; then
    NEED_BUILD="yes"
else
    NEED_BUILD="$("$PY" tools/run_server.py check-build 2>/dev/null || echo no)"
fi

if [ "$NEED_BUILD" = "yes" ]; then
    echo "[1/3] 检测到前端源码更新或首次运行，正在构建前端界面 ..."
    if ! command -v npm >/dev/null 2>&1; then
        echo "[WARN] 没找到 npm，跳过构建。页面会提示如何手动构建。"
        echo
    else
        (
            cd frontend || exit 1
            if [ ! -d "node_modules" ]; then
                echo "      安装依赖，第一次会慢一些 ..."
                if ! npm install; then
                    echo "[WARN] npm install 失败，跳过构建。"
                    exit 2
                fi
            fi
            if ! npm run build; then
                echo "[WARN] 前端构建失败，页面会退回旧版界面。"
            fi
        )
    fi
else
    echo "[1/3] 前端已是最新构建，跳过。"
fi

echo "[2/3] 启动服务，端口 $PORT ..."
LOG="server-${PORT}.log"
: > "$LOG"
"$PY" -u server/app.py "$PORT" > "$LOG" 2>&1 &
SERVER_PID=$!

echo "[3/3] 等服务起来 ..."
READY=0
ACTUAL=""
for _ in $(seq 1 60); do
    # app.py 会把真正落地的端口打印出来，那是唯一可信的来源：万一挑端口时
    # 和别的进程撞了，它会自己往后顺延，打开的地址得跟着它走。
    ACTUAL="$(sed -n 's#.*http://127\.0\.0\.1:\([0-9][0-9]*\)/.*#\1#p' "$LOG" 2>/dev/null | head -n 1)"
    if [ -n "$ACTUAL" ]; then
        READY=1
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[ERROR] 服务启动失败，日志如下："
        echo "----------------------------------------"
        cat "$LOG"
        echo "----------------------------------------"
        exit 1
    fi
    sleep 0.2
done

if [ "$READY" -ne 1 ]; then
    echo "[WARN] 等了 12 秒服务还没起来，仍然尝试打开页面。"
elif [ "$ACTUAL" != "$PORT" ]; then
    echo "[INFO] 端口 ${PORT} 临时被抢，服务实际落在 ${ACTUAL}。"
    PORT="$ACTUAL"
    URL="http://localhost:${PORT}/"
fi

echo "      打开 $URL"
open_url "$URL"

echo
echo "完成。服务跑在端口 $PORT (pid $SERVER_PID)。"
echo "日志：$LOG"
echo "在这个窗口按 Ctrl+C 就停止服务。"
echo

wait "$SERVER_PID"
