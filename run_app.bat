@echo off
title Karya Transcription Studio
echo ========================================================
echo    Starting Karya Conversational Transcription Studio
echo ========================================================

:: Check for backend virtual environment
if not exist "backend\venv\Scripts\python.exe" (
    echo [1/3] Creating backend Python virtual environment...
    python -m venv backend\venv
    echo [2/3] Installing backend dependencies...
    backend\venv\Scripts\pip install -r backend\requirements.txt
)

:: Check for frontend node_modules
if not exist "frontend\node_modules" (
    echo [3/3] Installing frontend npm packages...
    cd frontend
    call npm install
    cd ..
)

echo.
echo Starting FastAPI Backend Server on http://localhost:8000 ...
start "Karya Backend" cmd /k "cd /d %~dp0\backend && venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

echo Starting Vite React Frontend on http://localhost:5173 ...
start "Karya Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ========================================================
echo   Karya Studio is running!
echo   Frontend: http://localhost:5173
echo   Backend API: http://localhost:8000/docs
echo ========================================================
timeout /t 3 >nul
start http://localhost:5173
