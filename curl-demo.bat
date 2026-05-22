@echo off
REM Toxy FM - RAG API 演示脚本 (Windows 版本)
REM 在 PowerShell 中运行此脚本

setlocal enabledelayedexpansion

set API_BASE=http://localhost:3001

echo.
echo ==========================================
echo 🎵 Toxy FM - RAG API 演示
echo ==========================================
echo.

REM 1️⃣ 检查向量库状态
echo 1️⃣ 检查向量库状态...
echo 命令: curl %API_BASE%/api/index-music
echo.
curl -s "%API_BASE%/api/index-music" | jq .
echo.
echo.

REM 2️⃣ RAG 推荐 - 忧郁的夜晚开车
echo 2️⃣ RAG 推荐演示：忧郁的夜晚开车
echo.
curl -s -X POST "%API_BASE%/api/recommend-rag" ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"忧郁的夜晚开车\",\"limit\":3,\"context\":\"next\"}" | jq .
echo.
echo.

REM 3️⃣ RAG 推荐 - 高能量运动
echo 3️⃣ RAG 推荐演示：高能量运动音乐
echo.
curl -s -X POST "%API_BASE%/api/recommend-rag" ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"我要跑步，需要有节奏感的\",\"limit\":3}" | jq .
echo.
echo.

echo ==========================================
echo ✅ 演示完成！
echo ==========================================
