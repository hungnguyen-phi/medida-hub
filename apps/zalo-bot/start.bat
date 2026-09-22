@echo off
title Zalo -> Facebook Auto-Post  [CHE DO NHAP - KHONG dang that]
cd /d "D:\Zalo bot group"
:loop
echo.
echo ================================================================
echo  [%date% %time%]  KHOI DONG SERVICE  (che do NHAP, khong dang that)
echo ================================================================
node --env-file=.env src/service.mjs
echo.
echo  [%date% %time%]  Service da dung. Tu khoi dong lai sau 5 giay...
echo  (Dong cua so nay de TAT han service)
timeout /t 5 /nobreak >nul
goto loop
