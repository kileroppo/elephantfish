# -*- coding: utf-8 -*-
"""xq-coach 启动辅助工具。

配合 start.bat / start.sh 使用：
- identity <port>: 检查端口上是否正在运行本服务（输出 free / ours / other）
- free-port <port>: 顺延查找一个空闲端口
- serve <port>: 启动 server/app.py，输出重定向到日志，检测服务就绪后打开浏览器，支持 Ctrl+C 停止
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from typing import Optional


def is_port_in_use(port: int) -> bool:
    s = socket.socket()
    s.settimeout(0.3)
    code = s.connect_ex(('127.0.0.1', port))
    s.close()
    return code == 0


def server_identity(port: int) -> str:
    if not is_port_in_use(port):
        return 'free'
    try:
        url = f'http://127.0.0.1:{port}/api/health'
        with urllib.request.urlopen(url, timeout=2) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
        if isinstance(data, dict) and (
            data.get('engine') in ('elephantfish', 'pikafish')
            or 'pikafish_available' in data
        ):
            return 'ours'
    except Exception:
        pass
    return 'other'


def find_free_port(base_port: int, span: int = 12) -> Optional[int]:
    for p in range(base_port + 1, base_port + span + 1):
        if not is_port_in_use(p):
            return p
    return None


def needs_frontend_build(root_dir: str) -> bool:
    frontend_dir = os.path.join(root_dir, 'frontend')
    dist_index = os.path.join(frontend_dir, 'dist', 'index.html')
    if not os.path.isfile(dist_index):
        return True
    try:
        dist_mtime = os.path.getmtime(dist_index)
        src_dir = os.path.join(frontend_dir, 'src')
        if os.path.isdir(src_dir):
            for root, _, files in os.walk(src_dir):
                for f in files:
                    p = os.path.join(root, f)
                    if os.path.getmtime(p) > dist_mtime:
                        return True
        for conf in ('package.json', 'vite.config.ts', 'tsconfig.json', 'index.html'):
            p = os.path.join(frontend_dir, conf)
            if os.path.isfile(p) and os.path.getmtime(p) > dist_mtime:
                return True
    except OSError:
        return True
    return False


def run_server(port: int):
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log_name = f'server-{port}.log'
    log_path = os.path.join(root_dir, log_name)

    # 清空或创建日志文件
    with open(log_path, 'w', encoding='utf-8') as f:
        pass

    with open(log_path, 'a', encoding='utf-8') as log_file:
        app_script = os.path.join(root_dir, 'server', 'app.py')
        cmd = [sys.executable, '-u', app_script, str(port)]
        host = os.environ.get('EF_HOST')
        if host:
            cmd.extend(['--host', host])
        proc = subprocess.Popen(
            cmd,
            cwd=root_dir,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )

    ready = False
    actual_port = None

    for _ in range(60):
        if os.path.isfile(log_path):
            with open(log_path, 'r', encoding='utf-8', errors='replace') as rf:
                content = rf.read()
            m = re.search(r'http://127\.0\.0\.1:(\d+)/', content)
            if m:
                actual_port = int(m.group(1))
                ready = True
                break

        if proc.poll() is not None:
            print('[ERROR] 服务启动失败，日志如下：', flush=True)
            print('-' * 40, flush=True)
            if os.path.isfile(log_path):
                with open(log_path, 'r', encoding='utf-8', errors='replace') as rf:
                    print(rf.read(), end='', flush=True)
            print('-' * 40, flush=True)
            sys.exit(1)

        time.sleep(0.2)

    target_port = port
    if not ready:
        print('[WARN] 等了 12 秒服务还没起来，仍然尝试打开页面。', flush=True)
    elif actual_port and actual_port != port:
        print(f'[INFO] 端口 {port} 临时被抢，服务实际落在 {actual_port}。', flush=True)
        target_port = actual_port

    url = f'http://localhost:{target_port}/'
    print(f'      打开 {url}', flush=True)
    try:
        webbrowser.open(url)
    except Exception:
        print(f'      请手动打开 {url}', flush=True)

    print('', flush=True)
    print(f'完成。服务跑在端口 {target_port} (pid {proc.pid})。', flush=True)
    if os.environ.get('EF_HOST') in ('0.0.0.0', '::', ''):
        try:
            sys.path.insert(0, root_dir)
            from server.app import _lan_ips
            lan_ips = _lan_ips()
            for ip in lan_ips:
                print(f'局域网地址：http://{ip}:{target_port}/', flush=True)
        except Exception:
            pass
    print(f'日志：{log_name}', flush=True)
    print('在这个窗口按 Ctrl+C 就停止服务。', flush=True)
    print('', flush=True)

    try:
        proc.wait()
    except KeyboardInterrupt:
        print('\n正在停止服务...')
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
        print('服务已停止。')


def main():
    if len(sys.argv) < 2:
        print('Usage: run_server.py <identity|free-port|serve> [port]')
        sys.exit(1)

    action = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8010

    if action == 'identity':
        print(server_identity(port))
    elif action == 'free-port':
        free = find_free_port(port)
        if free is not None:
            print(free)
        else:
            sys.exit(1)
    elif action == 'check-build':
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        print('yes' if needs_frontend_build(root_dir) else 'no')
    elif action == 'serve':
        run_server(port)
    else:
        print(f'Unknown action: {action}')
        sys.exit(1)


if __name__ == '__main__':
    main()
