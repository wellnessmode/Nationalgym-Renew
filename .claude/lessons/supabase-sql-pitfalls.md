# Supabase SQL 함정: pgcrypto는 extensions 스키마 — digest()는 반드시 extensions.digest()로

## 배경 (2026-06, 운영 장애)

`submit_consent`에서 `digest(...)`를 비한정 호출 → 운영에서 **"function digest(text, unknown) does not exist"** 로 회원 제출 실패. Supabase는 pgcrypto를 `extensions` 스키마에 설치하기 때문.

## 규칙

- pgcrypto 함수는 **`extensions.digest(..., 'sha256'::text)`** 처럼 스키마 한정 + 타입 캐스팅.
- 해당 RPC는 `set search_path = public, extensions`.
- 새 RPC 추가 시 `grant execute on function ... to anon, authenticated` 누락 주의 (RLS로 테이블 직접 접근이 막혀 있어 grant 없으면 회원 플로우 전체가 죽음).
- 시드는 `on conflict do update` (do nothing이면 본문 수정이 재실행에 반영 안 됨 — 한 번 교정된 사항).
- check constraint 변경은 `do $$ ... drop constraint if exists ... add constraint ... exception when others then null; end$$` 패턴 (idempotent).

## 운영 반영 주의

DB 쪽 수정은 git push만으로 반영되지 않음 — **대표가 Supabase SQL Editor에서 supabase_schema.sql을 재실행해야 적용**됨. DB 변경 커밋 시 사용자에게 "재실행 필요"를 명시적으로 안내할 것 (재실행은 안전함: idempotent + 기존 계약·서명 보존 검증 완료).
