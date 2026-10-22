# -*- coding: utf-8 -*-
"""HTTP 契约自检。

`tools/verify.py` 测的是棋，而且它绕开 HTTP 直接 new 一个 Session —— 也就是说
`do_POST` / `do_GET` / 路由表 / 请求体解析 / 状态码 / 排队 / stale 任务这些
**对外契约**此前一条断言都没有。改完接口层没有任何东西会红，只能靠人肉点页面。

这个脚本把服务真的起起来，走真实 HTTP，只断言**契约**（状态码、字段、不变量），
不断言实现细节 —— 内部的类怎么改名都不该让这里变红。

    python tools/smoke_http.py                 # 自动找一个空闲端口
    python tools/smoke_http.py --port 8031
"""

import argparse
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 12 段要拿**真规则**把服务写下的棋谱重放一遍，所以引擎模块也得进这个进程。
# 只在测试里这么做是故意的：读侧不许自己再实现一套走法生成，否则「摆得上盘」
# 这句话就由两份规则各说各的了。
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from engine import core, notation as nt                             # noqa: E402

_FAILURES = []
_CHECKS = 0

# 本机代理会劫持 localhost，直连必须显式绕开
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def check(label, ok, detail=''):
    global _CHECKS
    _CHECKS += 1
    mark = 'ok  ' if ok else 'FAIL'
    line = f'  [{mark}] {label}'
    if detail:
        line += f'  —— {detail}'
    print(line)
    if not ok:
        _FAILURES.append(label)
    return ok


def section(title):
    print()
    print('=' * 72)
    print(f'  {title}')
    print('=' * 72)


def free_port(start=8031):
    for port in range(start, start + 40):
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    raise RuntimeError('找不到空闲端口')


class Client:
    def __init__(self, base):
        self.base = base

    def request(self, path, payload=None, method=None):
        """返回 (status, body_dict_or_text)。HTTP 错误也照常返回，不抛。"""
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.base + path, data=data,
                                     headers=headers, method=method)
        try:
            with _OPENER.open(req, timeout=20) as resp:
                raw = resp.read().decode('utf-8', 'replace')
                status = resp.status
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            status = e.code
        try:
            return status, json.loads(raw)
        except ValueError:
            return status, raw

    def get(self, path):
        return self.request(path, method='GET')

    def post(self, path, payload=None):
        return self.request(path, payload if payload is not None else {})


def wait_idle(client, timeout=25.0):
    """等到服务端没有搜索在跑。判据取服务端真实状态，不猜前端轮询延迟。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        status, body = client.get('/api/state')
        if status != 200:
            return None
        last = body['state']
        task = last.get('task')
        if not task or task.get('status') != 'running':
            return last
        time.sleep(0.15)
    return last


def wait_quiet(client, timeout=30.0):
    """等到**两路**搜索都收手：引擎的应手，和借空闲算力跑的那次判分。

    与 ``wait_idle`` 的分别是 ``analysis`` 那个键：``_stop_analysis`` 只置
    ``stop_event``，那条线程还会自己跑一小会儿才把 status 从 running 收到
    done。要拿两份 ``/api/state`` 逐字段对等，就得等它落到终态，否则比出来
    的红是线程收尾，跟这条断言想测的东西无关。
    """
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        status, body = client.get('/api/state')
        if status != 200:
            return None
        last = body['state']
        busy = [t for t in (last.get('task'), last.get('analysis'))
                if t and t.get('status') == 'running']
        if not busy:
            return last
        time.sleep(0.15)
    return last


def without_clocks(state):
    """抹掉每次读数现算的那些墙上时钟，其余**全部**留着比。

    ``server_time`` 一眼就知道是时钟；``analysis.elapsed`` 藏在那个 dict 里
    （``session.py`` 的 ``to_dict`` 现算 ``time.time() - started``），判分早就
    跑完了它照样一跳一跳地涨。``task.elapsed`` 是同一类东西，而且更隐蔽：
    搜索收手之后那个 dict 还挂在 ``state`` 上（换局/悔棋才清），于是 12 段这种
    「下完一局再读历史」的比法会拿它当差异报出来 —— 那量的还是钟，不是状态。
    除这几处之外都不许放过 —— 放过一条就是给「读历史会改会话状态」留了一个
    可以藏身的地方。
    """
    out = {k: v for k, v in state.items() if k != 'server_time'}
    for key in ('task', 'analysis'):
        sub = out.get(key)
        if isinstance(sub, dict):
            out[key] = {k: v for k, v in sub.items() if k != 'elapsed'}
    return out


def _open_archive(path):
    """另开一条连接去读**服务进程**写下的档。

    读写连接而不是 ``mode=ro``：WAL 库在只读连接下要先能建 ``-shm``，
    而这里读的本来就是临时目录里的自检档，没有写坏可言。
    """
    return sqlite3.connect(path, timeout=10.0)


# 逐手回放的响应契约：这两串键名是**对外契约**，所以在这里写成字面量，
# 不去引用 ``server/store.py`` 的常量 —— 引用自己测的东西等于没测：那边悄悄多
# 一列或少一列，界面读的是这份清单，这里就得为它红一次。
GAME_HEAD_KEYS = {'game_id', 'start_fen', 'engine_side', 'source', 'opened_at',
                  'updated_at', 'ply_count', 'fen_now', 'state', 'winner',
                  'reason', 'outcome'}
PLY_KEYS = {'ply', 'side', 'by', 'iccs', 'chinese', 'piece', 'captured',
            'gives_check', 'mate', 'eval_red', 'mate_in', 'depth', 'think_time',
            'fen_before', 'review'}


def _replay_problems(game_row, plies):
    """把 ``/api/game`` 交回的那局**在真规则上走一遍**，报出不合的地方。

    为什么这里再走一遍、而不是只信 ``fen_before``：这条链验的是「界面拿着这份
    响应，一手手能不能真把棋摆回盘上」。只比存档自己那一列，比的永远是同一个人
    写的两份东西；从 ``start_fen`` 出发落子才算**外部**证据 —— 而且这一步跨的
    是进程与服务，服务交出来的那一份在 HTTP 之后仍然要能重放，才算数。
    判据本身与 ``tools/verify.py`` 的 O 段同一件事，那一份管「库里对不对」，
    这一份管「服务交出去的那一份对不对」，中间隔着一条 HTTP 与一本 WAL。
    """
    board, red, _h, _m = nt.from_fen(game_row['start_fen'])
    for row in plies:
        if nt.to_fen(board, red) != row['fen_before']:
            return [f'第 {row["ply"]} 手：重放 {nt.to_fen(board, red)} ≠ '
                    f'响应 fen_before {row["fen_before"]}']
        move = nt.from_iccs(row['iccs'])
        if move is None:
            return [f'第 {row["ply"]} 手 iccs {row["iccs"]!r} 不是走法']
        if move not in core.legal_moves(board, red):
            return [f'第 {row["ply"]} 手 {row["iccs"]} 在那个局面里不合法']
        board = core.apply_move(board, red, move)
        red = not red
    final = nt.to_fen(board, red)
    if final != game_row['fen_now']:
        return [f'重放到最后 {final} ≠ fen_now {game_row["fen_now"]}']
    return []


# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(description='elephantfish HTTP 契约自检')
    ap.add_argument('--port', type=int, default=None)
    args = ap.parse_args()

    port = args.port or free_port()
    base = f'http://127.0.0.1:{port}'
    log_path = os.path.join(ROOT, f'smoke-{port}.log')
    # 自检不许往用户的真档（data/elephantfish.sqlite）里写测试棋 —— 那本账是越下
    # 越厚的。指到临时文件而不是 EF_STORE=off：那样 HTTP 这一层才真的走一遍落库，
    # 掉在写路径上的坑才有机会在这里红。
    env = {**os.environ,
           'EF_STORE_PATH': os.path.join(tempfile.mkdtemp(prefix='ef-smoke-'),
                                         'smoke.sqlite')}

    print('elephantfish HTTP 契约自检')
    print(f'  服务 {base}   日志 {log_path}')

    with open(log_path, 'wb') as log:
        proc = subprocess.Popen([sys.executable, os.path.join('server', 'app.py'), str(port)],
                                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                env=env)
        try:
            client = Client(base)
            # 等服务起来
            up = False
            for _ in range(60):
                try:
                    status, _ = client.get('/api/health')
                    if status == 200:
                        up = True
                        break
                except Exception:                             # noqa: BLE001
                    pass
                time.sleep(0.3)
            if not up:
                print(f'  服务没起来，见 {log_path}')
                return 1

            run(client, env['EF_STORE_PATH'])
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    print()
    print('=' * 72)
    print('  汇总')
    print('=' * 72)
    print(f'  断言 {_CHECKS} 条，失败 {len(_FAILURES)} 条')
    if _FAILURES:
        print('  失败清单：')
        for name in _FAILURES:
            print(f'    - {name}')
        return 1
    print('  —— 全部通过 ——')
    return 0


def run(client, store_path):
    # ---- 1. 探活与状态契约 ---- #
    section('1. /api/health 与 /api/state 的字段契约')

    status, health = client.get('/api/health')
    check('/api/health 返回 200', status == 200, f'status={status}')
    check('health.engine 用显示词表（pikafish / elephantfish）',
          health.get('engine') in ('pikafish', 'elephantfish'), str(health.get('engine')))
    check('health 带 pikafish_available 布尔与 python 版本',
          isinstance(health.get('pikafish_available'), bool) and bool(health.get('python')))

    status, body = client.get('/api/state')
    state = body.get('state') or {}
    expected = {'game', 'task', 'settings', 'engine_info', 'opponent',
                'stats', 'game_stats', 'pending', 'notice', 'server_time'}
    check('state 顶层字段齐全', expected <= set(state),
          f'缺 {sorted(expected - set(state))}')
    check('settings.engine_type 用设置词表（pikafish / builtin）',
          state.get('settings', {}).get('engine_type') in ('pikafish', 'builtin'),
          str(state.get('settings', {}).get('engine_type')))
    check('engine_info.active 用设置词表',
          state.get('engine_info', {}).get('active') in ('pikafish', 'builtin'),
          str(state.get('engine_info', {}).get('active')))

    # ---- 2. 引擎执黑应手：黑方参考系（端到端） ---- #
    section('2. 引擎执黑应手（黑方参考系 —— 坐标翻转的端到端判据）')

    # 关键手法：auto_reply=False 把「录入对方走法」和「让引擎出招」拆成两个请求。
    # 否则引擎会在 /api/move 那一个请求里就应手（内置引擎命中开局库时是毫秒级），
    # 想读一眼「引擎出手之前的合法着法集合」就必然踩竞态 —— 会读到它出手之后的局面。
    status, body = client.post('/api/new', {
        'engine_side': 'black', 'auto_reply': False,
        'think_ms': 900, 'engine_type': 'builtin'})
    check('/api/new 返回 200', status == 200, f'status={status}')
    game = body['state']['game']
    check('auto_reply=False 时不自动开搜', body['state'].get('task') is None,
          f'task={body["state"].get("task")}')
    check('引擎执黑时轮到对方（红）走棋，且没有搜索在跑',
          game['turn'] == 'red' and game['ply'] == 0,
          f'turn={game["turn"]} ply={game["ply"]}')
    check('开局有合法着法可走', len(game['legal_moves']) > 0,
          f'{len(game["legal_moves"])} 步')

    # 录入对方（红）走法。auto_reply=False，所以这一步之后引擎仍然没开搜 ——
    # 于是这个响应里的合法着法集合，就是引擎接下来必须从中选一个的那个集合。
    status, body = client.post('/api/move', {'move': game['legal_moves'][0]['iccs']})
    check('录入对方走法返回 200', status == 200, f'status={status}')
    black_turn = body['state']['game']
    check('录入之后轮到引擎（黑方）走棋',
          black_turn['turn'] == 'black' and black_turn['opponent_to_move'] is False,
          f'turn={black_turn["turn"]}')
    black_legal = {(m['from'], m['to']) for m in black_turn['legal_moves']}
    check('引擎出手前能读到黑方合法着法集合', len(black_legal) > 0,
          f'{len(black_legal)} 步')

    status, body = client.post('/api/engine-move', {})
    check('/api/engine-move 返回 200', status == 200, f'status={status}')
    state = wait_idle(client)
    task = state.get('task') or {}
    result = task.get('result') or {}
    check('搜索正常收尾（不是 error）—— 引擎那步通过了服务端的合法性校验',
          result.get('status') == 'ok',
          f'status={result.get("status")} err={task.get("error")}')
    check('task.result.engine 报的是实际生效的引擎',
          result.get('engine') in ('pikafish', 'elephantfish'),
          str(result.get('engine')))
    # 排名与界标要一路活到浏览器，讲解层才敢说「你这一手排第 3、差 1.4 兵」。
    # 这两个字段在 HTTP 这一层掉一次，页面只会静默地按「第 1 名、精确值」显示，
    # 把上界当精确分讲给学员 —— 那种错不会有任何东西变红，所以必须在这里钉住。
    progress = task.get('progress') or {}
    check('task.progress 带着名次与界标（单线时名次恒 1）',
          progress.get('multipv') == 1
          and progress.get('bound') in ('exact', 'lowerbound', 'upperbound'),
          f"multipv={progress.get('multipv')} bound={progress.get('bound')}")
    by_engine = [r for r in state['game']['records'] if r['by'] == 'engine']
    check('引擎落了一手', len(by_engine) == 1, f'{len(by_engine)} 手')
    if by_engine:
        rec = by_engine[0]
        check('黑方应手落在出手前的合法着法集合里（参考系没翻错）',
              (rec['from'], rec['to']) in black_legal,
              f'{rec["iccs"]} {rec["chinese"]}')
        check('棋谱里带上了红方视角评分与搜索深度',
              isinstance(rec.get('eval'), (int, float)) and bool(rec.get('depth')),
              f'eval={rec.get("eval")} depth={rec.get("depth")}')

    # ---- 3. 引擎执红先手：红方参考系（另一半） ---- #
    section('3. 引擎执红先手（红方参考系 —— 另一半）')

    status, body = client.post('/api/new', {
        'engine_side': 'red', 'auto_reply': False,
        'think_ms': 900, 'engine_type': 'builtin'})
    red_game = body['state']['game']
    red_legal = {(m['from'], m['to']) for m in red_game['legal_moves']}
    check('引擎执红时轮到引擎走棋', red_game['turn'] == 'red',
          f'turn={red_game["turn"]}')

    client.post('/api/engine-move', {})
    state = wait_idle(client)
    by_engine = [r for r in state['game']['records'] if r['by'] == 'engine']
    check('红方先手也落了一手', len(by_engine) == 1, f'{len(by_engine)} 手')
    if by_engine:
        rec = by_engine[0]
        check('红方先手那一步也在合法集合里',
              (rec['from'], rec['to']) in red_legal,
              f'{rec["iccs"]} {rec["chinese"]}')

    # ---- 4. 错误契约（状态码与消息） ---- #
    section('4. 错误契约（状态码与消息）')

    # 现在是黑方的回合（引擎刚执红走完第 1 手），塞一手红方走法应当被拒
    status, body = client.post('/api/move', {'move': 'h2e2'})
    check('不是该方走棋 -> 400 且带 message',
          status == 400 and bool(body.get('message')),
          f'status={status} msg={body.get("message")}')

    status, body = client.post('/api/move', {'move': 'z9z9'})
    check('看不懂的走法 -> 400 且带 message',
          status == 400 and bool(body.get('message')),
          f'status={status} msg={body.get("message")}')

    status, body = client.get('/api/nope')
    check('未知 GET 接口 -> 404', status == 404, f'status={status}')

    status, body = client.post('/api/nope', {})
    check('未知 POST 接口 -> 404', status == 404, f'status={status}')

    status, body = client.request('/api/move', method='POST')
    check('空请求体不 500', status in (400, 200), f'status={status}')

    # ---- 5. 引擎偏好切换 ---- #
    section('5. engine_type 切换（active 必须跟着走）')

    status, body = client.post('/api/settings', {'engine_type': 'pikafish'})
    active = body['state']['engine_info']['active']
    available = body['state']['engine_info']['pikafish_available']
    check('切到 pikafish 后 active 跟随（没装则降级 builtin）',
          active == ('pikafish' if available else 'builtin'),
          f'active={active} available={available}')

    status, body = client.post('/api/settings', {'engine_type': 'nonsense'})
    check('非法 engine_type 被拒但请求仍然成功',
          status == 200 and body['state']['settings']['engine_type'] in ('pikafish', 'builtin'),
          f'status={status} now={body["state"]["settings"]["engine_type"]}')

    client.post('/api/settings', {'engine_type': 'builtin'})

    # ---- 6. /api/load 与 /api/undo ---- #
    section('6. /api/load 与 /api/undo')

    # 载入 3 手：ply=3 时轮到黑方，引擎（执红）不动 —— 于是不会有搜索插进来。
    status, body = client.post('/api/load', {
        'moves': ['h2e2', 'h9g7', 'h0g2'], 'engine_side': 'red'})
    check('按走法序列载入 -> 200 且手数正确',
          status == 200 and body['state']['game']['ply'] == 3,
          f'status={status} ply={body["state"]["game"].get("ply")}')

    status, body = client.post('/api/undo', {'round': True})
    check('undo round 退掉一整回合（3 -> 1）',
          status == 200 and body['state']['game']['ply'] == 1,
          f'status={status} ply={body["state"]["game"].get("ply")}')

    status, body = client.post('/api/load', {'moves': ['h2e2', '这不是一步棋']})
    check('序列里有坏走法 -> 400 且指出是第几步',
          status == 400 and '2' in str(body.get('message')),
          f'status={status} msg={body.get("message")}')

    status, body = client.post('/api/clear-pending', {})
    check('/api/clear-pending 返回 200 且带 message',
          status == 200 and bool(body.get('message')),
          f'status={status} msg={body.get("message")}')

    # ---- 7. auto_reply 默认行为 ---- #
    section('7. auto_reply 默认开启时，录入对方走法会自动触发应手')

    status, body = client.post('/api/new', {
        'engine_side': 'black', 'auto_reply': True,
        'think_ms': 900, 'engine_type': 'builtin'})
    mv = body['state']['game']['legal_moves'][0]
    status, body = client.post('/api/move', {'move': mv['iccs']})
    check('auto_reply=True 时录入对方走法立刻起搜或已应手',
          status == 200 and (body.get('auto_task') or
                             (body['state'].get('task') is not None)),
          f'auto_task={body.get("auto_task")}')
    state = wait_idle(client)
    check('引擎应手落地', any(r['by'] == 'engine' for r in state['game']['records']),
          f'ply={state["game"]["ply"]}')
    wait_idle(client)

    # ---- 8. 任务轮询与 stale 语义 ---- #
    section('8. /api/task/<id> 轮询与 stale 语义')

    # 6 手之后轮到红方，引擎（执红）开搜；6 手已过开局库，会真的搜满 think_ms。
    status, body = client.post('/api/load', {
        'moves': ['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i0h0', 'a9a8'],
        'engine_side': 'red', 'think_ms': 10000})
    task = body['state'].get('task')
    if task and task.get('status') == 'running':
        status, body = client.get('/api/task/deadbeef0000')
        check('拿一个不存在的 id 轮询 -> 200 且标 stale（不是 404）',
              status == 200 and body.get('stale') is True and 'task' in body,
              f'status={status} stale={body.get("stale")}')

        status, body = client.get(f'/api/task/{task["id"]}')
        check('拿正确的 id 轮询 -> stale 为 False',
              status == 200 and body.get('stale') is False,
              f'status={status} stale={body.get("stale")}')

        status, body = client.post(f'/api/task/{task["id"]}/stop')
        check('按下停止 -> ok 为 True', status == 200 and body.get('ok') is True,
              f'status={status} ok={body.get("ok")}')

        status, body = client.post('/api/task/deadbeef0000/stop')
        check('停一个不存在的 id -> ok 为 False（不是报错）',
              status == 200 and body.get('ok') is False,
              f'status={status} ok={body.get("ok")}')
    else:
        # 开局库把这一手也命中了：任务窗口太窄，明确标出来而不是假装通过
        check('长考窗口（开局库命中，stale 一段跳过）', True,
              f'task={task and task.get("status")}')

    # ---- 9. 评分字段：一把尺、两个视角，端到端都得在 HTTP 里成立 ---- #
    section('9. 评分字段（centipawn / eval_red / mate_in）')

    # 这一节验的是「前端拿到那个数之后能不能直接读」。以前接缝把内置引擎的
    # 分（一兵 44）和皮卡鱼的分（centipawn）混进同一个字段，而 progress 只给
    # 走子方视角、records 只给红方视角 —— 于是引擎执黑思考时整个评分面板左右
    # 反转，而「让一车多」被念成「1197 步杀」。两条都是靠这里补的断言钉住。
    def _finish_search(engine_side):
        """让引擎走完一手，返回 (最后一层 progress, 引擎那手的棋谱行)。

        ``task.progress`` 收尾后不会被清空，所以不必去抢「还在跑」的瞬间 ——
        那种断言必然偶发，是这套自检反复躲开的写法。
        """
        cn = '黑' if engine_side == 'black' else '红'
        client.post('/api/new', {'engine_side': engine_side, 'auto_reply': False,
                                 'think_ms': 700, 'engine_type': 'builtin'})
        if engine_side == 'black':
            # 引擎执黑：先替红方录一手，才轮到引擎思考
            status, body = client.get('/api/state')
            first = body['state']['game']['legal_moves'][0]['iccs']
            client.post('/api/move', {'move': first})
        client.post('/api/engine-move', {})
        state = wait_idle(client)
        progress = (state.get('task') or {}).get('progress') or {}
        rec = [r for r in state['game']['records'] if r['by'] == 'engine']
        return cn, progress, (rec[-1] if rec else None)

    for side, expect_sign in (('black', -1), ('red', 1)):
        cn, progress, rec = _finish_search(side)
        want = {'score', 'eval_red', 'mate', 'mate_in', 'book'}
        check(f'引擎执{cn}时 progress 带齐评分字段', want <= set(progress),
              f"缺 {sorted(want - set(progress))}")
        if want <= set(progress):
            # 视角关系：eval_red 恒等于 score 按「走子方是不是红方」翻一次
            check(f'引擎执{cn}：eval_red 与 score 成红方视角',
                  progress['eval_red'] == progress['score'] * expect_sign,
                  f"score={progress['score']} eval_red={progress['eval_red']}")
            if progress['mate_in'] is None:
                # 单位：一车才 530cp，非杀棋层报出这个量级就是单位又串了
                check('非杀棋层的分落在 centipawn 量级内',
                      abs(progress['score']) <= 2000, f"score={progress['score']}")
            else:
                check('杀棋层的分退化成方向，距离归 mate_in',
                      abs(progress['score']) == 10000 and progress['mate_in'] >= 0,
                      f"score={progress['score']} mate_in={progress['mate_in']}")
        if rec:
            check('棋谱行带 mate_in（键必须在，哪怕这一层不是杀棋）',
                  'mate_in' in rec, f"eval={rec.get('eval')}")

    # 人录的那一步现在也有分了。轮到人的那段时间里，服务用**空闲算力**把这个
    # 局面的前几名搜一遍（人一走就停），人落子时对着那批线打分。这条以前写的是
    # 「已知缺口，接上 analyze 任务时这条会红」—— 现在翻成正断言：缺口变成契约，
    # 以后谁把它改回没有分数，这里就红。
    def wait_analysis(limit=25.0):
        """等后台判分**收手**，不是等「刚冒出几条」。

        排名线是整层整层换的：第 d 层的第 1 名到 d+1 层可能掉出前三。这里先冒头
        就挑 `lines[0]` 去录，服务判分用的却是最终那批线，人就被判成「掉出前几名、
        差多少不知道」（rank=None）—— 抢跑的是这条自检，不是产品。等 status 落到
        done，挑的那一手与打分用的那批线才是同一批。
        """
        t0 = time.time()
        last = None
        while time.time() - t0 < limit:
            last = client.get('/api/state')[1]['state']
            a = last.get('analysis') or {}
            if a.get('status') in ('error', 'skipped'):
                return last
            if a.get('lines') and a.get('status') == 'done':
                return last
            time.sleep(0.12)
        return last or client.get('/api/state')[1]['state']

    client.post('/api/new', {'engine_side': 'black', 'auto_reply': False,
                             'engine_type': 'builtin', 'analyze': True,
                             'analyze_ms': 1200, 'analyze_depth': 10,
                             'analyze_width': 3})
    state = wait_analysis()
    analysis = state.get('analysis') or {}
    lines = analysis.get('lines') or []
    check('轮到人的那段时间里，服务把这个局面的前几名算了出来',
          len(lines) >= 2 and analysis.get('subject')
          and analysis.get('status') != 'error',
          f"status={analysis.get('status')} 线条={len(lines)}")
    if lines:
        client.post('/api/move', {'move': lines[0]['iccs']})
        state = wait_idle(client)
        human = [r for r in state['game']['records'] if r['by'] != 'engine']
        rv = (human[0].get('review') or {}) if human else {}
        check('人录的一步拿到名次与差值（走的就是正解那一手）',
              bool(human) and rv.get('rank') == 1
              and rv.get('played_iccs') == lines[0]['iccs']
              and rv.get('loss_kind') in ('exact', 'at_least', 'at_most',
                                          'uncertain', 'mate', 'below_top'),
              f"rank={rv.get('rank')} kind={rv.get('loss_kind')}")
        check('人这一步的 eval 不再空着：走势线不止引擎那半边',
              bool(human) and human[0]['eval'] is not None,
              f"eval={human[0]['eval'] if human else '无记录'}")
        # 「为什么更差」那份事实：服务端只报事实（第几步、哪一方吃的、吃了什么子），
        # 句子由 frontend/src/lib/format.ts 组装。这里只钉形状 —— 键名一旦被改，
        # 界面读到的是「没看过」，而那句谎话没人看得见。
        def _cap_shape(v):
            return (v is None
                    or (isinstance(v, dict)
                        and set(v) == {'ply', 'iccs', 'chinese', 'by', 'captured'}
                        and isinstance(v['ply'], int) and v['ply'] >= 1
                        and v['by'] in ('red', 'black')
                        and all(isinstance(v[k], str) and v[k]
                                for k in ('iccs', 'chinese', 'captured'))))

        reason = rv.get('reason')
        if rv.get('status') == 'ok':
            check('判到手的那一手在快照里带齐 reason 的四个键，一个不多一个不少',
                  set(reason or {}) == {'side', 'pv_plies', 'best', 'played'}
                  and reason['side'] in ('red', 'black')
                  and isinstance(reason['pv_plies'], int) and reason['pv_plies'] > 0,
                  f"reason={str(reason)[:170]}")
            check('best / played 各是「第一次吃到子那一手」或 None，字段一模一样',
                  bool(reason) and all(_cap_shape(reason[k]) for k in ('best', 'played')),
                  f"reason={str(reason)[:170]}")
        else:
            check('这一手没判进排名线（status 不是 ok）就不该有 reason：键缺位是「没看过」',
                  'reason' not in rv, f"status={rv.get('status')}")

    wait_idle(client)

    # ---- 10. 存档：换一个进程读，服务真的写进去了 ---- #
    section('10. 存档是投影（端到端：服务进程写，这里读）')

    # verify.py 的 L 节在**同一个进程**里 new Session、同一把连接读档，
    # 证明的是投影逻辑对。这一节证明的是另一件事：`server/app.py` 起起来之后
    # 那条写路径确实挂在 HTTP 动词上 —— 少接一处，L 节照样绿。
    client.post('/api/new', {'engine_side': 'black', 'auto_reply': True,
                             'think_ms': 700, 'engine_type': 'builtin'})
    status, body = client.get('/api/state')
    client.post('/api/move', {'move': body['state']['game']['legal_moves'][0]['iccs']})
    state = wait_idle(client)
    records = state['game']['records']

    try:
        db = _open_archive(store_path)
        tables = {r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.Error as exc:
        tables = set()
        print(f'  读不开自检档 {store_path}：{exc}')
    check('服务进程在档里建了 games / plies / agg_stats 三张表',
          {'games', 'plies', 'agg_stats'} <= tables,
          f'读到 {sorted(tables)}')
    if not {'games', 'plies', 'agg_stats'} <= tables:
        return

    # 每开一局都是一行新记录，所以最新那一行就是眼下这一局。
    game_id, ply_count, fen_now, source = db.execute(
        'SELECT game_id, ply_count, fen_now, source FROM games '
        'ORDER BY rowid DESC LIMIT 1').fetchone()
    rows = db.execute('SELECT ply, iccs, by, eval_red, fen_before, review '
                      'FROM plies WHERE game_id=? ORDER BY ply',
                      (game_id,)).fetchall()

    check('引擎替黑落的那一手也进了库（worker 里那条 sync 挂在 HTTP 上）',
          [r[2] for r in rows].count('engine') == 1 and len(records) == 2,
          f"库里 by={[r[2] for r in rows]} 实况 {len(records)} 手")
    check('库里的 ICCS 与实况棋谱逐手相同，行数不多不少',
          [r[1] for r in rows] == [x['iccs'] for x in records],
          f"库 {[r[1] for r in rows]} vs 实况 {[x['iccs'] for x in records]}")
    check('ply_count 就是 plies 的行数（不是靠猜的差一行）',
          ply_count == len(rows), f'games.ply_count={ply_count} 行数={len(rows)}')
    check('引擎那一手的分进了库 —— eval_red 正是学习要用的那一列',
          any(r[2] == 'engine' and r[3] is not None for r in rows),
          str([(r[2], r[3]) for r in rows]))
    check('每一行都带落子前的局面（逐手判分不必再靠重放去凑）',
          all(r[4] for r in rows), str([r[4] for r in rows][:2]))
    # 判分整份进了库，但只许待在它自己那一步上：安错局面的判分不会报错，
    # 它只是让错题本从此每一步都讲错题。
    check('库里每步的 review 只属于它自己那一步（判分不许安错局面）',
          all(r[5] is None or json.loads(r[5])['played_iccs'] == r[1]
              for r in rows),
          str([(r[1], bool(r[5])) for r in rows]))
    check('games.fen_now 与实况 fen 相同（派生列没走偏）',
          fen_now == state['game']['fen'], f'库里 {fen_now}')
    check('跟引擎下的那局标成 source=play', source == 'play', f'source={source}')

    client.post('/api/undo', {'round': True})
    state = client.get('/api/state')[1]['state']
    rows = db.execute('SELECT COUNT(*) FROM plies WHERE game_id=?',
                      (game_id,)).fetchone()[0]
    check('悔棋在服务进程里也真的落库（库里不是差一行）',
          rows == len(state['game']['records']) == 0,
          f'库里 {rows} 行 实况 {len(state["game"]["records"])} 手')

    # 排局另起一行：旧局必须原样留在库里，学习要的是「每一局」而不是「最后一局」。
    before = db.execute('SELECT COUNT(*) FROM games').fetchone()[0]
    client.post('/api/load', {'fen': '4k4/9/9/9/9/9/9/9/8K/R8 w - - 0 1'})
    state = client.get('/api/state')[1]['state']
    gid2, ply2, src2 = db.execute(
        'SELECT game_id, ply_count, source FROM games ORDER BY rowid DESC LIMIT 1'
    ).fetchone()
    check('排局另发身份证、标成 setup，games 确实多了一行',
          db.execute('SELECT COUNT(*) FROM games').fetchone()[0] == before + 1
          and gid2 != game_id and src2 == 'setup' and ply2 == len(state['game']['records']),
          f'games {before} → {db.execute("SELECT COUNT(*) FROM games").fetchone()[0]} '
          f'source={src2} ply_count={ply2}')

    orphan = db.execute('SELECT COUNT(*) FROM plies WHERE game_id NOT IN '
                        '(SELECT game_id FROM games)').fetchone()[0]
    check('没有孤儿行（外键与级删在真实写入下成立）', orphan == 0, f'{orphan} 行')

    ledger = dict(db.execute('SELECT key, value FROM agg_stats'))
    check('跨重启那本累计账写进了 agg_stats',
          ledger.get('moves', 0) >= 1, str(ledger))

    # ---- 11. 错题本：另起一趟 HTTP 读，账要对得上同一本档 ---- #
    section('11. GET /api/mistakes（跨历次对局按局面聚合，只读）')

    def _graded_move():
        """开一局、等排名线排好、替人录**最靠后**的那一手，回来那一手的判分。

        判分借的是空闲算力：拿不到就这一轮不判，也不排队。所以必须先等
        ``analysis`` 收手再录 —— 抢在它还在跑的时候录，那一手压根没判分，
        错题本里也就没这一笔（那是偶发红的来源，不是判据）。
        五局都从初始局面开局：``fen_before`` 只带局面与行棋方，所以它们的
        分组键天生相同 —— 「按局面聚合」这件事在这里才有东西可聚。
        """
        client.post('/api/new', {'engine_side': 'black', 'auto_reply': False,
                                 'analyze': True, 'engine_type': 'builtin',
                                 'think_ms': 400, 'analyze_ms': 1200,
                                 'analyze_depth': 12, 'analyze_width': 3})
        state = client.get('/api/state')[1]['state']
        deadline = time.time() + 30
        while time.time() < deadline:
            state = client.get('/api/state')[1]['state']
            if (state.get('analysis') or {}).get('status') == 'done':
                break
            time.sleep(0.1)
        lines = (state.get('analysis') or {}).get('lines') or []
        start_fen = state['game']['fen']
        # 挑「与第 1 名差得最远」的那条：全都同分时它也可能是 0，那种情况
        # 下面按服务交回的判分原样对账，不靠猜。
        move = (max(lines, key=lambda l: -(l['score']))['iccs'] if lines
                else state['game']['legal_moves'][0]['iccs'])
        client.post('/api/move', {'move': move})
        review = None
        deadline = time.time() + 10
        while time.time() < deadline:
            recs = [r for r in client.get('/api/state')[1]['state']['game']['records']
                    if r['by'] == 'opponent']
            if recs and recs[-1].get('review'):
                review = recs[-1]['review']
                break
            time.sleep(0.1)
        return start_fen, review

    start_fen = None
    served = []
    for _ in range(5):
        fen, review = _graded_move()
        start_fen = fen
        served.append(review)
    check('五局各留下一手带判分的人步（判分确实经 HTTP 那条写路径进了档）',
          sum(1 for r in served if r) == 5, f'{sum(1 for r in served if r)}/5')
    # 「有一题可列」的前提由服务交回的判分自己说：证得出更差的那些手才是错题。
    proven = [r for r in served
              if r and r.get('loss_kind') in ('exact', 'at_least')
              and isinstance(r.get('loss'), int) and r['loss'] > 0]
    check('这五手里至少有一手被**判分本身**证得出更差（否则这道题没东西可聚合）',
          len(proven) >= 1, str([(r or {}).get('loss_kind'), (r or {}).get('loss')]
                                 for r in served)[:160])

    before_counts = dict((t, db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
                         for t in ('games', 'plies', 'agg_stats'))
    state_a = wait_quiet(client)
    status, book = client.get('/api/mistakes')
    status2, book2 = client.get('/api/mistakes')
    state_b = client.get('/api/state')[1]['state']

    mistakes = book.get('mistakes') or []
    summary = book.get('summary') or {}
    check('GET /api/mistakes -> 200 且 ok',
          status == 200 and book.get('ok') is True, f'status={status}')
    check('响应只有 mistakes 与 summary：不夹带 state，也不回一份会话快照',
          isinstance(mistakes, list) and isinstance(summary, dict)
          and 'state' not in book, f'键={sorted(book)}')
    check('summary 字段齐（含 limit 与 store_enabled），且这一趟存档是开着的',
          {'positions', 'listed', 'miss_positions', 'graded_plies', 'misses',
           'exact_misses', 'at_least_misses', 'mate_misses', 'clean', 'blurred',
           'unreadable', 'games', 'limit', 'store_enabled'} <= set(summary)
          and summary.get('store_enabled') is True, f"缺 {sorted(set(summary))}")

    # ---- 与另一个进程的 plain SQL 对账：读的是同一本 WAL 档 ---- #
    db2 = _open_archive(store_path)
    rows = db2.execute("SELECT fen_before, game_id, ply, review FROM plies "
                       "WHERE by='opponent' AND review IS NOT NULL").fetchall()
    groups = {}
    for fen, gid, ply, raw in rows:
        g = groups.setdefault(fen, {'graded': 0, 'games': set(), 'kinds': {},
                                   'proven': {}})
        g['graded'] += 1
        g['games'].add(gid)
        rv = json.loads(raw)
        kind = str(rv.get('loss_kind'))
        g['kinds'][kind] = g['kinds'].get(kind, 0) + 1
        # 「证得出更差」这一句用的是服务自己交回的判分字段，不是第二套门槛：
        # exact / at_least 给的都是真值的下界，loss>0 就已经比较出来了。
        if kind in ('exact', 'at_least') and isinstance(rv.get('loss'), int) \
                and rv['loss'] > 0:
            g['proven'][kind] = g['proven'].get(kind, 0) + 1
    check('summary 的局面数与总判分次数就是库里的数（不是只数最近那局）',
          summary.get('positions') == len(groups)
          and summary.get('graded_plies') == len(rows)
          and summary.get('games') == len({r[1] for r in rows}),
          f"库 {len(groups)} 个局面 / {len(rows)} 手，"
          f"接口 {summary.get('positions')} / {summary.get('graded_plies')}")

    target = next((e for e in mistakes if e['fen_before'] == start_fen), None)
    want = groups.get(start_fen) or {}
    check('按 fen_before 跨局聚合：初始局面那一题攒的判分手次与库里的行数一致',
          target is not None and want.get('graded', 0) >= 5
          and target['graded_plies'] == want['graded']
          and target['games'] == len(want['games']) and len(want['games']) >= 5,
          f"接口 {target and (target['graded_plies'], target['games'])} "
          f"库 {(want.get('graded'), len(want.get('games', [])))}")
    check('跨局数出来的不是同一局：那一题涉及局数不少于判分次数（每局只出一手）',
          target is not None and target['graded_plies'] >= target['games'],
          str(target and (target['graded_plies'], target['games'])))
    check('exact / at_least 两类错题数与库里逐手判分对得上',
          target is not None
          and target['exact_misses'] == want['proven'].get('exact', 0)
          and target['at_least_misses'] == want['proven'].get('at_least', 0),
          str(target and (target['exact_misses'], target['at_least_misses']))
          + ' vs ' + str(want.get('proven')))

    # 接口列出的每题都得能在库里数到：凭空的题说明两边的读法已经分叉了。
    ghost = [e['fen_before'][:20] for e in mistakes if e['fen_before'] not in groups]
    check('接口列出的每一题都能在库里数到（没有凭空的题）', not ghost, str(ghost[:2]))

    # 每一题都得过一遍这四条：它们与门槛无关，纯是账目守恒，一处对不上就是聚合漏了。
    bad = [e['fen_before'][:20] for e in mistakes
           if e['misses'] != e['exact_misses'] + e['at_least_misses'] + e['mate_misses']
           or e['misses'] + e['clean'] + e['blurred'] + e['unreadable']
           != e['graded_plies']
           or sum(e['blurred_kinds'].values()) != e['blurred']
           or e['graded_plies'] != (groups.get(e['fen_before']) or {}).get('graded')]
    check('每题四档守恒：misses 分三类、四档相加等于判分次数、blurred_kinds 等于 blurred',
          not bad and bool(mistakes), f'不合的题：{bad[:2]}')

    # 没证出来的那些一律不许进 misses：那三类在库里有几手，题里就得有几手。
    blurred_wrong = []
    for e in mistakes:
        kinds = (groups.get(e['fen_before']) or {}).get('kinds', {})
        want_kinds = {k: n for k, n in kinds.items()
                      if k in ('at_most', 'uncertain', 'below_top')}
        got_kinds = {k: n for k, n in e['blurred_kinds'].items()
                     if k in ('at_most', 'uncertain', 'below_top')}
        counted = e['exact_misses'] + e['at_least_misses'] + e['mate_misses']
        if got_kinds != want_kinds or e['misses'] != counted:
            blurred_wrong.append((e['fen_before'][:20], got_kinds, want_kinds,
                                  e['misses'], counted))
    check('at_most / uncertain / below_top 只进「看不准」，一次都没混进 misses',
          not blurred_wrong, str(blurred_wrong[:2]))

    check('杀棋那档单独计，且与「看不准的杀棋」相加等于库里 mate 那几手',
          all(e['mate_misses'] + e['blurred_kinds'].get('mate', 0)
              == (groups.get(e['fen_before']) or {}).get('kinds', {}).get('mate', 0)
              for e in mistakes),
          str([(e['mate_misses'], e['blurred_kinds'].get('mate', 0),
                (groups.get(e['fen_before']) or {}).get('kinds', {}).get('mate', 0))
               for e in mistakes][:2]))

    ranked = [e['misses'] for e in mistakes]
    check('排序按错过次数从多到少，limit 只切列表不切总账',
          ranked == sorted(ranked, reverse=True)
          and summary['listed'] == len(mistakes)
          and summary['positions'] >= summary['miss_positions'] >= len(mistakes),
          str(ranked[:4]) + f" listed={summary['listed']}")

    worst_ok = True
    for e in mistakes:
        row = db2.execute('SELECT review FROM plies WHERE game_id=? AND ply=?',
                          (e['worst_game_id'], e['worst_ply'])).fetchone()
        if row is None or json.loads(row[0]) != e['worst_review']:
            worst_ok = False
        elif e['worst_review'].get('loss_kind') != e['worst_loss_kind'] \
                or e['worst_review'].get('played_iccs') != e['worst_iccs']:
            worst_ok = False
    check('worst_* 指的就是库里那一行的判分本身（跨进程读，不是接口另算的一份）',
          worst_ok and bool(mistakes), str(mistakes[:1])[:150])
    check('每题都给得出正解那手的 ICCS 与中文记谱（讲题要能报出该走哪）',
          all(e['best_iccs'] and e['best_chinese'] for e in mistakes) and bool(mistakes),
          str([(e['best_iccs'], e['best_chinese']) for e in mistakes[:1]]))

    # ---- 只读这件事：读两遍、状态与库都不该动 ---- #
    check('读两遍回来的是同一份账（这一趟不改任何数据）', book == book2,
          f"{len(mistakes)} 题")
    after_counts = dict((t, db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
                        for t in ('games', 'plies', 'agg_stats'))
    check('读错题本前后，三张表的行数一根手指都没动',
          before_counts == after_counts, f'{before_counts} → {after_counts}')
    qa, qb = without_clocks(state_a), without_clocks(state_b)
    check('错题本不改会话状态：/api/state 除了几个现算的时钟，逐字段相同',
          qa == qb, '不同的键：' + str(
              [k for k in qa if qa[k] != qb.get(k)]))
    db2.close()

    # ---- 12. 逐手回放的读路径：挑一局 + 把它一手手摆回来 ---- #
    section('12. GET /api/games 与 /api/game：只读历史，不动会话')

    def _play_a_game():
        """服务里真下一局：替人录两手、引擎各应一手，回来那份实况。

        与 11 段同一套节奏：判分借的是空闲算力，所以**先等排名线排好**再录，
        否则那一手压根没判分（那是偶发红的来源，不是判据）。录完等两路搜索都
        收手，因为引擎那一手也要经 worker 里的 ``sync_game`` 进库 —— 这一局
        「有几手」这件事必须由服务端自己说完才算数。
        """
        client.post('/api/new', {'engine_side': 'black', 'auto_reply': True,
                                 'analyze': True, 'engine_type': 'builtin',
                                 'think_ms': 500, 'analyze_ms': 900,
                                 'analyze_depth': 10, 'analyze_width': 3})
        state = client.get('/api/state')[1]['state']
        for _ in range(2):
            deadline = time.time() + 30
            while time.time() < deadline:
                state = client.get('/api/state')[1]['state']
                if (state.get('analysis') or {}).get('status') == 'done':
                    break
                time.sleep(0.1)
            lines = (state.get('analysis') or {}).get('lines') or []
            move = (max(lines, key=lambda ln: -ln['score'])['iccs'] if lines
                    else state['game']['legal_moves'][0]['iccs'])
            status, _body = client.post('/api/move', {'move': move})
            if status != 200:
                break
            state = wait_quiet(client) or state
        return wait_quiet(client) or state

    _play_a_game()
    # 基准读数：这一局在服务里说完了（两路搜索都收手），才拿它当「读之前」。
    state_a = wait_quiet(client) or client.get('/api/state')[1]['state']
    records = state_a['game']['records']
    live_fen = state_a['game']['fen']
    check('这一局在服务里真的走了几个来回（实况棋谱不是空的）',
          len(records) >= 3, f'实况 {len(records)} 手')

    # 另一条连接去读**服务进程**写下的档：接口说的那一局，必须是库里最新那一局。
    db3 = _open_archive(store_path)
    newest = db3.execute('SELECT game_id, ply_count, fen_now, source FROM games '
                         'ORDER BY updated_at DESC, rowid DESC LIMIT 1').fetchone()
    check('库里最新那一局就是服务此刻这一局（updated_at 与 fen_now 都认得上）',
          newest is not None and newest[2] == live_fen
          and newest[1] == len(records), str(newest))
    current_id = newest[0] if newest else ''

    before_counts = dict((t, db3.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
                         for t in ('games', 'plies', 'agg_stats'))
    status, listing = client.get('/api/games')
    status2, listing2 = client.get('/api/games')
    games = listing.get('games') or []
    gsummary = listing.get('summary') or {}

    check('GET /api/games -> 200 且 ok',
          status == 200 and listing.get('ok') is True, f'status={status}')
    check('响应只有 games 与 summary：不夹带 state，也不回一份会话快照',
          isinstance(games, list) and isinstance(gsummary, dict)
          and set(listing) == {'ok', 'games', 'summary'}, f'键={sorted(listing)}')
    check('列表每行的字段就是约定的那 13 个（多一列少一列都算契约变了）',
          all(set(row) == GAME_HEAD_KEYS | {'graded_plies'} for row in games),
          str(sorted(games[0])) if games else '空')
    check('行里的 state 是存档那一列（字符串），不是一份会话状态快照',
          all(row['state'] is None or isinstance(row['state'], str)
              for row in games) and bool(games),
          str([(row['game_id'], type(row['state']).__name__) for row in games[:2]]))
    check('新的一局排在最前，ply_count 与服务自己报的实况一致',
          games and games[0]['game_id'] == current_id
          and games[0]['ply_count'] == len(records)
          and games[0]['fen_now'] == live_fen,
          f"接口 {games[:1] and (games[0]['game_id'], games[0]['ply_count'])} "
          f"实况 {current_id} / {len(records)}")
    stamps = [row['updated_at'] for row in games]
    check('按 updated_at 从新到旧（界面第一行就是「刚才那盘」）',
          stamps == sorted(stamps, reverse=True), str(stamps[:3]))
    check('每一行的 graded_plies 都能在库里逐行数到（一条聚合，不靠猜）',
          all(row['graded_plies'] == db3.execute(
              'SELECT COUNT(review) FROM plies WHERE game_id=?',
              (row['game_id'],)).fetchone()[0] for row in games) and bool(games),
          str([(row['game_id'], row['graded_plies']) for row in games[:3]]))
    graded_db = db3.execute('SELECT COUNT(review) FROM plies').fetchone()[0]
    check('summary 的总账就是库里的数，且这一趟存档是开着的',
          gsummary.get('total_games') == before_counts['games']
          and gsummary.get('graded_plies') == graded_db
          and gsummary.get('store_enabled') is True
          and gsummary.get('listed') == len(games), str(gsummary))
    # 缺省 limit 在这里只验「有上界、且不是 0（0 表示不封顶）」，不把那个数字
    # 抄进本本 —— 抄一遍就有两份，改常量那天这条断言会红得让人以为是契约变了。
    check('缺省 limit 有上界（响应体量有上界，界面不必自己传）',
          isinstance(gsummary.get('limit'), int)
          and 0 < gsummary['limit'] <= 200, str(gsummary.get('limit')))
    check('有判分的局数不超过总局数，且确实有局值得回看（11 段留下的那几局）',
          gsummary.get('graded_games', 0) >= 1
          and gsummary['graded_games'] <= gsummary['total_games'],
          str((gsummary.get('graded_games'), gsummary.get('total_games'))))

    # 排局/补棋不是「下过的一局」，但它是存档里的一局：列出来，并带着 source。
    # 这里用 limit=0 的不封顶读数比子集 —— 用被切过的列表比，会误红。
    uncapped = client.get('/api/games?limit=0')[1]
    setup_ids = {r[0] for r in db3.execute(
        "SELECT game_id FROM games WHERE source='setup'")}
    listed_setup = {row['game_id'] for row in (uncapped.get('games') or [])
                    if row['source'] == 'setup'}
    check('source=setup 的那些局照样在列表里，且 source 一眼可辨（不藏也不混）',
          setup_ids and setup_ids <= listed_setup
          and uncapped['summary']['setup_games'] == len(setup_ids)
          and len(uncapped['games']) == uncapped['summary']['total_games']
          and uncapped['summary']['truncated'] is False,
          f"库 {len(setup_ids)} 局 / 列表 {len(listed_setup)} 局")
    row_current = next((r for r in (uncapped.get('games') or [])
                        if r['game_id'] == current_id), None)
    check('列表里那一行与库里同一行逐字段相同（source / ply_count / fen_now 都不是编的）',
          row_current is not None and row_current['source'] == newest[3]
          and row_current['ply_count'] == newest[1]
          and row_current['fen_now'] == newest[2], str(row_current)[:150])

    capped = client.get('/api/games?limit=1')[1]
    check('limit=1 只切列表：还有 N 局没列这件事如实说，总账一根手指没少',
          len(capped.get('games') or []) == 1
          and capped['summary']['listed'] == 1
          and capped['summary']['truncated'] is True
          and capped['summary']['total_games'] == gsummary['total_games']
          and capped['summary']['graded_plies'] == gsummary['graded_plies'],
          str(capped['summary']))
    bad_limit = client.get('/api/games?limit=abc')[1]
    neg_limit = client.get('/api/games?limit=-3')[1]
    check('坏 limit 如实 400：悄悄当没传处理，等于让一个写错的参数变成一次全表读',
          client.get('/api/games?limit=abc')[0] == 400
          and bad_limit.get('ok') is False and client.get('/api/games?limit=-3')[0] == 400
          and neg_limit.get('ok') is False, str(bad_limit)[:120])

    status, replay = client.get(f'/api/game?game_id={current_id}')
    plies = replay.get('plies') or []
    check('GET /api/game -> 200、ok、found：三件事都在，且顶层没有 state',
          status == 200 and replay.get('ok') is True and replay.get('found') is True
          and set(replay) == {'ok', 'found', 'store_enabled', 'game', 'plies',
                               'summary'}, f'status={status} 键={sorted(replay)}')
    check('局头的键就是 games 那 12 列（界面读不到第二份会话状态）',
          set(replay.get('game') or {}) == GAME_HEAD_KEYS,
          str(sorted(replay.get('game') or {})))
    check('棋谱按 ply 升序连续，行数与 ply_count、与服务自己的实况都一致',
          [row['ply'] for row in plies] == list(range(1, len(records) + 1))
          and len(plies) == replay['game']['ply_count']
          == replay['summary']['plies'],
          str([row['ply'] for row in plies]))
    check('每一手的 ICCS 就是服务实况棋谱里的那一手（顺序不多不少）',
          [row['iccs'] for row in plies] == [rec['iccs'] for rec in records],
          f'接口 {[r["iccs"] for r in plies][:4]} vs 实况 '
          f'{[r["iccs"] for r in records][:4]}')
    chain = _replay_problems(replay['game'], plies)
    check('整局能在真规则上一手手摆回来：重放的每一手都合法，且局面 == fen_before',
          not chain and bool(plies), '；'.join(chain)[:220])
    check('回放行的字段就是约定的那 15 个',
          all(set(row) == PLY_KEYS for row in plies),
          str(sorted(plies[0])) if plies else '空')
    check('gives_check / mate 交回的是布尔（库里存 0/1，界面不必自己猜）',
          all(isinstance(row['gives_check'], bool) and isinstance(row['mate'], bool)
              for row in plies), str([(r['gives_check'], r['mate']) for r in plies[:3]]))

    verbatim, graded_rows = True, 0
    for row in plies:
        raw = db3.execute('SELECT review FROM plies WHERE game_id=? AND ply=?',
                          (current_id, row['ply'])).fetchone()[0]
        want = json.loads(raw) if raw is not None else None
        if want != row['review']:
            verbatim = False
        if raw is not None:
            graded_rows += 1
    check('review 整份原样搬到（另一条连接读到的 JSON 与响应里那份相同）',
          verbatim, str([(row['ply'], row['review'] is not None)
                        for row in plies][:6]))
    check('summary 里 graded_plies / unreadable 说的是这一局自己的账',
          replay['summary']['graded_plies'] == graded_rows
          and replay['summary']['unreadable'] == 0
          and replay['summary']['game_id'] == current_id, str(replay['summary']))

    graded_id = db3.execute("SELECT game_id FROM plies WHERE review IS NOT NULL "
                            'GROUP BY game_id ORDER BY MAX(rowid) DESC '
                            'LIMIT 1').fetchone()
    if graded_id:
        status_g, replay_g = client.get(f'/api/game?game_id={graded_id[0]}')
        check('11 段那些带判分的旧局也回得来：界面能就地重做那道题',
              status_g == 200 and replay_g.get('found') is True
              and replay_g['summary']['graded_plies'] >= 1
              and any(row['review'] for row in replay_g['plies']),
              str(replay_g.get('summary')))
        check('旧局同样整局摆得回来（判分是挂在能重放的棋谱上的）',
              not _replay_problems(replay_g['game'], replay_g['plies']),
              f"{graded_id[0]} {len(replay_g['plies'])} 手")

    ghost_status, ghost = client.get('/api/game?game_id=ffffffffffff')
    check('不认识的 game_id 给 404：明确「没有这一局」，绝不交回一副空棋谱',
          ghost_status == 404 and ghost.get('ok') is False
          and ghost.get('found') is False and 'plies' not in ghost
          and 'game' not in ghost, f'status={ghost_status} 键={sorted(ghost)}')
    noid_status, noid = client.get('/api/game')
    check('没传 game_id 给 400（那是请求写错了，不是「库里没有」）',
          noid_status == 400 and noid.get('ok') is False, str(noid)[:120])

    check('读两遍回来的是同一份账（这一趟不改任何数据）',
          listing == listing2 and replay == client.get(
              f'/api/game?game_id={current_id}')[1],
          f"{len(games)} 局 / {len(plies)} 手")
    after_counts = dict((t, db3.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
                        for t in ('games', 'plies', 'agg_stats'))
    check('读历史前后，三张表的行数一根手指都没动',
          before_counts == after_counts, f'{before_counts} → {after_counts}')
    # 读数取在**所有**读之后：这一段跑了十几次 GET，最后再看会话有没有被动过。
    state_b = client.get('/api/state')[1]['state']
    qa, qb = without_clocks(state_a), without_clocks(state_b)
    check('读历史不改会话状态：/api/state 除了几个现算的时钟，逐字段相同',
          qa == qb, '不同的键：' + str([k for k in qa if qa[k] != qb.get(k)]))
    db3.close()

    # ---- 13. 国手名师精训营：三段式传功、当场反击、法眼点拨与精通晋升 ---- #
    section('13. /api/training/*（名师精训营端到端：演示、试炼、陷阱反击、大考与精通）')

    st_pz, body_pz = client.get('/api/training/puzzles')
    puzzles_list = body_pz.get('puzzles') or []
    cats_list = body_pz.get('categories') or []
    check('GET /api/training/puzzles -> 200，含核心篇章且含 15 门经典功法 + 实战心魔转化题',
          st_pz == 200 and body_pz.get('ok') is True
          and len(cats_list) >= 4 and len(puzzles_list) >= 15,
          f'categories={len(cats_list)} puzzles={len(puzzles_list)}')

    st_start, body_start = client.post('/api/training/start', {
        'puzzle_id': 'kill_02_chongpao',
        'stage': 'drill',
    })
    check('POST /api/training/start 启动二步连环重炮试炼',
          st_start == 200 and body_start.get('ok') is True
          and body_start.get('stage') == 'drill'
          and len(body_start.get('demo_line') or []) == 2,
          str(body_start.get('stage')))

    # 故意走陷阱步 c2c8，验证当场反击（rebuttal）
    st_trap, body_trap = client.post('/api/training/step', {
        'puzzle_id': 'kill_02_chongpao',
        'move': 'c2c8',
    })
    check('走出次序颠倒陷阱步 c2c8 -> 触发师傅喝止与黑方当场反击（rebuttal=True）',
          st_trap == 200 and body_trap.get('outcome') == 'bad_move'
          and body_trap.get('rebuttal') is True
          and (body_trap.get('engine_move') or {}).get('iccs') == 'c9a7',
          str(body_trap.get('engine_move')))

    # 悔棋撤销反击，验证盘面回退
    st_undo, body_undo = client.post('/api/training/undo', {
        'puzzle_id': 'kill_02_chongpao',
    })
    check('POST /api/training/undo 知错退回重走 -> 解除反击态且棋谱归零',
          st_undo == 200 and body_undo.get('in_rebuttal') is False
          and len(body_undo['game']['records']) == 0,
          f"records={len(body_undo['game']['records'])}")

    # 请求一阶法眼提示，随后走完二步正解 -> 状态应为 solved_with_hints
    st_hint, body_hint = client.post('/api/training/hint', {
        'puzzle_id': 'kill_02_chongpao',
        'level': 1,
    })
    check('POST /api/training/hint 开启一阶法眼 -> 返回薄弱格视觉坐标',
          st_hint == 200 and body_hint.get('ok') is True
          and bool((body_hint.get('visual_data') or {}).get('weakness_squares')),
          str(body_hint.get('visual_data')))

    client.post('/api/training/step', {'puzzle_id': 'kill_02_chongpao', 'move': 'b2b9'})
    st_solve1, body_solve1 = client.post('/api/training/step', {
        'puzzle_id': 'kill_02_chongpao',
        'move': 'c2c9',
    })
    _, after_hint_pz = client.get('/api/training/puzzles')
    pz_state1 = next((p for p in after_hint_pz['puzzles'] if p['id'] == 'kill_02_chongpao'), {})
    check('借法眼提示通关二步重炮 -> 绝杀达成，状态记为 solved_with_hints',
          st_solve1 == 200 and body_solve1.get('solved') is True
          and pz_state1.get('status') == 'solved_with_hints',
          f"status={pz_state1.get('status')}")

    # 切入变式实战大考（exam），验证法眼已锁死，且零提示一气呵成后晋升 mastered
    st_exam, body_exam = client.post('/api/training/reset', {
        'puzzle_id': 'kill_02_chongpao',
        'stage': 'exam',
    })
    st_exam_hint, _ = client.post('/api/training/hint', {
        'puzzle_id': 'kill_02_chongpao',
        'level': 1,
    })
    check('切换至 exam 变式大考阶段 -> 法眼提示被严格锁定（返回 400）',
          st_exam == 200 and body_exam.get('stage') == 'exam' and st_exam_hint == 400,
          f'exam_hint_status={st_exam_hint}')

    client.post('/api/training/step', {'puzzle_id': 'kill_02_chongpao', 'move': 'b2b9'})
    st_solve2, body_solve2 = client.post('/api/training/step', {
        'puzzle_id': 'kill_02_chongpao',
        'move': 'c2c9',
    })
    _, after_exam_pz = client.get('/api/training/puzzles')
    pz_state2 = next((p for p in after_exam_pz['puzzles'] if p['id'] == 'kill_02_chongpao'), {})
    check('大考阶段零提示零悔棋一气呵成绝杀 -> 晋升为 mastered（已精通）',
          st_solve2 == 200 and body_solve2.get('solved') is True
          and pz_state2.get('status') == 'mastered',
          f"status={pz_state2.get('status')}")


if __name__ == '__main__':
    sys.exit(main())
