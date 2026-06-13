@echo off
cd /d "%~dp0"

py -3 -m pip install -r requirements.txt -q

py -3 run.py %*

echo.
if errorlevel 1 (
    echo === ERROR ===
) else (
    echo === DONE ===
)
pause
