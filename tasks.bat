@echo off
REM Wrapper around tasks.ps1 that bypasses Windows ExecutionPolicy restrictions.
REM Use this on stock Windows where Set-ExecutionPolicy hasn't been run.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tasks.ps1" %*
