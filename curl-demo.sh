#!/bin/bash

# Toxy FM - RAG API 演示脚本
# 直接运行此脚本查看 RAG 推荐效果

API_BASE="http://localhost:3001"

echo "=========================================="
echo "🎵 Toxy FM - RAG API 演示"
echo "=========================================="
echo ""

# 1️⃣ 检查向量库状态
echo "1️⃣  检查向量库状态..."
echo "命令: curl $API_BASE/api/index-music"
echo ""
curl -s "$API_BASE/api/index-music" | jq .
echo ""
echo ""

# 2️⃣ RAG 推荐 - 演示 1：忧郁的夜晚
echo "2️⃣  RAG 推荐演示 1：忧郁的夜晚开车"
echo "命令: curl -X POST $API_BASE/api/recommend-rag -H 'Content-Type: application/json' -d '{\"query\":\"忧郁的夜晚开车\",\"limit\":3}'"
echo ""
curl -s -X POST "$API_BASE/api/recommend-rag" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "忧郁的夜晚开车",
    "limit": 3,
    "context": "next"
  }' | jq .
echo ""
echo ""

# 3️⃣ RAG 推荐 - 演示 2：高能量运动
echo "3️⃣  RAG 推荐演示 2：高能量运动音乐"
echo "命令: curl -X POST $API_BASE/api/recommend-rag -H 'Content-Type: application/json' -d '{\"query\":\"我要跑步，需要有节奏感的\",\"limit\":3}'"
echo ""
curl -s -X POST "$API_BASE/api/recommend-rag" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "我要跑步，需要有节奏感的",
    "limit": 3,
    "context": "workout"
  }' | jq .
echo ""
echo ""

# 4️⃣ RAG 推荐 - 演示 3：放松的下午
echo "4️⃣  RAG 推荐演示 3：放松的下午茶时间"
echo "命令: curl -X POST $API_BASE/api/recommend-rag -H 'Content-Type: application/json' -d '{\"query\":\"下午茶，舒缓一点\",\"limit\":5}'"
echo ""
curl -s -X POST "$API_BASE/api/recommend-rag" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "下午茶，舒缓一点",
    "limit": 5,
    "context": "afternoon"
  }' | jq .
echo ""
echo ""

# 5️⃣ 聊天 API - 对比
echo "5️⃣  对比：常规聊天 API（同时调用规则引擎 + RAG）"
echo "命令: curl -X POST $API_BASE/api/chat -H 'Content-Type: application/json' -d '{\"message\":\"我想听悲伤的歌\"}'"
echo ""
curl -s -X POST "$API_BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我想听悲伤的歌"
  }' | jq .
echo ""
echo ""

echo "=========================================="
echo "✅ 演示完成！"
echo "=========================================="
echo ""
echo "💡 说明："
echo "- 向量库状态: 显示已索引的歌曲数"
echo "- RAG 推荐: 返回 selectedTracks + candidateTracks + explanations"
echo "- 每个推荐都有理由说明为什么选这首歌"
echo ""
