#!/usr/bin/env bash
# 실험실 서버 점검: health → 가입 → 로그인 → 동기화(올리기/받기/최신 우선/삭제) → 권한 거부.
# 사용: server/scripts/smoke.sh http://100.96.247.43:8444   (운영 주소에는 쓰지 말 것)
set -euo pipefail
BASE=${1:?서버 주소}
case "$BASE" in *:8443*) echo "운영 서버에는 실행하지 않습니다"; exit 1;; esac
# 실험실은 99로 시작하는 가짜 학번만 자동 승인한다(AUTO_APPROVE_PREFIX).
U="99$(printf %08d $(( (RANDOM * 32768 + RANDOM) % 100000000 )))"; PW="smoke-pass-$RANDOM$RANDOM"
j() { curl -sS -m 10 -H 'content-type: application/json' "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: $2"; exit 1; }

r=$(j "$BASE/health"); echo "$r" | grep -q '"ok":true' && pass health || fail health "$r"

r=$(j -X POST "$BASE/auth/signup" -d "{\"username\":\"abc_x\",\"password\":\"$PW\",\"displayName\":\"테스트\"}")
echo "$r" | grep -q bad_username && pass "학번이 아닌 아이디 거부" || fail "학번 검사" "$r"
r=$(j -X POST "$BASE/auth/signup" -d "{\"username\":\"$U\",\"password\":\"$PW\"}")
echo "$r" | grep -q bad_name && pass "이름 없는 가입 거부" || fail "이름 검사" "$r"

r=$(j -X POST "$BASE/auth/signup" -d "{\"username\":\"$U\",\"password\":\"$PW\",\"displayName\":\"스모크\"}")
status=$(echo "$r" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p'); echo "  signup status=$status"

r=$(j -X POST "$BASE/auth/login" -d "{\"username\":\"$U\",\"password\":\"$PW\",\"deviceName\":\"smoke\"}")
if [ "$status" != approved ]; then
  echo "$r" | grep -q not_approved && pass "승인 전 로그인 거부" || fail "승인 전 거부" "$r"
  echo "  (승인 대기 상태 — 동기화 검사는 운영진 승인 후 가능)"; exit 0
fi
T=$(echo "$r" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'); [ -n "$T" ] && pass login || fail login "$r"
A=(-H "authorization: Bearer $T")

r=$(j "${A[@]}" -X POST "$BASE/sync" -d '{"since":0,"changes":[{"kind":"todo","id":"t1","data":{"text":"first"},"updatedAt":1000},{"kind":"course","id":"c1","data":{"name":"자료구조"},"updatedAt":1000}]}')
echo "$r" | grep -q '"applied":2' && pass "올리기 2건" || fail "올리기" "$r"
r=$(j "${A[@]}" -X POST "$BASE/sync" -d '{"since":0,"changes":[{"kind":"todo","id":"t1","data":{"text":"old"},"updatedAt":500}]}')
echo "$r" | grep -q '"applied":0' && echo "$r" | grep -q '"first"' && pass "오래된 수정은 무시(최신 우선)" || fail "최신 우선" "$r"
r=$(j "${A[@]}" -X POST "$BASE/sync" -d '{"since":0,"changes":[{"kind":"todo","id":"t1","updatedAt":2000,"deleted":true}]}')
echo "$r" | grep -q '"deleted":true' && pass "삭제 전파" || fail "삭제" "$r"
r=$(j "${A[@]}" -X POST "$BASE/sync" -d '{"since":0,"changes":[{"kind":"hack","id":"x","updatedAt":1}]}')
echo "$r" | grep -q bad_change && pass "알 수 없는 종류 거부" || fail "종류 검사" "$r"
r=$(j -H "authorization: Bearer wrong" "$BASE/sync"); echo "$r" | grep -q unauthorized && pass "잘못된 토큰 거부" || fail "토큰" "$r"
r=$(j "${A[@]}" -X POST "$BASE/auth/logout" -d '{}'); r=$(j "${A[@]}" "$BASE/me"); echo "$r" | grep -q unauthorized && pass "로그아웃 후 토큰 폐기" || fail "로그아웃" "$r"
h=$(curl -sS -m 10 -D - -o /dev/null "$BASE/health"); echo "$h" | grep -qi '^x-content-type-options: nosniff' && echo "$h" | grep -qi '^x-frame-options: DENY' && pass "보안 헤더" || fail "보안 헤더" "$h"
# 연속 실패 잠금: 별도 시험 계정으로 비밀번호 5번 틀리면 맞는 비밀번호도 잠시 거부
L="99$(printf %08d $(( (RANDOM * 32768 + RANDOM) % 100000000 )))"
j -X POST "$BASE/auth/signup" -d "{\"username\":\"$L\",\"password\":\"$PW\",\"displayName\":\"잠금시험\"}" >/dev/null
for _ in 1 2 3 4 5; do j -X POST "$BASE/auth/login" -d "{\"username\":\"$L\",\"password\":\"wrong-password\"}" >/dev/null; done
r=$(j -X POST "$BASE/auth/login" -d "{\"username\":\"$L\",\"password\":\"$PW\"}")
echo "$r" | grep -q '"locked"' && pass "비밀번호 5번 실패 → 일시 잠금" || fail "잠금" "$r"
echo "ALL PASS ($U, $L)"
