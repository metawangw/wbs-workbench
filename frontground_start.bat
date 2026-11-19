@echo off
chcp 65001 >nul
title WBS Workbench - Foreground
cd /d "%~dp0"

rem Select the bundled runtime matching the OS architecture: x64 or x86.
set "NODE_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "NODE_ARCH=x86"
if defined WBS_NODE_ARCH set "NODE_ARCH=%WBS_NODE_ARCH%"
set "NODE_DIR=%~dp0runtime\%NODE_ARCH%"
set "NODE_EXE=%NODE_DIR%\node.exe"

if exist "%NODE_EXE%" (
  set "PATH=%NODE_DIR%;%PATH%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found.
    echo The bundled runtime is missing: runtime\%NODE_ARCH%\node.exe
    echo Re-extract the package, or install Node.js 20 or later: https://nodejs.org/
    echo.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

echo.
echo  WBS Workbench - Foreground (close this window to stop)
echo.

"%NODE_EXE%" "%~dp0scripts\launch.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to start. See the log above.
)

echo.
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%
