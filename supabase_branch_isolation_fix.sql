-- =====================================================================
-- 내셔널짐 전자계약서 — 지점 격리 긴급 수정 (2026-06-27)
--
-- 증상: 지점 직원이 로그인하면 list.html 에 "다른 지점 계약까지 전부" 보임.
-- 원인(진단 SQL 로 확정): 운영 DB 에 지점 RLS 가 실효되지 않고 있음
--   (RLS 미활성 / 구 허용정책 잔존 / branch 직원에 role:admin 오부여 / 공유계정 중 하나).
-- 추가: 감사에서 RLS 로도 안 막히는 구멍 3건 발견 → 함께 봉인.
--
-- 실행: Supabase 대시보드 → SQL Editor → [1] 진단 먼저 실행해 원인 확인,
--       그 다음 [2] 수정 전체 실행. 모두 idempotent(재실행 안전).
--       ⚠ 실행 후 모든 직원 "재로그인" 필수 (JWT 는 로그인 시점에 발급됨).
-- =====================================================================


-- =====================================================================
-- [1] 진단 — 실제 운영 상태 확인 (각 쿼리의 기대 정상값을 주석에 표기)
-- =====================================================================

-- 1-1) RLS 실제 활성 여부 — 네 테이블 모두 rls_enabled = true 여야 정상
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contracts','contract_signatures',
                    'contract_audit_log','contract_templates')
order by c.relname;

-- 1-2) 적용된 정책 — contracts 에 'branch scoped contracts'(qual=can_access_branch) 하나만.
--      'auth all contracts' 또는 qual 이 true/null 인 정책이 보이면 그게 유출 원인.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('contracts','contract_signatures',
                    'contract_audit_log','contract_templates')
order by tablename, policyname;

-- 1-3) 직원 계정별 권한 — ceo@ 만 {"role":"admin"}, 나머지는 {"branches":[...]} 만.
--      branch 직원에 role:admin 이 섞여있거나, 같은 이메일로 여러 명 로그인(공유계정)이면 전 지점 노출.
select email, raw_app_meta_data, last_sign_in_at
from auth.users order by created_at;

-- 1-4) KPI 뷰 security_invoker — reloptions 에 security_invoker=on/true 있어야 정상.
select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'contracts_stats_monthly';

-- 1-5) contracts.branch 값 분포 — 구 지점키(용산점/서초점/골프스튜디오)가 남아있으면
--      신 키를 든 직원이 자기 계약을 못 보는 반대 증상 발생. 마이그레이션 필요 여부 확인.
select branch, count(*) from public.contracts group by branch order by branch;


-- =====================================================================
-- [2] 수정 — 지점 격리 전면 재적용 + definer RPC 구멍 봉인 (전부 idempotent)
--     ⚠ force row level security 는 쓰지 않음: 켜면 회원 서명 RPC(소유자 실행)가
--        자기 테이블 RLS 에 걸려 서명 플로우가 깨짐.
-- =====================================================================

-- ---- 2-1. 헬퍼 함수 (재정의) ----------------------------------------
create or replace function public.can_access_branch(p_branch text)
returns boolean language sql stable as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') = 'admin'
    or (
      p_branch is not null
      and p_branch = any (
        select jsonb_array_elements_text(
          coalesce(auth.jwt() -> 'app_metadata' -> 'branches','[]'::jsonb))
      )
    );
$$;
grant execute on function public.can_access_branch(text) to authenticated;

-- ---- 2-2. RLS 활성 (미활성이 원인이면 이 줄이 핵심 수정) --------------
alter table public.contract_templates  enable row level security;
alter table public.contracts           enable row level security;
alter table public.contract_signatures enable row level security;
alter table public.contract_audit_log  enable row level security;

-- ---- 2-3. 낡은/허용 정책 전부 제거 ----------------------------------
drop policy if exists "auth all contracts"       on public.contracts;
drop policy if exists "auth all templates"        on public.contract_templates;
drop policy if exists "auth all signatures"       on public.contract_signatures;
drop policy if exists "auth all audit"            on public.contract_audit_log;
drop policy if exists "branch scoped contracts"   on public.contracts;
drop policy if exists "branch scoped signatures"  on public.contract_signatures;
drop policy if exists "branch scoped audit"       on public.contract_audit_log;
drop policy if exists "templates read all"        on public.contract_templates;
drop policy if exists "templates admin write"     on public.contract_templates;

-- ---- 2-4. 지점 격리 정책 (계약 / 서명 / 감사) -----------------------
create policy "branch scoped contracts" on public.contracts
  for all to authenticated
  using (public.can_access_branch(branch))
  with check (public.can_access_branch(branch));

create policy "branch scoped signatures" on public.contract_signatures
  for all to authenticated
  using (exists (select 1 from public.contracts c
                  where c.id = contract_signatures.contract_id
                    and public.can_access_branch(c.branch)))
  with check (exists (select 1 from public.contracts c
                  where c.id = contract_signatures.contract_id
                    and public.can_access_branch(c.branch)));

create policy "branch scoped audit" on public.contract_audit_log
  for all to authenticated
  using (exists (select 1 from public.contracts c
                  where c.id = contract_audit_log.contract_id
                    and public.can_access_branch(c.branch)))
  with check (exists (select 1 from public.contracts c
                  where c.id = contract_audit_log.contract_id
                    and public.can_access_branch(c.branch)));

-- ---- 2-5. 약관 템플릿: 열람 전직원 / 쓰기 admin 만 (위·변조 봉인) -----
create policy "templates read all" on public.contract_templates
  for select to authenticated using (true);
create policy "templates admin write" on public.contract_templates
  for all to authenticated
  using      (coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') = 'admin')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') = 'admin');

-- ---- 2-6. KPI 뷰: security_invoker 재보장 --------------------------
create or replace view public.contracts_stats_monthly
  with (security_invoker = on) as
select date_trunc('month', created_at)::date as month, branch,
       count(*)                                         as total,
       count(*) filter (where status='signed')         as signed,
       count(*) filter (where status='viewed')         as viewed,
       count(*) filter (where status='sent')           as sent,
       count(*) filter (where status='expired')        as expired,
       sum(total_amount) filter (where status='signed') as signed_amount
from public.contracts group by 1,2 order by 1 desc, 2;
grant select on public.contracts_stats_monthly to authenticated;

-- ---- 2-7. get_signed_contract: 인증 직원 지점 검사 (view.html 유출 봉인) ----
--      기존: 인증되면 토큰·지점 검사 모두 건너뛰어 UUID 만으로 타 지점 계약 전체 반환.
create or replace function public.get_signed_contract(p_id uuid, p_token text default null)
returns json language plpgsql security definer set search_path = public as $func$
declare
  v_contract public.contracts%rowtype;
  v_template public.contract_templates%rowtype;
  v_sig      public.contract_signatures%rowtype;
  v_authed   boolean := auth.uid() is not null;
  v_events   json;
begin
  select * into v_contract from public.contracts where id = p_id;
  if not found then return json_build_object('error','not_found'); end if;

  if v_authed then
    if not public.can_access_branch(v_contract.branch) then
      return json_build_object('error','forbidden');
    end if;
  else
    if p_token is null or p_token <> v_contract.sign_token then
      return json_build_object('error','unauthorized');
    end if;
  end if;

  select * into v_template from public.contract_templates where id = v_contract.template_id;
  select * into v_sig      from public.contract_signatures where contract_id = p_id;

  if not v_authed then
    insert into public.contract_audit_log(contract_id, event_type, ip)
    values (p_id, 'pdf_viewed', public.request_ip());
  end if;

  if v_authed then
    select coalesce(json_agg(json_build_object(
      'event_type', event_type, 'event_data', event_data,
      'ip', ip, 'created_at', created_at) order by created_at), '[]'::json)
    into v_events from public.contract_audit_log where contract_id = p_id;
  end if;

  return json_build_object(
    'contract',  row_to_json(v_contract),
    'template',  row_to_json(v_template),
    'signature', case when v_sig.contract_id is null then null else row_to_json(v_sig) end,
    'audit_events', v_events);
end;
$func$;
grant execute on function public.get_signed_contract(uuid, text) to anon, authenticated;

-- ---- 2-8. expire_old_contracts: 직원 실행 차단, 스케줄러만 ----------
revoke execute on function public.expire_old_contracts() from public;
revoke execute on function public.expire_old_contracts() from authenticated;
grant  execute on function public.expire_old_contracts() to service_role;

-- ---- 2-9. 구 지점키 → 신 지점키 (fail-closed 오탐 방지) --------------
update public.contracts set branch = '용산 1호점'      where branch = '용산점';
update public.contracts set branch = '서초 2호점'      where branch = '서초점';
update public.contracts set branch = '피티앤골프 3호점' where branch = '골프스튜디오';

-- ---- 2-10. 직원 지점 권한: stale 키 제거 후 치환 --------------------
--      branch 직원에 role:admin 이 잘못 남아있어도 여기서 깨끗이 덮어씀.
--      (계정 이메일이 다르면 아래 4줄의 email 을 실제 계정에 맞게 수정)
update auth.users set raw_app_meta_data =
  coalesce(raw_app_meta_data,'{}'::jsonb) - 'branches' || '{"role":"admin"}'::jsonb
  where email = 'ceo@nationalgym.kr';
update auth.users set raw_app_meta_data =
  coalesce(raw_app_meta_data,'{}'::jsonb) - 'role' || '{"branches":["용산 1호점"]}'::jsonb
  where email = 'yongsan@nationalgym.kr';
update auth.users set raw_app_meta_data =
  coalesce(raw_app_meta_data,'{}'::jsonb) - 'role' || '{"branches":["서초 2호점"]}'::jsonb
  where email = 'seocho@nationalgym.kr';
update auth.users set raw_app_meta_data =
  coalesce(raw_app_meta_data,'{}'::jsonb) - 'role' || '{"branches":["피티앤골프 3호점"]}'::jsonb
  where email = 'ptgolf@nationalgym.kr';

-- 확인: select email, raw_app_meta_data from auth.users order by created_at;
-- ⚠ 실행 후 전 직원 재로그인. 공유 계정(같은 이메일 다수 사용) 중단 필요.
