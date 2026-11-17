@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  水喉FM · 96968 街坊频道
echo  ---------------------------------------------
echo  正在启动本地服务器 http://127.0.0.1:8811
echo  关闭此窗口即停止。
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8811/index.html
  python -m http.server 8811 --bind 127.0.0.1
) else (
  where node >nul 2>nul
  if %errorlevel%==0 (
    start "" http://127.0.0.1:8811/index.html
    npx --yes serve -l 8811 .
  ) else (
    echo  [X] 未找到 Python 或 Node。请安装其中一个，或用任何静态服务器打开本目录。
    pause
  )
)
