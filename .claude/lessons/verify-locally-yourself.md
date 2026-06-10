# 검증은 직원/사용자에게 미루지 말고 로컬 PostgreSQL로 직접 시뮬레이션

## 배경 (2026-06)

"직원한테 실패 시뮬레이션 돌리라고 하지말고 너가 직접 시뮬레이션 돌려보고 검증하고 수정하고 재배포하면 되잖아" — 사용자 교정. 이후 로컬 PG로 16단계 전체 플로우 검증해 digest 수정이 실제 작동함을 확인했음.

## 제약

- 운영 Supabase(fcawftihhpccsqvawbxi)는 이 환경에서 **직접 호출 불가** (네트워크 allowlist → 403 "Host not in allowlist").

## 재현 절차 (검증된 방법)

```bash
# 1. root로는 initdb 불가 → 비특권 유저
useradd -m pguser
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
mkdir -p /tmp/pgtest /tmp/pgsock && chown -R pguser:pguser /tmp/pgtest /tmp/pgsock
su pguser -c "$PGBIN/initdb -D /tmp/pgtest -U postgres --auth=trust"
su pguser -c "$PGBIN/pg_ctl -D /tmp/pgtest -o '-k /tmp/pgsock -h \"\"' -l /tmp/pg.log start"

# 2. Supabase 환경 모사 (스키마 실행 전 필수)
psql -h /tmp/pgsock -U postgres <<'SQL'
create schema extensions; create extension pgcrypto with schema extensions;
create extension pgcrypto with schema public;  -- gen_random_uuid 용
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create role anon nologin; create role authenticated nologin;
SQL

# 3. 실제 스키마 그대로 실행
psql -h /tmp/pgsock -U postgres -v ON_ERROR_STOP=1 -f supabase_schema.sql
```

## 검증 시나리오 (전부 통과 이력 있음, 2026-06-03)

계약 INSERT → get_contract_intro → verify_identity(정/오답) → get_contract_for_signing → log_contract_event → submit_consent(해시 생성) → 중복 제출 차단 → signed 변조 UPDATE 차단(트리거) → audit_log DELETE 차단 → 필수동의 누락 차단 → 본인확인 5회 실패 → 6회차 too_many_attempts → 만료 토큰 expired → 기서명 already_signed → 스냅샷 박제 확인 → **스키마 재실행 후 데이터 보존(idempotency)**.

스키마나 RPC를 수정하면 이 절차로 재검증 후 배포할 것.
