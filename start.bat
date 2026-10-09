@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT=8010"
if not "%~1"=="" set "PORT=%~1"
set "URL=http://localhost:!PORT!/"

echo ==================================================
echo   elephantfish - 转述对局台
echo ==================================================
echo.

set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] 没找到 Python，请先安装 Python 3 再运行本脚本。
        echo.
        pause
        exit /b 1
    )
    set "PY=py"
)

rem 前端要先构建一次，否则只能看到一句「请先构建」的临时页
if not exist "frontend\dist\index.html" (
    echo [1/3] 首次运行，正在构建前端界面 ...
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
    echo [1/3] 前端已构建，跳过。
)

:serve
netstat -ano | findstr ":!PORT! " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [INFO] 端口 !PORT! 已被占用，认为服务已经在跑，只打开页面。
    echo.
    start "" "!URL!"
    pause
    exit /b 0
)

echo [2/3] 启动服务，端口 !PORT! ...
start "elephantfish-relay :!PORT!" /min cmd /k !PY! -u server\app.py !PORT!

echo [3/3] 等服务起来 ...
timeout /t 3 /nobreak >nul

echo       打开 !URL!
start "" "!URL!"

echo.
echo 完成。服务跑在最小化的 "elephantfish-relay" 窗口里。
echo 关掉那个窗口就停止服务。
echo.
pause
