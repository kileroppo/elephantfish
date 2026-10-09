import json, time, re
from http.server import HTTPServer, SimpleHTTPRequestHandler

import elephantfish


def flip(i):
    """坐标关于棋盘中心对称：绝对坐标 <-> 对方视角坐标。"""
    return 254 - i


class ChessRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-type")
        SimpleHTTPRequestHandler.end_headers(self)

    def do_OPTIONS(self):
        print(f"get option req, path={self.path}")
        self.send_response(200, "ok")
        self.end_headers()

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def _send_json(self, payload, code=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        print(f"get post req, path={self.path}")
        try:
            if self.path == '/move':
                data = self._read_json()
                move = data.get('move')
                if not move:
                    self._send_json(
                        {'move': None, 'status': 'invalid', 'message': '缺少 move 参数'}, 400)
                    return
                self._send_json(process_move(move))
            elif self.path == '/new':
                data = self._read_json()
                self._send_json(new_game(data.get('player_side', 'red'),
                                         data.get('max_depth')))
            elif self.path == '/level':
                data = self._read_json()
                self._send_json(set_level(data.get('max_depth')))
            else:
                self._send_json({'error': 'Not Found'}, 404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_json({'move': None, 'status': 'error', 'message': str(e)}, 500)


def run_server(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, ChessRequestHandler)
    print(f"Starting chess server on port {port}...")
    httpd.serve_forever()


###############################################################################
# 对局状态
###############################################################################

hist = [elephantfish.Position(elephantfish.initial, 0)]
searcher = elephantfish.Searcher()
player_side = 'red'  # 玩家执子方：'red' | 'black'

# 搜索参数。迭代加深的超时检查发生在每层结束后，而每层耗时指数增长
# （初始局面实测：深度5≈0.3s、深度6≈0.7s、深度7≈14s），
# 因此用「最大深度」做主控，think_time 仅作兜底。
max_depth = 6
think_time = 3.0


def view_is_black():
    """hist[-1] 是否为黑方视角。

    Position.move() 内部会 rotate()，因此视角每走一步交替一次：
    hist[0] 红视角、hist[1] 黑视角、hist[2] 红视角 ...
    """
    return (len(hist) - 1) % 2 == 1


def player_lost():
    """以玩家视角判断是否已被将死。"""
    return hist[-1].score <= -elephantfish.MATE_LOWER


def engine_move():
    """轮到引擎走，返回绝对坐标字符串（如 'h2e2'）。"""
    start = time.time()
    best, best_depth, score = None, 0, 0
    for depth, move, sc in searcher.search(hist[-1], hist):
        if move is not None:
            best, best_depth, score = move, depth, sc
        if depth >= max_depth or time.time() - start > think_time:
            break
    if score == elephantfish.MATE_UPPER:
        print("Checkmate!")

    a, b = best
    if view_is_black():          # 黑视角坐标 -> 绝对坐标
        a, b = flip(a), flip(b)
    ai_move = elephantfish.render(a) + elephantfish.render(b)
    print("Think depth: {} My move: {} ({:.2f}s)".format(
        best_depth, ai_move, time.time() - start))

    hist.append(hist[-1].move(best))
    # 引擎走完轮到玩家，hist[-1] 即玩家视角
    elephantfish.print_pos(hist[-1])
    return ai_move


def process_move(input_move):
    """处理玩家的移动并返回引擎应手。"""
    elephantfish.print_pos(hist[-1])

    if player_lost():
        return {'move': None, 'status': 'lost', 'message': '你已经被将死了'}

    print(f"key log: input_move: {input_move}")
    match = re.match('([a-i][0-9])'*2, input_move)
    if not match:
        return {'move': None, 'status': 'invalid', 'message': '走法格式应为 h2e2'}

    i1, j1 = elephantfish.parse(match.group(1)), elephantfish.parse(match.group(2))
    # 玩家执黑时，绝对坐标要先转成黑方视角坐标
    move = (flip(i1), flip(j1)) if view_is_black() else (i1, j1)

    if move not in hist[-1].gen_moves():
        print("key log: illegal move")
        return {'move': None, 'status': 'invalid', 'message': f'非法走法 {input_move}'}

    print("key log: input move is valid")
    hist.append(hist[-1].move(move))
    elephantfish.print_pos(hist[-1].rotate())

    if player_lost():
        return {'move': None, 'status': 'won', 'message': '你将死了引擎，赢了！'}

    ai_move = engine_move()
    if hist[-1].score <= -elephantfish.MATE_LOWER:
        return {'move': ai_move, 'status': 'lost', 'message': '引擎将死了你'}
    return {'move': ai_move, 'status': 'playing', 'message': ''}


def new_game(side='red', depth=None):
    """重开一局。side 为玩家执子方；玩家执黑时引擎执红先走。"""
    global hist, searcher, player_side, max_depth
    if side not in ('red', 'black'):
        side = 'red'
    if depth:
        max_depth = max(1, min(10, int(depth)))
    player_side = side
    hist = [elephantfish.Position(elephantfish.initial, 0)]
    searcher = elephantfish.Searcher()   # 清空置换表，避免上一局残留

    moves = []
    if side == 'black':
        print("key log: engine moves first (engine = red)")
        moves.append(engine_move())
    else:
        elephantfish.print_pos(hist[-1])

    print(f"key log: new game, player side = {side}, max_depth = {max_depth}")
    return {'player_side': side, 'moves': moves, 'status': 'playing',
            'max_depth': max_depth,
            'message': f'新对局开始，你执{"红" if side == "red" else "黑"}方，'
                       f'{"你先走" if side == "red" else "引擎已先行"}'}


def set_level(depth):
    """只调整引擎搜索深度，不重开对局。"""
    global max_depth
    try:
        max_depth = max(1, min(10, int(depth)))
    except (TypeError, ValueError):
        return {'max_depth': max_depth, 'status': 'invalid', 'message': '无效的强度参数'}
    print(f"key log: max_depth = {max_depth}")
    return {'max_depth': max_depth, 'status': 'playing',
            'message': f'引擎强度已设为 {max_depth} 层'}


if __name__ == '__main__':
    import sys

    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"无效端口参数 {sys.argv[1]!r}，回退到默认端口 {port}")
    run_server(port)
