@echo off
REM ============================================
REM Docker Stack Manager - Windows build script
REM Build frontend + esbuild bundle -> deploy\linux\bundle.js
REM Usage: run in project root, or double-click
REM ============================================
setlocal enabledelayedexpansion

set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

echo.
echo ============================================
echo  Docker Stack Manager - Windows build
echo  Output: deploy\linux\bundle.js
echo ============================================
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 20+
    pause
    exit /b 1
)
echo [INFO] Node.js:
node -v
echo.

REM Install deps if needed
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

REM Build frontend
echo [INFO] Building frontend...
call npx vite build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed
    pause
    exit /b 1
)

REM Bundle server
echo.
echo [INFO] Bundling server...
node scripts\build-binary.mjs
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Bundle failed
    pause
    exit /b 1
)

REM Show output size
for %%F in ("deploy\linux\bundle.js") do set "SIZE=%%~zF"
set /a SIZE_MB=%SIZE% / 1048576

echo.
echo ============================================
echo   Build success!
echo   Output: deploy\linux\bundle.js
echo.
echo   Next steps:
echo     1. Copy deploy\linux\ to your Linux server
echo     2. On Linux:  bash build.sh
echo     3. On Linux:  sudo bash install.sh
echo ============================================
echo.

pause
endlocal
