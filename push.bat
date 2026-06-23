@echo off
git add .
git commit -m "update %date% %time%"
git push origin main
pause