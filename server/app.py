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
* ``GET  /api/mistakes``      错题本：跨历次对局按局面聚合的判分（**只读**）
* ``GET  /api/games``         历次对局列表（``?limit=`` 可换页，**只读**）
* ``GET  /api/game``          某一局的每一手，够把它一手手摆回盘上（``?game_id=``，**只读**）

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
from urllib.parse import parse_qs, urlparse

# 让 `python server/app.py` 与 `import server.app` 两种用法都能找到包
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from server.session import GameSession, Reply                       # noqa: E402
from server.training import TrainingController                       # noqa: E402

STATIC_DIR = os.path.join(_ROOT, 'frontend', 'dist')

# 全进程就这一个对局会话。多对局要靠多开端口，不靠多实例。
SESSION = GameSession()
TRAINING = TrainingController(store=SESSION.store, engines=SESSION.engines)


# --------------------------------------------------------------------------- #
# 探活
# --------------------------------------------------------------------------- #

CURRENT_HOST = '127.0.0.1'


def _health():
    """探活。

    ``python`` 由这里补上，因为它是**服务进程**的事实，不是对局的事实 ——
    会话没有理由知道自己跑在哪个解释器里。
    """
    body = SESSION.health()
    body['python'] = sys.version.split()[0]
    body['host'] = CURRENT_HOST
    return Reply(body)


# --------------------------------------------------------------------------- #
# 错题本（只读）
# --------------------------------------------------------------------------- #

def _mistakes():
    """错题本：跨历次对局，按**局面**聚合已经存下的判分。

    这条路由**不属于会话**，而且是刻意不归的：它讲的不是「眼下这一局」，是存档里
    那些局。挂到 ``GameSession`` 上就等于给它一把 ``self.lock``，而它一根手指都
    不该碰棋 —— 它对状态的全部影响就是读了一份库。聚合与「算不算错」那道门槛
    全在 ``server/store.py``，这里只把结果包成 Reply。
    """
    book = SESSION.store.mistake_book()
    book['ok'] = True
    return Reply(book)


# --------------------------------------------------------------------------- #
# 历史局与逐手回放（只读）
# --------------------------------------------------------------------------- #

def _parse_limit(raw):
    """``?limit=`` 解析成 int 或 ``None``；返回 ``(值, 错误说明)``。

    空值当「没传」处理，交给存档那一侧的缺省常量决定给多少 —— 界面上「换一页」
    的按钮传个空串是常事，那里不该 400。给的是负数或非数字就如实拒绝：把它悄悄
    当成缺省，等于让一个写错的参数变成一次没人察觉的全表读。
    """
    if raw in (None, ''):
        return None, None
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return None, f'limit 要是一个整数，收到的是 {raw!r}'
    if value < 0:
        return None, f'limit 不许为负，收到 {value}（0 表示不封顶）'
    return value, None


def _games(query):
    """历次对局的列表，新的在前 —— UI 拿它**挑一局**来逐手回放。

    与 ``_mistakes`` 同一条纪律：这条路由**不属于会话**，而且是刻意不归的。它读
    的是存档里那些局，不是眼下这一局，``self.lock`` 一根手指都不碰（``Store`` 里
    拿的是管连接的那把 ``_lock``），不起搜索、不写表、也不回一份 ``state`` 快照。
    参数只有一个 ``limit``，缺省用 ``store.GAMES_LIMIT_DEFAULT``；``0`` 不封顶，
    被切掉的行数在 ``summary.truncated`` 里如实说，不靠 limit 藏数据。
    """
    limit, error = _parse_limit(query.get('limit'))
    if error:
        return Reply({'ok': False, 'message': error, 'limit': query.get('limit')}, 400)
    out = SESSION.store.recent_games(limit=limit)
    out['ok'] = True
    return Reply(out)


def _game(query):
    """某一局的每一手，按 ply 升序：光靠存档就能把这一局一手手摆回盘上。

    回放要的**全部**真值都在这一份里：``game.start_fen`` 加每手的 ``iccs`` 就够
    规则层重放一遍，每手的 ``fen_before`` 让界面不必自己算就能把某一手摆出来，
    ``review`` 整份原样带回来（里面有什么键由判分那一侧决定，这里一概不看）。

    同样不碰会话、不碰 ``sess.lock``、不写库。三种「没有」分开回答，因为它们是
    三件不同的事，界面要念的话也不一样：

    * 没传 ``game_id`` → 400，那是请求写错了；
    * 存档关着 → 503 并说明 ``store_enabled=False``。回 404 是撒谎：这一局不是
      「不在库里」，是**根本没有库**可查；
    * 库里确实没有这一局 → 404，而且**不带 plies** —— 交回一副空棋谱会被读成
      「这局一步没走」，那是拿一个不存在的东西假装存在。
    """
    game_id = (query.get('game_id') or '').strip()
    if not game_id:
        return Reply({'ok': False, 'message': '缺少 game_id 参数：GET /api/game?game_id=…'},
                     400)

    replay = SESSION.store.game_replay(game_id)
    if not replay.get('found'):
        if not replay.get('store_enabled'):
            return Reply({'ok': False, 'found': False, 'store_enabled': False,
                          'game_id': game_id,
                          'message': '存档未开启（EF_STORE=off），没有可回放的棋谱'}, 503)
        return Reply({'ok': False, 'found': False, 'store_enabled': True,
                      'game_id': game_id,
                      'message': f'存档里没有这一局：{game_id}'}, 404)
    replay['ok'] = True
    return Reply(replay)


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
    # 精训营对弈接口
    '/api/training/start': TRAINING.start_drill_reply,
    '/api/training/step': TRAINING.step_drill_reply,
    '/api/training/undo': TRAINING.undo_drill_reply,
    '/api/training/hint': TRAINING.hint_drill_reply,
    '/api/training/reset': TRAINING.reset_drill_reply,
}

# GET 分两张表。这张里的每一条都**不问参数**：会话的快照、探活、错题本。
# 以前这里写过一句「没有一条 GET 用得上查询串，所以这里不传 query —— 少一个
# 没人看的参数」，那句话是对的，所以现在也不用把参数硬塞给这些处理器：要读
# 查询串的那几条进了下面那张 ``QUERY_ROUTES``，签名自己说它要什么。
GET_ROUTES = {
    '/api/state': SESSION.state_reply,
    '/api/health': _health,
    '/api/mistakes': _mistakes,
}

# 要读查询串的那几条（历次对局列表 / 某一局的逐手回放）。处理器收一个解析好的
# 参数 dict —— 解析只在这里做一次，别每条路由各自 ``split('&')`` 一遍。
QUERY_ROUTES = {
    '/api/games': _games,
    '/api/game': _game,
    '/api/training/puzzles': lambda q: TRAINING.list_puzzles_reply(
        category=q.get('category'), motif=q.get('motif'), game_id=q.get('game_id')
    ),
    '/api/training/game-breakdown': TRAINING.game_breakdown_reply,
    '/api/sandbox': TRAINING.sandbox_reply,
    '/api/preview': TRAINING.preview_reply,
}


def _query_params(raw):
    """``limit=3&game_id=abc`` → ``{'limit': '3', 'game_id': 'abc'}``。

    同一个键重复出现时取**第一个**：两种挑法都说得通，但挑了就得写下来，否则
    哪天「列表页传了两次 limit」在两个实现里读出两个意思。空值保留 —— 界面点
    「不限」时传上来的就是 ``?limit=``，那是「没传」而不是「传了个坏值」。
    """
    return {key: values[0] for key, values in
            parse_qs(raw, keep_blank_values=True).items()}


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(SimpleHTTPRequestHandler):
    server_version = 'xq-coach'
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
        parsed = urlparse(self.path)
        path = parsed.path

        route = GET_ROUTES.get(path)
        if route is not None:
            try:
                self._reply(route())
            except Exception as exc:                      # noqa: BLE001
                self._fail(exc)
            return

        # 这两条要读查询串（limit / game_id），所以走单独一张表：参数解析在这一处
        # 做完，处理器拿到的就是一个 dict，不在每条路由里各拆一遍。
        query_route = QUERY_ROUTES.get(path)
        if query_route is not None:
            try:
                self._reply(query_route(_query_params(parsed.query)))
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
            '<title>XQ-Coach · 象棋教练</title>'
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


def _lan_ips():
    """本机可用的局域网 IPv4 列表，越可能被同网段访问到的越靠前。

    要过滤掉几类「看着像内网、其实同网段打不进来」的地址：
    198.18.0.0/15 是代理软件 TUN 网卡常用的段，100.64.0.0/10 是 Tailscale 这类
    CGNAT 组网，169.254 是链路本地——它们经常排在真实网卡前面，直接用
    「connect 一个外网地址取本地 IP」的老办法就会被带偏。
    """
    import ipaddress
    import socket

    def usable(ip):
        try:
            a = ipaddress.IPv4Address(ip)
        except ValueError:
            return False
        if a.is_loopback or a.is_link_local or a.is_unspecified:
            return False
        return not (a in ipaddress.IPv4Network('198.18.0.0/15')
                    or a in ipaddress.IPv4Network('100.64.0.0/10'))

    seen = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if usable(ip) and ip not in seen:
                seen.append(ip)
    except OSError:
        pass

    if not seen:
        import re
        import subprocess
        for cmd in (['ifconfig'], ['ip', '-4', 'addr'], ['ipconfig']):
            try:
                out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode('utf-8', errors='ignore')
                for match in re.finditer(r'(?:inet\s+|IPv4.*?:\s*)(\d+\.\d+\.\d+\.\d+)', out):
                    ip = match.group(1)
                    if usable(ip) and ip not in seen:
                        seen.append(ip)
                if seen:
                    break
            except Exception:
                continue

    def rank(ip):
        if ip.startswith('192.168.'):
            return 0
        if ip.startswith('10.'):
            return 1
        if ip.startswith('172.'):
            return 2
        return 3

    seen.sort(key=rank)
    return seen


def run(port=8010, host='127.0.0.1'):
    global CURRENT_HOST
    CURRENT_HOST = host
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
    print('  XQ-Coach · 象棋教练实训台')
    # 这一行固定写 127.0.0.1：tools/run_server.py 靠它从日志里认出实际端口
    print(f'  本机   http://127.0.0.1:{chosen}/')
    if host in ('0.0.0.0', '::', ''):
        lan_ips = _lan_ips()
        if lan_ips:
            for idx, ip in enumerate(lan_ips):
                label = '局域网' if idx == 0 else '      '
                print(f'  {label} http://{ip}:{chosen}/')
        else:
            print('  局域网 未取到本机 IP，请用 ipconfig 自查')
        print('  注意   同网段任何机器都能打开并操作，用完记得关')
    else:
        print(f'  绑定   {host}:{chosen}（仅本机可访问）')
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
    # host 优先级：--host 参数 > 环境变量 EF_HOST > 默认仅本机
    port = 8010
    host = os.environ.get('EF_HOST') or '127.0.0.1'
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ('--host', '-H') and i + 1 < len(argv):
            host = argv[i + 1]
            i += 2
            continue
        if arg.startswith('--host='):
            host = arg.split('=', 1)[1]
        elif arg.isdigit():
            port = int(arg)
        i += 1
    run(port, host)
