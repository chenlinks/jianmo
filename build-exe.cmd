@echo off
setlocal
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-exe.ps1"
set "buildExitCode=%ERRORLEVEL%"
popd
if not "%buildExitCode%"=="0" echo EXE build failed. See the error above.
pause
exit /b %buildExitCode%
