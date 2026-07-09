@echo off
git add .
git commit -m "update %date% %time%"
git commit --allow-empty -m "re-deploy pages"
git push origin main
pause