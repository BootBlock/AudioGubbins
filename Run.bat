@echo off
setlocal
cd /d "%~dp0"

REM AudioGubbins launcher. Run.ps1 holds the logic: it reuses a server this checkout already
REM runs, picks a free port, and opens the browser only once the application answers.
REM
REM   Run.bat                      start the development server (hot reload)
REM   Run.bat preview              production build, then serve the built application
REM   Run.bat -BindHost localhost  bind and open through localhost instead of 127.0.0.1
REM   Run.bat -Port 8080           pin a port instead of the default (5173 dev, 4180 preview)
REM   Run.bat -NoOpen              start the server without opening a browser
REM   Run.bat -Browser firefox     open the application in a named browser
REM
REM Stop the server with Ctrl+C in this window. The close button can leave it holding the port.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run.ps1" %*
set "EXITCODE=%ERRORLEVEL%"

REM Keep the window open after a failure, so that the message can be read.
if not "%EXITCODE%"=="0" (
  echo.
  pause
)

endlocal & exit /b %EXITCODE%
