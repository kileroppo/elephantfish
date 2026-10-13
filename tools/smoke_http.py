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
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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


# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(description='elephantfish HTTP 契约自检')
    ap.add_argument('--port', type=int, default=None)
    args = ap.parse_args()

    port = args.port or free_port()
    base = f'http://127.0.0.1:{port}'
    log_path = os.path.join(ROOT, f'smoke-{port}.log')

    print('elephantfish HTTP 契约自检')
    print(f'  服务 {base}   日志 {log_path}')

    with open(log_path, 'wb') as log:
        proc = subprocess.Popen([sys.executable, os.path.join('server', 'app.py'), str(port)],
                                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
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

            run(client)
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


def run(client):
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
        'engine_side': 'red', 'think_ms': 4000})
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

    wait_idle(client)


if __name__ == '__main__':
    sys.exit(main())
