@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
rem ==================================================
rem  xq-coach - Xiangqi Coach Platform (Windows)
rem  Usage: start.bat [port] [local]
rem ==================================================

cd /d "%~dp0"

set "PORT=8010"
set "LAN=yes"
for %%A in ("%~1" "%~2") do (
    if not "%%~A"=="" (
        if /i "%%~A"=="local" (
            set "LAN=no"
        ) else if /i "%%~A"=="localhost" (
            set "LAN=no"
        ) else if /i "%%~A"=="lan" (
            set "LAN=yes"
        ) else (
            set "PORT=%%~A"
        )
    )
)
if /i "!LAN!"=="no" (
    set "EF_HOST=127.0.0.1"
) else (
    if not defined EF_HOST set "EF_HOST=0.0.0.0"
)
set "URL=http://localhost:!PORT!/"

echo ==================================================
echo   XQ-Coach - 象棋教练实训台
echo ==================================================
if /i "!LAN!"=="no" (
    echo   [本地模式] 绑定 127.0.0.1，仅本机可访问
) else (
    echo   [局域网模式] 默认绑定 0.0.0.0，启动后看下面打印的局域网地址
)
echo.

rem ---------- Find Python ----------
set "PY="
for %%c in (python py python3 pypy) do (
    if not defined PY (
        where %%c >nul 2>nul
        if not errorlevel 1 set "PY=%%c"
    )
)
if not defined PY (
    echo [ERROR] 没找到 Python，请先安装 Python 3 再运行本脚本。
    echo.
    pause
    exit /b 1
)

rem ---------- Check Port ----------
for /f "delims=" %%I in ('"%PY%" tools\run_server.py identity !PORT! 2^>nul') do set "IDENT=%%I"

if "!IDENT!"=="ours" (
    echo [INFO] xq-coach 已经在端口 !PORT! 上跑着，直接打开页面。
    echo.
    start "" "!URL!"
    exit /b 0
)

if "!IDENT!"=="other" (
    echo [WARN] 端口 !PORT! 被别的程序占着（不是 xq-coach），换一个端口。
    set "FREE_PORT="
    for /f "delims=" %%P in ('"%PY%" tools\run_server.py free-port !PORT! 2^>nul') do set "FREE_PORT=%%P"
    if defined FREE_PORT (
        set "PORT=!FREE_PORT!"
        set "URL=http://localhost:!PORT!/"
        echo        改用端口 !PORT!。
    ) else (
        echo [ERROR] !PORT! 往后 12 个端口都不空闲，请手动指定，例如 start.bat 8030
        echo.
        pause
        exit /b 1
    )
    echo.
)

rem ---------- Frontend Build Check ----------
set "NEED_BUILD=no"
if not exist "frontend\dist\index.html" (
    set "NEED_BUILD=yes"
) else (
    for /f "delims=" %%B in ('"%PY%" tools\run_server.py check-build 2^>nul') do set "NEED_BUILD=%%B"
)

if "!NEED_BUILD!"=="yes" (
    echo [1/3] 检测到前端源码更新或首次运行，正在构建前端界面 ...
    where npm >nul 2>nul
    if errorlevel 1 (
        echo [WARN] 没找到 npm，跳过构建。页面会提示如何手动构建。
        echo.
    ) else (
        pushd frontend
        if not exist "node_modules" (
            echo       安装依赖，第一次会慢一些 ...
            call npm install
            if errorlevel 1 (
                echo [WARN] npm install 失败，跳过构建。
                popd
                goto :serve
            )
        )
        call npm run build
        if errorlevel 1 echo [WARN] 前端构建失败，页面会退回旧版界面。
        popd
    )
) else (
    echo [1/3] 前端已是最新构建，跳过。
)

:serve
echo [2/3] 启动服务，端口 !PORT! ...
echo [3/3] 等服务起来 ...
"%PY%" -u tools\run_server.py serve !PORT!
if errorlevel 1 (
    pause
    exit /b 1
)
