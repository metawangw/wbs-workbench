@echo off
chcp 65001 >nul
rem Hand off to a hidden VBScript launcher, then close THIS window immediately.
rem start /b detaches so the double-clicked console never lingers on screen.
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
)

start "" /b wscript.exe "%~dp0scripts\start-hidden.vbs" %*

rem Show a notification-area icon so the service can be stopped with a click
rem (same effect as background_stop.bat). Set WBS_NO_TRAY=1 to skip it.
if not defined WBS_NO_TRAY start "" /b wscript.exe "%~dp0scripts\tray.vbs"

exit /b 0
