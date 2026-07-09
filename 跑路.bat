@echo off 
setlocal enabledelayedexpansion 
echo ==============================================
echo   !!! 终极删库跑路脚本 !!!
echo   将删除远程仓库和本地整个目录 
echo ==============================================
echo.
echo 请确保您确实要这样做！
echo.
set /p CONFIRM=输入 "YES DELETE" 确认继续: 
if not "%CONFIRM%"=="YES DELETE" (
    echo 操作已取消。
    pause 
    exit /b 
)
 
set /p TOKEN=GitHub Token: 
set /p OWNER=仓库所有者: 
set /p REPO=仓库名称: 
 
echo 正在删除远程仓库...
curl -X DELETE -H "Authorization: token %TOKEN%" https://api.github.com/repos/%OWNER%/%REPO% 
if errorlevel 1 (
    echo 远程仓库删除失败！脚本中止。
    pause 
    exit /b 
)
 
echo 远程仓库已删除。
echo 3秒后将删除本地目录...
timeout /t 3 /nobreak >nul 
 
cd ..
rmdir /s /q "%CD%"
echo 本地目录已清除，脚本即将自毁。
del "%~f0"