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
rem 端口被占用不等于「服务已经在跑」。8010 这类端口上常驻着别的项目的服务，
rem 只看占用就把浏览器开过去，页面只会剩一句 {"detail":"Not Found"}。
rem 所以拿本服务独有的 /api/health 认个脸，再决定是复用还是换端口。
set "INUSE="
set "OURS="
netstat -ano | findstr ":!PORT! " | findstr "LISTENING" >nul
if not errorlevel 1 set "INUSE=1"

if defined INUSE (
    where curl >nul 2>nul
    if errorlevel 1 (
        rem 老系统没有 curl，没法确认身份，退回旧行为
        echo [INFO] 端口 !PORT! 已被占用，认为服务已经在跑，只打开页面。
        echo.
        start "" "!URL!"
        pause
        exit /b 0
    )
    set "HEALTH="
    for /f "delims=" %%R in ('curl -s --max-time 2 http://127.0.0.1:!PORT!/api/health 2^>nul') do set "HEALTH=%%R"
    echo !HEALTH! | findstr /c:"elephantfish" >nul
    if not errorlevel 1 set "OURS=1"
)

if defined OURS (
    echo [INFO] elephantfish 已经在端口 !PORT! 上跑着，直接打开页面。
    echo.
    start "" "!URL!"
    pause
    exit /b 0
)

if defined INUSE (
    echo [WARN] 端口 !PORT! 被别的程序占着（不是 elephantfish），换一个端口。
    set "FREE="
    for /l %%P in (!PORT!,1,8050) do (
        if not defined FREE (
            netstat -ano | findstr ":%%P " | findstr "LISTENING" >nul
            if errorlevel 1 set "FREE=%%P"
        )
    )
    if not defined FREE (
        echo [ERROR] 找不到空闲端口，请手动指定，例如 start.bat 8060
        pause
        exit /b 1
    )
    set "PORT=!FREE!"
    set "URL=http://localhost:!PORT!/"
    echo        改用端口 !PORT!。
    echo.
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
