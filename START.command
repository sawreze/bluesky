#!/bin/bash
# 맥에서 더블클릭하면 서버(server.js)로 실행해요 — 카카오 로그인·네이버 중계까지 전부 동작
cd "$(dirname "$0")"
echo ""
echo " 푸른하늘 시작 중... (이 창은 앱을 쓰는 동안 닫지 마세요)"
echo " 끄기: Ctrl + C"
echo ""
(sleep 2; open "http://localhost:5173") &
node server.js
