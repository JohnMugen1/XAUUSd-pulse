@echo off
title Save Twelve Data key
cd /d "%~dp0"
echo.
echo Paste your Twelve Data API key below, then press Enter.
set /p KEY=Key: 
if "%KEY%"=="" goto empty
> .env echo PORT=3000
>> .env echo HOST=127.0.0.1
>> .env echo PRICE_SOURCE=binance
>> .env echo TWELVEDATA_API_KEY=%KEY%
echo.
echo Saved to .env in this folder:
cd
echo.
echo Now close the black platform window if it is open, then double-click START.bat
pause
exit /b 0
:empty
echo No key entered. Nothing was changed.
pause
exit /b 1
