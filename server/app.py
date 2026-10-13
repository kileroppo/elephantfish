# -*- coding: utf-8 -*-
"""转述对局服务 —— 只有 HTTP。

这个服务的存在意义只有一个：**让人当信使**。

    对手大模型下一步棋  →  人把这一步录进棋盘  →  引擎算出应手
    →  人把应手喂回对手大模型  →  循环，直到将死对方

所以接口不是围绕「人和引擎下棋」设计的，而是围绕
「录入对方走法 / 取走我方应手」这两件事设计的：

* ``POST /api/move``          录入一步（ICCS ``h2e2`` 或中文记谱 ``炮二平五`` 都认）
* ``POST /api/engine-move``   轮到引擎时让它出招
* ``GET  /api/task/<id>``     轮询搜索进度（深度 / 评分 / 节点 / 主变）
* ``POST /api/undo``          录错了往回退，回到「等对方出招」的界面状态

搜索放在后台线程里跑，前端轮询进度，所以深度一层层涨上去的过程是看得见的，
不会出现「点了没反应，三秒后突然蹦出一步棋」。

**这个文件只管三件事：解析请求、路由、写响应。** 对局本身 —— 棋盘、引擎、
排队的走法、战绩、那个后台搜索线程以及它要小心处理的竞态 —— 全在
``server/session.py``。

分开的理由是**测试面**。以前这些都挤在这里，于是想测「引擎收手后排队的那一步
会不会落地」的代价是先起一个 HTTP 服务、构造请求体、再解析 JSON；``tools/verify.py``
干脆绕开 HTTP 直接 new 一个会话，等于承认 HTTP 层零覆盖。现在两边各测各的：
``tools/smoke_http.py`` 走真实 HTTP 测对外契约，``tools/verify.py`` 直接打会话测
棋与并发，谁都不用将就谁。

会话的每个动词都返回一个 ``Reply``（body + 状态码）。以前有的路由返回 dict、
有的返回 ``(dict, status)`` 元组，HTTP 层得先 ``isinstance`` 猜一下 —— 那种双重
形状是错的温床，现在没有了。
"""

import functools
import json
import os
import sys
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# 让 `python server/app.py` 与 `import server.app` 两种用法都能找到包
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from server.session import GameSession, Reply                       # noqa: E402

STATIC_DIR = os.path.join(_ROOT, 'frontend', 'dist')

# 全进程就这一个对局会话。多对局要靠多开端口，不靠多实例。
SESSION = GameSession()


# --------------------------------------------------------------------------- #
# 探活
# --------------------------------------------------------------------------- #

def _health():
    """探活。

    ``python`` 由这里补上，因为它是**服务进程**的事实，不是对局的事实 ——
    会话没有理由知道自己跑在哪个解释器里。
    """
    body = SESSION.health()
    body['python'] = sys.version.split()[0]
    return Reply(body)


# --------------------------------------------------------------------------- #
# 路由
# --------------------------------------------------------------------------- #

# 动词直接绑会话的方法：没有一层「转发一下」的空壳函数。
ROUTES = {
    '/api/new': SESSION.new_game,
    '/api/move': SESSION.submit_move,
    '/api/engine-move': SESSION.engine_move,
    '/api/undo': SESSION.undo,
    '/api/resign': SESSION.resign,
    '/api/load': SESSION.load,
    '/api/settings': SESSION.update_settings,
    '/api/clear-pending': SESSION.clear_pending,
    '/api/clear-stats': SESSION.clear_stats,
    '/api/opponent/config': SESSION.configure_opponent,
    '/api/opponent/poll': SESSION.poll_opponent,
}

# 没有一条 GET 用得上查询串，所以这里不传 query —— 少一个没人看的参数。
GET_ROUTES = {
    '/api/state': SESSION.state_reply,
    '/api/health': _health,
}


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(SimpleHTTPRequestHandler):
    server_version = 'elephantfish-relay'
    # 用 HTTP/1.0：每个请求一条连接。这是个本机应用，轮询频率再高也不差这点
    # 开销，但省掉了长连接下「请求体没读完就和下一个请求串味」的一整类麻烦。
    protocol_version = 'HTTP/1.0'

    # ---- 工具 ---- #

    def _json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _reply(self, reply):
        """会话动词都返回 Reply，这里只把它写出去。"""
        self._json(reply.body, reply.status)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')

    def _read_body(self):
        """一次性把请求体读干净，之后的处理只管用解析结果。"""
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        if not raw:
            return {}
        for encoding in ('utf-8', 'gbk', 'latin-1'):
            try:
                return json.loads(raw.decode(encoding))
            except (UnicodeDecodeError, ValueError):
                continue
        return {'__parse_error__': raw.decode('utf-8', 'replace')[:200]}

    def log_message(self, fmt, *args):
        # 静音轮询日志，否则控制台会被刷屏。
        # 注意：send_error() 会走 log_error() -> log_message()，此时第一个位置参数
        # 可能是个 HTTPStatus 枚举而不是字符串，直接 `in` 会抛 TypeError，
        # 异常冒到 socketserver 就会把连接掐掉 —— 浏览器只看到「空响应」。
        try:
            line = fmt % args
        except (TypeError, ValueError):
            line = ' '.join([str(fmt), *(str(a) for a in args)])
        if '/api/state' in line or '/api/task/' in line:
            return
        sys.stderr.write('%s - %s\n' % (self.address_string(), line))

    def _fail(self, exc):
        """路由里冒出来的异常兜成 500。

        不兜的话异常会冒到 socketserver，连接被掐掉，浏览器只看到一个空响应，
        排查成本比看一条堆栈高得多。
        """
        traceback.print_exc()
        self._json({'ok': False, 'message': str(exc)}, 500)

    # ---- 路由 ---- #

    def do_OPTIONS(self):
        self._read_body()
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        payload = self._read_body()
        path = urlparse(self.path).path

        if payload.get('__parse_error__') is not None:
            self._json({'ok': False,
                        'message': '请求体不是合法 JSON：' + payload['__parse_error__']}, 400)
            return

        # 带路径参数的接口进不了静态路由表，单独认一下
        if path.startswith('/api/task/') and path.endswith('/stop'):
            task_id = path[len('/api/task/'):-len('/stop')]
            self._reply(SESSION.stop_task(task_id))
            return

        route = ROUTES.get(path)
        if route is None:
            self._json({'ok': False, 'message': f'未知接口 {path}'}, 404)
            return

        try:
            self._reply(route(payload))
        except Exception as exc:                          # noqa: BLE001
            self._fail(exc)

    def do_GET(self):
        path = urlparse(self.path).path

        route = GET_ROUTES.get(path)
        if route is not None:
            try:
                self._reply(route())
            except Exception as exc:                      # noqa: BLE001
                self._fail(exc)
            return

        if path.startswith('/api/task/'):
            task_id = path[len('/api/task/'):]
            try:
                self._reply(SESSION.task_snapshot(task_id))
            except Exception as exc:                      # noqa: BLE001
                self._fail(exc)
            return

        if path.startswith('/api/'):
            self._json({'ok': False, 'message': f'未知接口 {path}'}, 404)
            return

        # 静态资源：只服务前端构建产物
        if path in ('/', '/index.html'):
            self.path = '/index.html'

        if not os.path.isdir(STATIC_DIR):
            self._serve_unbuilt(path)
            return

        target = os.path.join(STATIC_DIR, path.lstrip('/').replace('/', os.sep))
        # 单页应用：文件不存在就交给前端路由，而不是丢 404
        if not os.path.isfile(target) and '.' not in os.path.basename(path):
            self.path = '/index.html'
        super().do_GET()

    def end_headers(self):
        # 避免 html 页面被浏览器强缓存导致前端发版后无法加载最新 JS/CSS
        path = getattr(self, 'path', '')
        if path.endswith('.html') or path in ('', '/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def _serve_unbuilt(self, path):
        """前端还没构建时，给一页说清怎么构建 —— 至少不是白屏。"""
        body = (
            '<!doctype html><meta charset="utf-8">'
            '<title>elephantfish</title>'
            '<body style="font-family:system-ui;max-width:640px;margin:80px auto;'
            'line-height:1.7;color:#333">'
            '<h2>前端还没构建</h2>'
            '<p>新版界面需要用 Vite 构建一次。在项目根目录执行：</p>'
            '<pre style="background:#f4f1ea;padding:16px;border-radius:8px">'
            'cd frontend\nnpm install\nnpm run build</pre>'
            '<p>构建完成后刷新本页即可。开发模式请用 '
            '<code>npm run dev</code>，默认地址 http://localhost:5173</p>'
            '</body>').encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(ThreadingHTTPServer):
    # 不给 SO_REUSEADDR 钻空子的机会：Windows 上 0.0.0.0:8010 和 127.0.0.1:8010
    # 可以同时存在，请求会随机落到其中一个，排查起来非常费劲。宁可让 bind 直接失败。
    allow_reuse_address = sys.platform != 'win32'
    daemon_threads = True


def run(port=8010, host='127.0.0.1'):
    # 让后台搜索线程和 HTTP 线程公平轮转，否则搜索时页面会卡
    sys.setswitchinterval(0.002)
    handler = functools.partial(Handler, directory=STATIC_DIR)

    httpd = None
    chosen = port
    for candidate in range(port, port + 12):
        try:
            httpd = Server((host, candidate), handler)
            chosen = candidate
            break
        except OSError:
            continue
    if httpd is None:
        print(f'端口 {port}~{port + 11} 全被占用，请手动指定一个空闲端口')
        return

    if chosen != port:
        print(f'端口 {port} 已被占用（可能是旧版 start.bat 还在跑），改用 {chosen}')

    print('=' * 58)
    print('  elephantfish 转述对局台')
    print(f'  打开   http://{host}:{chosen}/')
    print(f'  静态   {STATIC_DIR}')
    print('  停止   Ctrl+C')
    print('=' * 58)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    port = 8010
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
    run(port)
