#!/bin/bash
git add .
git commit -m "快速更新: $(date '+%Y-%m-%d %H:%M:%S')" || echo "没有新内容"
git push origin main