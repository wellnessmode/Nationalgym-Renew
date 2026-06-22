# 지점별 접근 제어는 RLS(서버)로 — 클라이언트 게이트는 보안 아님

## 핵심 (2026-06-22 도입)

직원이 자기 지점 계약만 보게 하는 경계는 **반드시 Supabase RLS(서버측)**. 화면 PIN/숨김 같은 클라이언트 게이트는 `list.html` 전체 백업(`fetchAll(table).select('*')`)·개발자도구로 우회되므로 PII 시스템에선 보안이 아니라 심리적 장벽일 뿐.

## 구조

- **권한 원천**: JWT `app_metadata` (service_role·SQL 로만 수정, 직원 변조 불가. `user_metadata` 는 직원이 바꿀 수 있으니 절대 쓰지 말 것)
  - 대표/본사: `{"role":"admin"}` → 전 지점
  - 지점 직원: `{"branches":["서초 2호점"]}` (배열, 지점키 = config.js BRANCHES)
- **헬퍼**: `public.can_access_branch(p_branch text)` — `auth.jwt() -> 'app_metadata'` 에서 role/branches 읽어 판정. SECURITY INVOKER(호출 직원 토큰으로 평가), STABLE
- **정책** (`auth all *` → 지점 스코프로 교체):
  - `contracts`: `using/with check (can_access_branch(branch))` — 조회+발송 모두. with check 가 타 지점 발송도 차단
  - `contract_signatures`·`contract_audit_log`: 자체 branch 컬럼 없음 → `exists(select 1 from contracts c where c.id = contract_id and can_access_branch(c.branch))`
  - `contract_templates`: PII 아님 + 공통(branch IS NULL) fallback 필요 → `auth all` 유지(전원 열람)
- **KPI 뷰** `contracts_stats_monthly`: 반드시 `with (security_invoker = on)`. 안 그러면 뷰 소유자(postgres) 권한으로 RLS 우회 → 타 지점 건수·서명액 유출
- **회원 플로우 무영향**: 모든 RPC(get_contract_intro/verify_identity/submit_consent 등)가 `security definer` 라 anon 이 RLS 우회해 정상 동작. RLS 는 직원 직접 테이블 접근(list/admin)에만 작용

## 빠지기 쉬운 함정

1. **뷰 security_invoker 누락** = 통계 유출. RLS 정책만 고치고 뷰를 잊으면 KPI 로 전 지점이 새어나감
2. **구 지점키 계약** — 지점명 바뀌면(예 용산점→용산 1호점) 구키 계약이 새 키 직원에게 안 보임. `branch` 는 immutable 트리거 대상이 **아니라서** UPDATE 로 흡수 가능 (스키마 하단 마이그레이션). admin 은 어차피 다 보임
3. **app_metadata 변경 후 재로그인 필요** — JWT 는 로그인 시 발급. 기존 세션엔 즉시 반영 안 됨
4. **UI 드롭다운은 거울일 뿐** — list.js/admin.js 가 `allowedBranches()` 로 내 지점만 표시하지만, 실제 차단은 RLS. UI 만 바꾸고 RLS 안 걸면 무의미
5. **권한 미부여 직원 = 0건** (안전 잠금). 새 직원 계정 만들면 반드시 app_metadata 부여해야 화면이 보임

## 로컬 검증 (verify-locally-yourself.md 절차에 추가)

목 환경에 `auth.jwt()` 도 정의해야 함 (auth.uid() 만으론 부족):
```sql
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
grant select,insert,update,delete on all tables in schema public to authenticated;  -- RLS 는 base 권한 위에서 작동
```
역할별 테스트는 트랜잭션에서 `set local request.jwt.claims = '...'; set local role authenticated;` 후 조회 → rollback. postgres(superuser)는 RLS 우회하므로 반드시 `set role` 로 전환해 검증.

2026-06-22 전체 매트릭스 통과: 서초→서초만 / 용산→용산만(구키 흡수 포함) / admin→전체 / 미부여→0건 / 서초의 용산 발송 with check 차단 / anon RPC 정상 / 뷰 스코프 / 스키마 재실행 idempotent.
