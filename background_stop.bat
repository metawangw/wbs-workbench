@echo off
chcp 65001 >nul
title WBS Workbench - Background Stop
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
    echo Re-extract the package, or install Node.js 20 or later.
    echo.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

echo.
echo  WBS Workbench - Background Stop
echo.

rem Close the notification-area icon first (it is a PowerShell process whose PID
rem is stored in .wbs-tray.pid), so no stale icon is left behind.
if not exist "%~dp0.wbs-tray.pid" goto :tray_closed
set "TRAY_PID="
set /p TRAY_PID=<"%~dp0.wbs-tray.pid"
if not defined TRAY_PID goto :tray_closed
taskkill /PID %TRAY_PID% /F >nul 2>nul
del /q "%~dp0.wbs-tray.pid" >nul 2>nul
:tray_closed

"%NODE_EXE%" "%~dp0scripts\launch.mjs" --stop
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
