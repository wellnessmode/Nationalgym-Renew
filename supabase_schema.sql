-- ===========================================================================
-- 내셔널짐 전자계약서 시스템 스키마 v2 (Enterprise)
-- ===========================================================================
--
--  ⚠️  중요: 반드시 "별도 신규 Supabase 프로젝트"에 실행하세요.
--      - 기존 golf_pt_collabo (members/assessments/sessions/reports) 프로젝트
--        ❌ 에 적용 금지
--      - 본 시스템 전용 신규 프로젝트만 사용
--
--  사용 방법:
--    1) https://supabase.com → New project
--       (이름 예: "nationalgym-contract")
--    2) Project Settings → API 에서 URL / anon key 메모
--    3) 본 파일을 SQL Editor 에 전체 복사하여 실행
--    4) Authentication → Users 에서 관리자 계정 추가
--    5) 같은 폴더의 config.js 에 URL / anon key 입력
--
--  v2 (Enterprise) 변경사항:
--    - 손글씨 서명 → 체크박스 동의 기반 (전자서명법 2020 개정 효력 인정)
--    - 본인확인(이름+생년월일+휴대폰 끝4) 게이트 추가
--    - content_hash(SHA-256) 무결성 보장
--    - 서버사이드 스냅샷 재구성 (RPC 내 template 재조회)
--    - inet_client_addr() / x-forwarded-for 자동 IP 수집
--    - 감사 이벤트 세분화 (link_viewed, terms_scrolled, identity_verified,
--      consent_checked, consented, pdf_downloaded)
--    - signed 후 immutable 트리거
--    - audit_log append-only 트리거
--    - PIPA 분리 동의(수집/민감/제3자/마케팅) 시드 반영
--    - 방문판매법 §31 중도해지권 안내, 표준약관 §10095 환불공식 명시
-- ===========================================================================

-- 안전 가드: 기존 골프PT콜라보 프로젝트에 잘못 적용하는 것을 방지
-- (members 테이블이 존재하는 프로젝트라면 즉시 중단)
do $guard$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'members'
  ) then
    raise exception
      '이 프로젝트에는 골프PT콜라보 데이터(members 테이블)이 이미 존재합니다. '
      '전자계약서 시스템은 반드시 별도 신규 Supabase 프로젝트에 적용하세요. '
      '(만약 의도적으로 같은 프로젝트에 적용하려면 이 가드 블록을 삭제 후 재실행)';
  end if;
end;
$guard$;

-- 0) 확장 (gen_random_uuid, sha256)
create extension if not exists pgcrypto;

-- ===========================================================================
-- 1) 약관 템플릿
-- ===========================================================================
create table if not exists public.contract_templates (
  id              uuid primary key default gen_random_uuid(),
  contract_type   text not null check (contract_type in ('pt','golf','combo','custom')),
  version         text not null,
  title           text not null,
  body_html       text not null,
  agreements_json jsonb not null default '[]'::jsonb,
  privacy_json    jsonb not null default '{}'::jsonb,
  refund_policy_json jsonb not null default '{}'::jsonb,
  branch          text,
  is_active       boolean not null default true,
  effective_from  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (contract_type, version)
);

alter table public.contract_templates
  add column if not exists privacy_json jsonb not null default '{}'::jsonb;
alter table public.contract_templates
  add column if not exists refund_policy_json jsonb not null default '{}'::jsonb;
-- branch: null 이면 모든 지점 공통, 값이 있으면 해당 지점에서만 사용 (지점 특화 약관)
alter table public.contract_templates
  add column if not exists branch text;
create index if not exists templates_type_branch_idx
  on public.contract_templates(contract_type, branch, is_active);

-- 무료 짐 이용권 (2026-06-24): PT 횟수별 자동 세팅.
--   gym_days     = 발송 시점 박제(추적·표시용), PT 상품 선택 시 config.js PRODUCTS.gym_days 에서 자동 채워짐
--   gym_period_end = 이용 시작일 + gym_days (시작일은 contract_period_start 와 동일하다고 가정)
--   immutable 트리거 대상 아님 → 서명완료 후에도 운영상 보정 가능
alter table public.contracts
  add column if not exists gym_days int;
alter table public.contracts
  add column if not exists gym_period_end date;

-- ===========================================================================
-- 2) 계약 인스턴스
-- ===========================================================================
create table if not exists public.contracts (
  id                     uuid primary key default gen_random_uuid(),
  template_id            uuid not null references public.contract_templates(id),
  branch                 text,
  member_name            text not null,
  member_phone           text not null,
  member_birth           date,
  member_address         text,
  member_email           text,
  business_name          text not null,
  business_owner         text not null,
  business_registration  text,
  business_address       text,
  business_phone         text,
  items_json             jsonb not null,
  total_amount           integer not null,
  payment_method         text,
  contract_period_start  date,
  contract_period_end    date,
  locker_no              text,
  locker_months          integer,
  notes                  text,
  sign_token             text not null unique,
  status                 text not null default 'pending'
                          check (status in ('pending','sent','viewed','identified','consented','signed','expired','canceled')),
  expires_at             timestamptz not null,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  sent_at                timestamptz,
  viewed_at              timestamptz,
  identity_verified_at   timestamptz,
  terms_scrolled_at      timestamptz,
  signed_at              timestamptz,  -- 동의 완료 = legacy 'signed_at'
  content_hash           text,
  signer_ip              text,
  signer_user_agent      text,
  signer_fingerprint_hash text
);

-- v1 호환: 기존 필드 그대로 + 새 필드 추가 (idempotent)
alter table public.contracts add column if not exists business_address text;
alter table public.contracts add column if not exists business_phone text;
alter table public.contracts add column if not exists identity_verified_at timestamptz;
alter table public.contracts add column if not exists terms_scrolled_at timestamptz;
alter table public.contracts add column if not exists content_hash text;
alter table public.contracts add column if not exists signer_ip text;
alter table public.contracts add column if not exists signer_user_agent text;
alter table public.contracts add column if not exists signer_fingerprint_hash text;

-- status check constraint 갱신 (v1: pending/sent/viewed/signed/expired/canceled)
do $$
begin
  alter table public.contracts drop constraint if exists contracts_status_check;
  alter table public.contracts add constraint contracts_status_check
    check (status in ('pending','sent','viewed','identified','consented','signed','expired','canceled'));
exception when others then null;
end$$;

create index if not exists contracts_token_idx   on public.contracts(sign_token);
create index if not exists contracts_status_idx  on public.contracts(status);
create index if not exists contracts_phone_idx   on public.contracts(member_phone);
create index if not exists contracts_created_idx on public.contracts(created_at desc);
create index if not exists contracts_branch_idx  on public.contracts(branch);

-- ===========================================================================
-- 3) 동의/서명 (계약당 1개)
--    v2: signature_data_url 옵션화. consent_method 컬럼 추가.
-- ===========================================================================
create table if not exists public.contract_signatures (
  contract_id            uuid primary key references public.contracts(id) on delete cascade,
  signature_data_url     text,
  consent_method         text not null default 'checkbox'
                          check (consent_method in ('checkbox','handwritten')),
  agreed_items           jsonb not null,
  contract_html_snapshot text not null,
  signer_ip              text,
  signer_user_agent      text,
  signer_fingerprint_hash text,
  signed_at              timestamptz not null default now(),
  pdf_storage_path       text
);

alter table public.contract_signatures alter column signature_data_url drop not null;
alter table public.contract_signatures
  add column if not exists consent_method text not null default 'checkbox';
alter table public.contract_signatures
  add column if not exists signer_fingerprint_hash text;

do $$
begin
  alter table public.contract_signatures drop constraint if exists contract_signatures_consent_method_check;
  alter table public.contract_signatures add constraint contract_signatures_consent_method_check
    check (consent_method in ('checkbox','handwritten'));
exception when others then null;
end$$;

-- ===========================================================================
-- 4) 감사 로그 (append-only)
-- ===========================================================================
create table if not exists public.contract_audit_log (
  id          bigserial primary key,
  contract_id uuid references public.contracts(id) on delete cascade,
  event_type  text not null,
  event_data  jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_contract_idx on public.contract_audit_log(contract_id);
create index if not exists audit_event_idx    on public.contract_audit_log(event_type);

-- audit_log append-only 트리거 (UPDATE/DELETE 차단)
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'contract_audit_log is append-only — UPDATE/DELETE 금지';
end$$;

drop trigger if exists audit_log_no_update on public.contract_audit_log;
drop trigger if exists audit_log_no_delete on public.contract_audit_log;
create trigger audit_log_no_update before update on public.contract_audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_delete before delete on public.contract_audit_log
  for each row execute function public.audit_log_immutable();

-- consented 후 contracts 변경 차단 트리거
create or replace function public.contracts_lock_after_consent()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'UPDATE') then
    if old.status in ('consented','signed') then
      if old.id != new.id then
        raise exception 'contract id 변경 불가';
      end if;
      -- 핵심 컨텐츠 변경 차단
      if old.template_id is distinct from new.template_id
         or old.member_name is distinct from new.member_name
         or old.member_phone is distinct from new.member_phone
         or old.items_json::text is distinct from new.items_json::text
         or old.total_amount is distinct from new.total_amount
         or old.content_hash is distinct from new.content_hash
         or old.signed_at is distinct from new.signed_at then
        raise exception '서명/동의 완료된 계약의 핵심 내용은 변경할 수 없습니다.';
      end if;
    end if;
  end if;
  return new;
end$$;

drop trigger if exists contracts_lock_after_consent_trg on public.contracts;
create trigger contracts_lock_after_consent_trg
  before update on public.contracts
  for each row execute function public.contracts_lock_after_consent();

-- contract_signatures 변경 차단 트리거
create or replace function public.signatures_immutable()
returns trigger language plpgsql as $$
begin
  raise exception '서명/동의 레코드는 변경할 수 없습니다. (consent_method=% , contract_id=%)',
    old.consent_method, old.contract_id;
end$$;

drop trigger if exists signatures_no_update on public.contract_signatures;
create trigger signatures_no_update before update on public.contract_signatures
  for each row execute function public.signatures_immutable();

-- ===========================================================================
-- RLS — 인증 직원은 "자기 지점" 계약만, 비인증은 RPC(security definer) 만 허용
--   app_metadata.role='admin' → 전 지점 / 그 외 → app_metadata.branches 배열 포함 지점만.
--   app_metadata 는 service_role·SQL 로만 수정 가능(직원이 토큰을 위조해도 변경 불가).
--   ※ 직원 계정별 지점 부여 SQL 은 파일 하단 "직원 지점 권한" 섹션 참고.
-- ===========================================================================
alter table public.contract_templates  enable row level security;
alter table public.contracts           enable row level security;
alter table public.contract_signatures enable row level security;
alter table public.contract_audit_log  enable row level security;

-- 현재 로그인 직원이 해당 지점을 볼 수 있는가 (JWT app_metadata 기반)
create or replace function public.can_access_branch(p_branch text)
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      p_branch is not null
      and p_branch = any (
        select jsonb_array_elements_text(
          coalesce(auth.jwt() -> 'app_metadata' -> 'branches', '[]'::jsonb)
        )
      )
    );
$$;
grant execute on function public.can_access_branch(text) to authenticated;

drop policy if exists "auth all contracts"      on public.contracts;
drop policy if exists "auth all templates"       on public.contract_templates;
drop policy if exists "auth all signatures"      on public.contract_signatures;
drop policy if exists "auth all audit"           on public.contract_audit_log;
drop policy if exists "branch scoped contracts"  on public.contracts;
drop policy if exists "branch scoped signatures" on public.contract_signatures;
drop policy if exists "branch scoped audit"      on public.contract_audit_log;

-- 계약: 자기 지점만 (조회·발송 공통). with check 가 타 지점 발송(INSERT)도 차단.
create policy "branch scoped contracts" on public.contracts
  for all to authenticated
  using (public.can_access_branch(branch))
  with check (public.can_access_branch(branch));

-- 약관 템플릿: PII 아님 + 공통(branch IS NULL) fallback 노출 필요 → 인증 직원 모두 열람.
create policy "auth all templates" on public.contract_templates
  for all to authenticated using (true) with check (true);

-- 서명/감사: 자체 branch 컬럼 없음 → 부모 계약(contract_id)의 지점으로 스코프.
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

-- ===========================================================================
-- 헬퍼: 요청 IP 추출 (서버사이드)
-- ===========================================================================
create or replace function public.request_ip()
returns text
language plpgsql
security definer
set search_path = public
as $func$
declare
  xff text;
  cip inet;
begin
  begin
    xff := current_setting('request.headers', true)::json->>'x-forwarded-for';
  exception when others then xff := null;
  end;
  if xff is not null and length(xff) > 0 then
    return split_part(xff, ',', 1);
  end if;
  begin
    cip := inet_client_addr();
  exception when others then cip := null;
  end;
  return host(cip);
end;
$func$;
grant execute on function public.request_ip() to anon, authenticated;

-- ===========================================================================
-- RPC: 회원이 토큰으로 계약 열람 (1단계 — 본인확인 전)
--   계약 기본 메타와 만료/상태만 반환. 실제 계약 내용은 본인확인 후 반환.
-- ===========================================================================
create or replace function public.get_contract_intro(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_contract public.contracts%rowtype;
  v_template public.contract_templates%rowtype;
begin
  select * into v_contract
  from public.contracts
  where sign_token = p_token;

  if not found then
    return json_build_object('error', 'invalid');
  end if;

  if v_contract.expires_at < now() then
    if v_contract.status not in ('signed','consented','canceled') then
      update public.contracts set status = 'expired'
       where id = v_contract.id and status not in ('signed','consented','canceled');
    end if;
    return json_build_object('error', 'expired',
      'business_name', v_contract.business_name,
      'business_phone', v_contract.business_phone);
  end if;

  if v_contract.status in ('consented','signed') then
    return json_build_object('error', 'already_signed',
      'contract_id', v_contract.id,
      'signed_at', v_contract.signed_at);
  end if;

  if v_contract.viewed_at is null then
    update public.contracts
       set status = case when status in ('pending','sent') then 'viewed' else status end,
           viewed_at = now()
     where id = v_contract.id;
    insert into public.contract_audit_log(contract_id, event_type, ip)
    values (v_contract.id, 'link_viewed', public.request_ip());
    v_contract.viewed_at := now();
  end if;

  select * into v_template
  from public.contract_templates
  where id = v_contract.template_id;

  return json_build_object(
    'business_name',    v_contract.business_name,
    'business_phone',   v_contract.business_phone,
    'member_name_masked', regexp_replace(v_contract.member_name, '^(.).+$', '\1**'),
    'expires_at',       v_contract.expires_at,
    'template_title',   v_template.title,
    'template_version', v_template.version
  );
end;
$func$;
grant execute on function public.get_contract_intro(text) to anon, authenticated;

-- ===========================================================================
-- RPC: 본인확인 (이름 + 생년월일 + 휴대폰 끝 4자리)
-- ===========================================================================
create or replace function public.verify_identity(
  p_token text,
  p_name text,
  p_birth date,
  p_phone_last4 text
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_contract public.contracts%rowtype;
  v_match    boolean;
  v_attempts int;
begin
  select * into v_contract
  from public.contracts
  where sign_token = p_token
    and status in ('pending','sent','viewed','identified')
    and expires_at > now()
  for update;

  if not found then
    return json_build_object('error','invalid_or_expired');
  end if;

  -- Rate limit: 같은 token + ip 에서 5분 내 5회 실패 시 차단
  select count(*) into v_attempts
  from public.contract_audit_log
  where contract_id = v_contract.id
    and event_type = 'identity_failed'
    and created_at > now() - interval '5 minutes';
  if v_attempts >= 5 then
    return json_build_object('error','too_many_attempts');
  end if;

  v_match :=
       (trim(v_contract.member_name) = trim(p_name))
    and (v_contract.member_birth is not null and v_contract.member_birth = p_birth)
    and (right(regexp_replace(v_contract.member_phone, '[^0-9]', '', 'g'), 4) = p_phone_last4);

  if not v_match then
    insert into public.contract_audit_log(contract_id, event_type, event_data, ip)
    values (v_contract.id, 'identity_failed',
            jsonb_build_object('name_match', trim(v_contract.member_name) = trim(p_name)),
            public.request_ip());
    return json_build_object('error','identity_mismatch');
  end if;

  update public.contracts
     set status = case when status = 'consented' then status else 'identified' end,
         identity_verified_at = coalesce(identity_verified_at, now())
   where id = v_contract.id;

  insert into public.contract_audit_log(contract_id, event_type, ip)
  values (v_contract.id, 'identity_verified', public.request_ip());

  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.verify_identity(text,text,date,text) to anon, authenticated;

-- ===========================================================================
-- RPC: 본인확인 후 계약 전체 조회
-- ===========================================================================
create or replace function public.get_contract_for_signing(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_contract public.contracts%rowtype;
  v_template public.contract_templates%rowtype;
begin
  select * into v_contract
  from public.contracts
  where sign_token = p_token
    and status in ('identified','viewed','sent','pending')
    and expires_at > now();
  if not found then
    return json_build_object('error', 'invalid_or_expired');
  end if;

  if v_contract.identity_verified_at is null then
    return json_build_object('error', 'identity_required');
  end if;

  select * into v_template
  from public.contract_templates
  where id = v_contract.template_id;

  return json_build_object(
    'contract', row_to_json(v_contract),
    'template', row_to_json(v_template)
  );
end;
$func$;
grant execute on function public.get_contract_for_signing(text) to anon, authenticated;

-- ===========================================================================
-- RPC: 회원 이벤트 로그 (스크롤/체크 등)
-- ===========================================================================
create or replace function public.log_contract_event(
  p_token      text,
  p_event_type text,
  p_event_data jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_fingerprint_hash text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_contract public.contracts%rowtype;
  v_allowed  text[] := array[
    'terms_scrolled','terms_top','terms_section_viewed',
    'consent_checked','consent_unchecked','consent_all_checked',
    'identity_attempt','pdf_viewed','pdf_downloaded',
    'page_unload','reopen','client_error'
  ];
begin
  if not (p_event_type = any(v_allowed)) then
    return json_build_object('error','unsupported_event');
  end if;

  select * into v_contract from public.contracts where sign_token = p_token;
  if not found then return json_build_object('error','invalid'); end if;

  insert into public.contract_audit_log(contract_id, event_type, event_data, ip, user_agent)
  values (v_contract.id, p_event_type, p_event_data, public.request_ip(), p_user_agent);

  if p_event_type = 'terms_scrolled' and v_contract.terms_scrolled_at is null then
    update public.contracts set terms_scrolled_at = now() where id = v_contract.id;
  end if;

  if p_fingerprint_hash is not null and v_contract.signer_fingerprint_hash is null then
    update public.contracts set signer_fingerprint_hash = p_fingerprint_hash
     where id = v_contract.id;
  end if;

  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.log_contract_event(text,text,jsonb,text,text) to anon, authenticated;

-- ===========================================================================
-- RPC: 최종 동의 제출 (체크박스 기반)
--   - 서버측에서 template body_html 다시 읽어 스냅샷 재구성 (변조 차단)
--   - content_hash = SHA-256(template + items + total + agreed_items + phone)
--   - IP / UA / fingerprint 자동 기록
-- ===========================================================================
create or replace function public.submit_consent(
  p_token              text,
  p_agreed_items       jsonb,
  p_user_agent         text,
  p_fingerprint_hash   text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $func$
declare
  v_contract  public.contracts%rowtype;
  v_template  public.contract_templates%rowtype;
  v_required  jsonb;
  v_missing   text;
  v_snapshot  text;
  v_hash      text;
  v_ip        text;
begin
  select * into v_contract
  from public.contracts
  where sign_token = p_token
    and status in ('identified')
    and expires_at > now()
  for update;

  if not found then
    return json_build_object('error','invalid_or_unauthorized');
  end if;

  if v_contract.identity_verified_at is null then
    return json_build_object('error','identity_required');
  end if;

  select * into v_template
  from public.contract_templates
  where id = v_contract.template_id;

  -- 필수 동의 항목 검증 (서버측에서 한 번 더 확인)
  for v_required in
    select jsonb_array_elements(v_template.agreements_json)
  loop
    if (v_required->>'required')::boolean is true then
      if coalesce((p_agreed_items->>(v_required->>'key'))::boolean, false) is not true then
        v_missing := v_required->>'key';
        return json_build_object('error','required_consent_missing','missing_key', v_missing);
      end if;
    end if;
  end loop;

  -- 서버측 스냅샷 재구성: template 본문 + 동의 항목 라벨 + 결과
  v_snapshot :=
    '<div class="contract-snapshot">' ||
    '<div class="terms-body">' || v_template.body_html || '</div>' ||
    '<h3>동의 항목</h3><ul>';
  for v_required in select jsonb_array_elements(v_template.agreements_json) loop
    v_snapshot := v_snapshot ||
      '<li>' ||
      case when coalesce((p_agreed_items->>(v_required->>'key'))::boolean, false)
           then '☑ ' else '☐ ' end ||
      case when (v_required->>'required')::boolean is true then '[필수] ' else '[선택] ' end ||
      coalesce(v_required->>'label','') ||
      '</li>';
  end loop;
  v_snapshot := v_snapshot || '</ul></div>';

  -- content_hash 계산 (Supabase: pgcrypto는 extensions 스키마)
  v_hash := encode(
    extensions.digest(
      coalesce(v_contract.template_id::text,'') || '|' ||
      coalesce(v_template.version,'') || '|' ||
      coalesce(v_contract.items_json::text,'') || '|' ||
      coalesce(v_contract.total_amount::text,'') || '|' ||
      coalesce(v_contract.member_phone,'') || '|' ||
      coalesce(v_contract.member_name,'') || '|' ||
      coalesce(p_agreed_items::text,'')
      , 'sha256'::text),
    'hex');

  v_ip := public.request_ip();

  insert into public.contract_signatures(
    contract_id, consent_method, agreed_items,
    contract_html_snapshot,
    signer_ip, signer_user_agent, signer_fingerprint_hash
  ) values (
    v_contract.id, 'checkbox', p_agreed_items,
    v_snapshot,
    v_ip, p_user_agent, p_fingerprint_hash
  )
  on conflict (contract_id) do nothing;

  update public.contracts
     set status = 'signed',
         signed_at = now(),
         content_hash = v_hash,
         signer_ip = coalesce(signer_ip, v_ip),
         signer_user_agent = coalesce(signer_user_agent, p_user_agent),
         signer_fingerprint_hash = coalesce(signer_fingerprint_hash, p_fingerprint_hash)
   where id = v_contract.id;

  insert into public.contract_audit_log(contract_id, event_type, event_data, ip, user_agent)
  values (v_contract.id, 'consented',
          jsonb_build_object('content_hash', v_hash, 'agreed', p_agreed_items),
          v_ip, p_user_agent);

  return json_build_object('ok', true,
                           'contract_id', v_contract.id,
                           'content_hash', v_hash);
end;
$func$;
grant execute on function public.submit_consent(text,jsonb,text,text) to anon, authenticated;

-- ===========================================================================
-- (legacy) RPC: 손글씨 서명 제출 — v2 에서는 비활성 권장. 호환 위해 유지
-- ===========================================================================
create or replace function public.submit_signature(
  p_token                 text,
  p_signature_data_url    text,
  p_agreed_items          jsonb,
  p_contract_html_snapshot text,
  p_signer_user_agent     text
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_result json;
begin
  v_result := public.submit_consent(p_token, p_agreed_items, p_signer_user_agent, null);
  return v_result;
end;
$func$;
grant execute on function public.submit_signature(text,text,jsonb,text,text) to anon, authenticated;

-- ===========================================================================
-- RPC: 서명 완료 계약 조회 (회원은 토큰, 관리자는 인증)
-- ===========================================================================
create or replace function public.get_signed_contract(p_id uuid, p_token text default null)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_contract  public.contracts%rowtype;
  v_template  public.contract_templates%rowtype;
  v_sig       public.contract_signatures%rowtype;
  v_authed    boolean := auth.uid() is not null;
  v_events    json;
begin
  select * into v_contract from public.contracts where id = p_id;
  if not found then
    return json_build_object('error', 'not_found');
  end if;

  if not v_authed then
    if p_token is null or p_token <> v_contract.sign_token then
      return json_build_object('error', 'unauthorized');
    end if;
  end if;

  select * into v_template from public.contract_templates where id = v_contract.template_id;
  select * into v_sig      from public.contract_signatures where contract_id = p_id;

  -- 회원이 view 페이지 열람한 사실 로깅
  if not v_authed then
    insert into public.contract_audit_log(contract_id, event_type, ip)
    values (p_id, 'pdf_viewed', public.request_ip());
  end if;

  -- 감사 이벤트 (관리자에게만 노출)
  if v_authed then
    select coalesce(json_agg(json_build_object(
      'event_type', event_type,
      'event_data', event_data,
      'ip', ip,
      'created_at', created_at
    ) order by created_at), '[]'::json) into v_events
    from public.contract_audit_log where contract_id = p_id;
  end if;

  return json_build_object(
    'contract',  row_to_json(v_contract),
    'template',  row_to_json(v_template),
    'signature', case when v_sig.contract_id is null then null else row_to_json(v_sig) end,
    'audit_events', v_events
  );
end;
$func$;
grant execute on function public.get_signed_contract(uuid, text) to anon, authenticated;

-- ===========================================================================
-- 만료 처리
-- ===========================================================================
create or replace function public.expire_old_contracts()
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare v_count int;
begin
  update public.contracts
     set status = 'expired'
   where status in ('pending','sent','viewed','identified')
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$func$;
grant execute on function public.expire_old_contracts() to authenticated;

-- ===========================================================================
-- 관리자용 통계 뷰
--   security_invoker=on: 뷰가 조회 직원의 권한(RLS)으로 실행 → 자기 지점 통계만 집계.
--   (미설정 시 뷰 소유자 권한으로 RLS 우회 → 타 지점 건수·서명액 유출됨)
-- ===========================================================================
create or replace view public.contracts_stats_monthly
  with (security_invoker = on)
as
select
  date_trunc('month', created_at)::date as month,
  branch,
  count(*)                                            as total,
  count(*) filter (where status='signed')             as signed,
  count(*) filter (where status='viewed')             as viewed,
  count(*) filter (where status='sent')               as sent,
  count(*) filter (where status='expired')            as expired,
  sum(total_amount) filter (where status='signed')    as signed_amount
from public.contracts
group by 1,2
order by 1 desc, 2;

grant select on public.contracts_stats_monthly to authenticated;

-- ===========================================================================
-- 시드 약관 — 본문은 사업장 원문 유지, 분리동의·정책 메타데이터만 v2 구조
-- ON CONFLICT DO UPDATE: 재실행 시 본문/동의항목 갱신 (created_at은 보존)
-- 2026-06-10: PT 유효기간 변경 (10회 2개월 / 20회 3개월 / 30회 4개월) — 직원 피드백
-- ===========================================================================

insert into public.contract_templates (contract_type, version, title, body_html, agreements_json, privacy_json, refund_policy_json)
values ('combo', '2026-06-10', '내셔널짐 PT & 골프 이용 계약서',
$tpl$
<p><b>NATIONAL GYM PT &amp; GOLF</b> 이용 약관입니다. 본 계약은 내셔널짐(개인사업자, 이하 "센터")과 회원 사이에 체결됩니다.</p>

<h3>1. 회원 준수 사항</h3>
<ol>
<li>이용권은 명시된 유효기간 · 예약 일자 · 시간 내에서만 사용 가능합니다.</li>
<li>유효기간은 첫 사용일 기준으로 산정되며, 별도의 홀딩 요청 없이 기간 만료 시 자동 소멸됩니다.</li>
<li>질병 · 개인사정 등으로 인한 미사용분은 별도 보장되지 않습니다.</li>
<li>예약 변경은 최소 12시간 전까지 가능하며, 당일 취소 또는 무단 결석 시 해당 레슨은 진행된 것으로 간주합니다.</li>
<li>운영시간 및 휴무일은 센터 공지에 따릅니다.</li>
<li>레슨 패키지에 포함된 30분 연습 이용은 레슨 진행 당일에만 사용 가능하며, 당일 미사용 시 별도 적립 · 이월이 불가합니다.</li>
<li>담당 트레이너 / 프로의 사정으로 레슨이 불가능할 시 담당자가 변경될 수 있으며, 이는 환불의 사유가 되지 않습니다.</li>
<li>(골프) 레슨 단품권은 단독으로 이용하실 수 없으며, 반드시 타석 이용권을 보유하셔야 레슨 진행 및 센터 입장이 가능합니다.</li>
<li>센터의 제반 시설 이용 중 발생한 불가항력적 사유, 사전 통보되지 않은 개인 사유(질병 포함), 또는 회원의 귀책사유로 인한 이용 불가에 대해서는 센터가 책임을 지지 않습니다.</li>
<li>시설물 및 대여 물품에 대하여 고의 · 과실로 인한 훼손 · 파손 시 해당 회원이 모든 책임을 집니다.</li>
<li>센터 물품의 무단 반출 또는 훼손이 확인될 경우, 해당 물품의 시가 및 이에 준하는 손해액(최소 시가의 2배)을 배상하여야 하며, 센터는 회원 자격을 제한하거나 해지할 수 있습니다.</li>
<li>귀중품은 반드시 안내데스크에 보관하여야 하며, 보관하지 않은 물품의 분실 · 멸실 · 훼손에 대한 책임은 회원 본인에게 있습니다.</li>
<li>골프 사물함 이용기간 만료 후 남아 있는 물품은 센터에서 회수하여 7일간 보관하며, 보관기간 경과 후에는 임의 처분(폐기 포함)할 수 있습니다. 골프 사물함 이용료는 1개월 기준 상단 2만원, 하단 3만원이며, 환불 시 공제 대상에 포함되지 않습니다. (헬스 사물함은 1개월 1만원이며, 환불 시 공제되지 않습니다.)</li>
<li>본 센터의 골프 타석은 안전상의 이유로 회원 1인 단독 이용을 원칙으로 하며, 등록되지 않은 인원(동반자 등)의 타석 사용은 금지됩니다. 이를 위반 시 즉시 이용 제한 또는 회원 자격 제한 등의 제재가 적용될 수 있습니다.</li>
<li>회원의 안전 및 원활한 센터 이용을 위해 본 약관과 운영규정을 위반하거나 전염병 · 풍기문란 · 사고 및 영업에 방해를 끼치는 모든 행위로 질서 유지에 지장을 초래한 경우 회원의 권리를 제한 · 박탈합니다.</li>
</ol>

<h3>2. 유효기간 및 홀딩 규정</h3>
<table>
<thead><tr><th>구분</th><th>이용 시간</th><th>유효기간</th><th>홀딩 규정</th></tr></thead>
<tbody>
<tr><td rowspan="2">골프 레슨</td><td rowspan="2">25분 / 50분</td><td>8회 — 2개월</td><td>2개월권 — 14일</td></tr>
<tr><td>20회 · 30회 — 4개월</td><td>4개월권 — 28일</td></tr>
<tr><td rowspan="3">골프 타석</td><td rowspan="3">1회 55분</td><td>1개월</td><td>1개월권 — 7일</td></tr>
<tr><td>3개월</td><td>3개월권 — 21일</td></tr>
<tr><td>6개월</td><td>6개월권 — 35일</td></tr>
<tr><td rowspan="3">PT</td><td rowspan="3">1회 50분</td><td>10회 — 2개월</td><td>10회 — 7일</td></tr>
<tr><td>20회 — 3개월</td><td>20회 — 21일</td></tr>
<tr><td>30회 — 4개월</td><td>30회 — 30일</td></tr>
</tbody>
</table>
<p>유효기간 내 홀딩 가능 횟수: 10회권 1회, 20회 · 30회권은 2회. (1개월권은 1회, 그 외 이용권은 2회)</p>

<h3>3. 환불 및 양도, 업그레이드</h3>
<ol>
<li>최초 등록 후 3회 이용 시점까지 업그레이드 신청이 가능하며, 차액을 납부하여 변경할 수 있습니다.</li>
<li>원칙상 환불은 불가하나 불가피한 사유가 발생한 경우 증빙 서류 제출 및 센터 승인을 통해 소비자 피해 보상 규정에 따라 환불 처리됩니다.</li>
<li><b>환불 공제금액</b>: 결제금액 − 위약금 10% − 카드 수수료 5% − 사은품 및 서비스 공제
  <ul>
    <li>(타석 이용권) 등록일부터 해지일까지의 날짜 × 1회 이용료 35,000원</li>
    <li>(레슨 / PT 이용권) 1회 정상가 × 이용횟수</li>
  </ul>
</li>
<li>양도는 30일 이상 잔여기간이 남아있을 때에 한하여 1회만 가능하며 양도수수료는 5만원이 발생됩니다. 단, 1회 양도 이후 환불 / 재양도 / 휴회 적용이 불가합니다. (본 센터에서는 양도를 주선하거나 소개하지 않습니다.)</li>
</ol>

<h3>4. 개인정보의 처리</h3>
<ul>
<li><b>수집 항목</b>: 이름, 휴대폰번호, 생년월일, 주소, 결제정보</li>
<li><b>이용 목적</b>: 회원 관리, 서비스 제공, 예약 · 결제 처리, 안전사고 대응</li>
<li><b>보유 기간</b>: 회원 자격 유지기간 및 관계법령에 따른 보존기간 (전자상거래법 5년 등)</li>
<li><b>제3자 제공</b>: 결제대행사 · 세무 신고를 위한 최소 정보 외 제공하지 않음</li>
</ul>

<p style="color:#666;font-size:12px">본 약관 시행일: 2026년 6월 10일</p>
$tpl$,
$ag$[
{"key":"terms","label":"위 PT & 골프 이용 약관 전문에 동의합니다.","required":true,"group":"core"},
{"key":"refund","label":"환불 및 양도 규정(위약금 10%, 카드수수료 5%, 회당 정상가 공제 등)을 충분히 이해하였으며 이에 동의합니다.","required":true,"group":"core"},
{"key":"privacy","label":"서비스 제공·회원관리를 위한 개인정보(이름·연락처·생년월일·주소) 수집·이용에 동의합니다.","required":true,"group":"privacy"},
{"key":"privacy_third","label":"결제대행사·세무신고 등 법정 의무 이행을 위한 최소 정보의 제3자 제공에 동의합니다.","required":true,"group":"privacy"},
{"key":"health","label":"본인의 건강상태(질환·부상 등)에 대해 사실대로 고지하였으며, 운동 중 발생할 수 있는 위험을 인지하고 있음을 확인합니다.","required":true,"group":"sensitive"},
{"key":"single_use","label":"(골프) 골프 타석은 회원 1인 단독 이용이 원칙임을 확인합니다.","required":false,"group":"facility"},
{"key":"locker","label":"사물함 이용료 및 만료 후 보관·폐기 규정을 확인하였습니다.","required":true,"group":"facility"},
{"key":"marketing","label":"(선택) 마케팅·이벤트·프로모션 정보 수신에 동의합니다.","required":false,"group":"marketing"}
]$ag$::jsonb,
$pj$ {
  "items": ["이름","휴대폰번호","생년월일","주소","결제정보"],
  "purpose": "회원 관리·서비스 제공·예약/결제 처리·안전사고 대응",
  "retention": "회원자격 유지기간 및 관계법령 보존기간(전자상거래법 5년 등)",
  "third_party": ["결제대행사","세무신고 대행"]
} $pj$::jsonb,
$rp$ {
  "penalty_pct": 10,
  "card_fee_pct": 5,
  "deductions": ["(타석 이용권) 등록일~해지일 일수 × 1회 이용료 35,000원","(레슨/PT 이용권) 1회 정상가 × 이용횟수","사은품 및 서비스 가액"]
} $rp$::jsonb)
on conflict (contract_type, version) do update set
  title              = excluded.title,
  body_html          = excluded.body_html,
  agreements_json    = excluded.agreements_json,
  privacy_json       = excluded.privacy_json,
  refund_policy_json = excluded.refund_policy_json;

-- (2) PT 단독 — 용산 1호점·서초 2호점 공통 (두 지점 약관 동일).
--     매니저 제공 본문: 운영시간 명시, 유효기간 첫 레슨일 기준 1년(표/홀딩 없음),
--     짐 이용권 조항, 환불 공제 = 1회 정상가 × 기제공 레슨(유·무료 포함).
--     ※ 운영시간이 지점마다 다르면 branch 컬럼으로 분기 (per-branch-templates.md)
insert into public.contract_templates (contract_type, version, title, body_html, agreements_json, privacy_json, refund_policy_json)
values ('pt', '2026-06-22', '내셔널짐 PT 이용 계약서',
$tpl$
<p>본 계약은 내셔널짐(개인사업자, 이하 "센터")과 회원 사이의 PT(퍼스널 트레이닝) 이용에 관한 사항을 규정합니다.</p>

<h3>1. 운영시간</h3>
<ul>
<li>평일: 06:00 - 23:00 / 토요일: 10:00 - 16:00</li>
<li>일요일 및 공휴일 휴무 (단, 센터 운영상 영업시간 및 영업일을 조정할 수 있음)</li>
</ul>

<h3>2. 회원 준수사항</h3>
<ol>
<li>내셔널짐 회원은 레슨 유효기간, 예약 일자 및 시간을 엄수하여 중단 없이 사용하여야 합니다.</li>
<li>레슨은 50분간 진행됩니다.</li>
<li>예약 변경은 12시간 전에 이루어져야 하며, 무단결석 및 당일 취소 건에 한해서 레슨은 진행된 것으로 간주합니다.</li>
<li>레슨 유효기간은 첫 레슨 시작일을 기준으로 1년이며, 담당 트레이너와의 상의 없이 유효기간 내 사용하지 못할 경우 잔여 횟수에 관계없이 모두 진행된 것으로 간주합니다.</li>
<li>센터의 제반시설을 이용함에 있어 불가항력적인 이유, 센터 측에 공지하지 않은 질병, 본인의 귀책 사유로 인한 사고시에 본 센터는 책임을 지지 않습니다.</li>
<li>귀중품은 안내 데스크에 보관하여야 하며, 보관하지 않은 물품의 분실 · 멸실 · 훼손은 회원 본인이 책임을 집니다.</li>
<li>개인 사물함의 이용 기간이 만료된 후에도 남아있는 물품은 센터 측에서 회수 후 7일간 보관하며 이후에는 폐기합니다. 개인 사물함 비용은 10회당 1만 원이며, 환불 시 공제되지 않습니다.</li>
<li>회원의 안전과 원활한 센터 이용을 위해 본 약관과 운영규정을 위반하거나 전염병 · 풍기문란 · 사고 및 영업에 방해를 끼치는 모든 행위 등으로 질서 유지에 지장을 초래한 경우 회원의 권리를 제한 및 박탈합니다.</li>
<li>시설물 및 대여 물품에 대하여 고의 또는 부주의로 훼손 · 파괴했을 경우 당사자가 책임을 집니다.</li>
<li>센터 운영상 필요에 따라(퇴사, 인사이동) 담당 트레이너는 변경될 수 있으며, 담당 트레이너 변경은 계약 해지 또는 환불 사유에 해당하지 않습니다. 본인은 담당 트레이너 변경이 환불 사유가 되지 않음을 충분히 이해하였으며, 이에 대해 어떠한 이의도 제기하지 않을 것을 확인합니다.</li>
<li>무료로 제공되는 짐 이용권은 센터 정기 휴무일, 임시 휴무일, 법정 공휴일과 관계없이 이용 기간은 연속적으로 차감되며, 개인 사정으로 인한 미사용에 대해서 별도의 보상이나 휴회, 홀딩, 기간 연장이 불가능합니다.</li>
</ol>

<h3>3. 환불 및 양도</h3>
<ul>
<li>원칙상 환불은 불가하나 불가피한 사유가 발생한 경우 증빙 서류 제출 및 센터 승인을 통해 소비자 피해 보상 규정에 따라 환불 처리됩니다.</li>
<li><b>환불 공제금액</b>: 결제금액 − 위약금 10% − 카드 수수료 5% − (1회 정상가 × 기제공 레슨(유·무료 포함))</li>
<li>양도는 유효기간 내에 1회만 가능하며 양도수수료는 5만 원이 발생됩니다. (단, 1회 양도 이후 환불 / 재양도 / 휴회 적용 불가)</li>
<li>본 센터에서는 양도를 주선하거나 소개하지 않습니다.</li>
</ul>

<h3>4. 개인정보 처리</h3>
<p>수집 항목: 이름 · 휴대폰 · 생년월일 · 주소 · 결제정보 / 이용 목적: 회원관리 · 서비스 제공 · 예약 처리 / 보유 기간: 회원 자격 유지기간 및 관계법령 보존기간.</p>

<p style="color:#666;font-size:12px">본 약관 시행일: 2026년 6월 22일</p>
$tpl$,
$ag$[
{"key":"terms","label":"위 PT 이용 약관 전문(운영시간·회원 준수사항 포함)에 동의합니다.","required":true,"group":"core"},
{"key":"refund","label":"환불 및 양도 규정(위약금 10%, 카드수수료 5%, 1회 정상가 × 기제공 레슨 공제 등)을 충분히 이해하였으며 이에 동의합니다.","required":true,"group":"core"},
{"key":"privacy","label":"서비스 제공·회원관리를 위한 개인정보(이름·연락처·생년월일·주소) 수집·이용에 동의합니다.","required":true,"group":"privacy"},
{"key":"privacy_third","label":"결제대행사·세무신고 등 법정 의무 이행을 위한 최소 정보의 제3자 제공에 동의합니다.","required":true,"group":"privacy"},
{"key":"health","label":"본인의 건강상태에 대해 사실대로 고지하였음을 확인합니다.","required":true,"group":"sensitive"},
{"key":"marketing","label":"(선택) 마케팅 및 이벤트 정보 수신에 동의합니다.","required":false,"group":"marketing"}
]$ag$::jsonb,
$pj$ {
  "items":["이름","휴대폰","생년월일","주소","결제정보"],
  "purpose":"회원관리·서비스 제공·예약 처리",
  "retention":"회원자격 유지기간 및 관계법령 보존기간(전자상거래법 5년 등)",
  "third_party":["결제대행사","세무신고 대행"]
} $pj$::jsonb,
$rp$ {
  "penalty_pct":10,
  "card_fee_pct":5,
  "deductions":["1회 정상가 × 기제공 레슨(유·무료 포함)","사은품 및 서비스 가액"]
} $rp$::jsonb)
on conflict (contract_type, version) do update set
  title              = excluded.title,
  body_html          = excluded.body_html,
  agreements_json    = excluded.agreements_json,
  privacy_json       = excluded.privacy_json,
  refund_policy_json = excluded.refund_policy_json;

-- (2-b) PT 단독 — 서초 2호점 전용 (운영시간만 07:00-22:00 으로 다름, 나머지는 공통과 동일).
--       branch 컬럼 분기 첫 실 사용 사례. admin.js refreshTemplate 이 서초 발송 시 이것을 자동 선택,
--       그 외 지점/없을 때는 공통(branch IS NULL) 으로 fallback.
insert into public.contract_templates (contract_type, version, branch, title, body_html, agreements_json, privacy_json, refund_policy_json)
values ('pt', '2026-06-22-seocho', '서초 2호점', '내셔널짐 PT 이용 계약서',
$tpl$
<p>본 계약은 내셔널짐(개인사업자, 이하 "센터")과 회원 사이의 PT(퍼스널 트레이닝) 이용에 관한 사항을 규정합니다.</p>

<h3>1. 운영시간</h3>
<ul>
<li>평일: 07:00 - 22:00 / 토요일: 10:00 - 16:00</li>
<li>일요일 및 공휴일 휴무 (단, 센터 운영상 영업시간 및 영업일을 조정할 수 있음)</li>
</ul>

<h3>2. 회원 준수사항</h3>
<ol>
<li>내셔널짐 회원은 레슨 유효기간, 예약 일자 및 시간을 엄수하여 중단 없이 사용하여야 합니다.</li>
<li>레슨은 50분간 진행됩니다.</li>
<li>예약 변경은 12시간 전에 이루어져야 하며, 무단결석 및 당일 취소 건에 한해서 레슨은 진행된 것으로 간주합니다.</li>
<li>레슨 유효기간은 첫 레슨 시작일을 기준으로 1년이며, 담당 트레이너와의 상의 없이 유효기간 내 사용하지 못할 경우 잔여 횟수에 관계없이 모두 진행된 것으로 간주합니다.</li>
<li>센터의 제반시설을 이용함에 있어 불가항력적인 이유, 센터 측에 공지하지 않은 질병, 본인의 귀책 사유로 인한 사고시에 본 센터는 책임을 지지 않습니다.</li>
<li>귀중품은 안내 데스크에 보관하여야 하며, 보관하지 않은 물품의 분실 · 멸실 · 훼손은 회원 본인이 책임을 집니다.</li>
<li>개인 사물함의 이용 기간이 만료된 후에도 남아있는 물품은 센터 측에서 회수 후 7일간 보관하며 이후에는 폐기합니다. 개인 사물함 비용은 10회당 1만 원이며, 환불 시 공제되지 않습니다.</li>
<li>회원의 안전과 원활한 센터 이용을 위해 본 약관과 운영규정을 위반하거나 전염병 · 풍기문란 · 사고 및 영업에 방해를 끼치는 모든 행위 등으로 질서 유지에 지장을 초래한 경우 회원의 권리를 제한 및 박탈합니다.</li>
<li>시설물 및 대여 물품에 대하여 고의 또는 부주의로 훼손 · 파괴했을 경우 당사자가 책임을 집니다.</li>
<li>센터 운영상 필요에 따라(퇴사, 인사이동) 담당 트레이너는 변경될 수 있으며, 담당 트레이너 변경은 계약 해지 또는 환불 사유에 해당하지 않습니다. 본인은 담당 트레이너 변경이 환불 사유가 되지 않음을 충분히 이해하였으며, 이에 대해 어떠한 이의도 제기하지 않을 것을 확인합니다.</li>
<li>무료로 제공되는 짐 이용권은 센터 정기 휴무일, 임시 휴무일, 법정 공휴일과 관계없이 이용 기간은 연속적으로 차감되며, 개인 사정으로 인한 미사용에 대해서 별도의 보상이나 휴회, 홀딩, 기간 연장이 불가능합니다.</li>
</ol>

<h3>3. 환불 및 양도</h3>
<ul>
<li>원칙상 환불은 불가하나 불가피한 사유가 발생한 경우 증빙 서류 제출 및 센터 승인을 통해 소비자 피해 보상 규정에 따라 환불 처리됩니다.</li>
<li><b>환불 공제금액</b>: 결제금액 − 위약금 10% − 카드 수수료 5% − (1회 정상가 × 기제공 레슨(유·무료 포함))</li>
<li>양도는 유효기간 내에 1회만 가능하며 양도수수료는 5만 원이 발생됩니다. (단, 1회 양도 이후 환불 / 재양도 / 휴회 적용 불가)</li>
<li>본 센터에서는 양도를 주선하거나 소개하지 않습니다.</li>
</ul>

<h3>4. 개인정보 처리</h3>
<p>수집 항목: 이름 · 휴대폰 · 생년월일 · 주소 · 결제정보 / 이용 목적: 회원관리 · 서비스 제공 · 예약 처리 / 보유 기간: 회원 자격 유지기간 및 관계법령 보존기간.</p>

<p style="color:#666;font-size:12px">본 약관 시행일: 2026년 6월 22일 (서초 2호점)</p>
$tpl$,
$ag$[
{"key":"terms","label":"위 PT 이용 약관 전문(운영시간·회원 준수사항 포함)에 동의합니다.","required":true,"group":"core"},
{"key":"refund","label":"환불 및 양도 규정(위약금 10%, 카드수수료 5%, 1회 정상가 × 기제공 레슨 공제 등)을 충분히 이해하였으며 이에 동의합니다.","required":true,"group":"core"},
{"key":"privacy","label":"서비스 제공·회원관리를 위한 개인정보(이름·연락처·생년월일·주소) 수집·이용에 동의합니다.","required":true,"group":"privacy"},
{"key":"privacy_third","label":"결제대행사·세무신고 등 법정 의무 이행을 위한 최소 정보의 제3자 제공에 동의합니다.","required":true,"group":"privacy"},
{"key":"health","label":"본인의 건강상태에 대해 사실대로 고지하였음을 확인합니다.","required":true,"group":"sensitive"},
{"key":"marketing","label":"(선택) 마케팅 및 이벤트 정보 수신에 동의합니다.","required":false,"group":"marketing"}
]$ag$::jsonb,
$pj$ {
  "items":["이름","휴대폰","생년월일","주소","결제정보"],
  "purpose":"회원관리·서비스 제공·예약 처리",
  "retention":"회원자격 유지기간 및 관계법령 보존기간(전자상거래법 5년 등)",
  "third_party":["결제대행사","세무신고 대행"]
} $pj$::jsonb,
$rp$ {
  "penalty_pct":10,
  "card_fee_pct":5,
  "deductions":["1회 정상가 × 기제공 레슨(유·무료 포함)","사은품 및 서비스 가액"]
} $rp$::jsonb)
on conflict (contract_type, version) do update set
  branch             = excluded.branch,
  title              = excluded.title,
  body_html          = excluded.body_html,
  agreements_json    = excluded.agreements_json,
  privacy_json       = excluded.privacy_json,
  refund_policy_json = excluded.refund_policy_json,
  is_active          = true;

-- (3) 골프 단독 — combo 본문 재사용, 동의항목만 골프 위주
insert into public.contract_templates (contract_type, version, title, body_html, agreements_json, privacy_json, refund_policy_json)
values ('golf', '2026-06-10', '내셔널짐 골프 레슨 및 이용권 계약서',
(select body_html from public.contract_templates where contract_type='combo' and version='2026-06-10'),
$ag$[
{"key":"terms","label":"위 골프 레슨 및 이용권 약관 전문에 동의합니다.","required":true,"group":"core"},
{"key":"refund","label":"환불 및 양도 규정(위약금 10%, 카드수수료 5%, 타석 1회 35,000원 일할 공제 등)을 충분히 이해하였으며 이에 동의합니다.","required":true,"group":"core"},
{"key":"privacy","label":"서비스 제공·회원관리를 위한 개인정보(이름·연락처·생년월일·주소) 수집·이용에 동의합니다.","required":true,"group":"privacy"},
{"key":"privacy_third","label":"결제대행사·세무신고 등 법정 의무 이행을 위한 최소 정보의 제3자 제공에 동의합니다.","required":true,"group":"privacy"},
{"key":"single_use","label":"골프 타석은 회원 1인 단독 이용이 원칙임을 확인합니다.","required":true,"group":"facility"},
{"key":"locker","label":"골프 사물함 이용료(상단 2만원/하단 3만원) 및 보관·폐기 규정을 확인하였습니다.","required":true,"group":"facility"},
{"key":"marketing","label":"(선택) 마케팅·이벤트 정보 수신에 동의합니다.","required":false,"group":"marketing"}
]$ag$::jsonb,
$pj$ {
  "items":["이름","휴대폰","생년월일","주소","결제정보"],
  "purpose":"회원관리·서비스 제공·예약 처리",
  "retention":"회원자격 유지기간 및 관계법령 보존기간(전자상거래법 5년 등)",
  "third_party":["결제대행사","세무신고 대행"]
} $pj$::jsonb,
$rp$ {
  "penalty_pct":10,
  "card_fee_pct":5,
  "deductions":["등록일부터 해지일까지 날짜 × 1회 이용료 35,000원","사은품 및 서비스 가액"]
} $rp$::jsonb)
on conflict (contract_type, version) do update set
  title              = excluded.title,
  body_html          = excluded.body_html,
  agreements_json    = excluded.agreements_json,
  privacy_json       = excluded.privacy_json,
  refund_policy_json = excluded.refund_policy_json;

-- 구버전 시드 비활성화 — 최신만 활성. 발송/서명된 계약은 template_id 로 시점 고정.
--   PT 공통(branch IS NULL): 2026-06-22 활성 (용산 1호점 + branch 미일치 시 fallback).
--   PT 서초 2호점 전용(branch='서초 2호점'): 2026-06-22-seocho 활성 — 운영시간만 07-22 로 다름.
update public.contract_templates set is_active = false
 where (contract_type, version) in (
   ('combo','2026-04-28'), ('pt','2025-07-25'), ('golf','2026-04-28'),
   ('combo','2026-05-19'), ('pt','2026-05-19'),  ('golf','2026-05-19'),
   ('pt','2026-06-10')
 );

-- ===========================================================================
-- 구 지점키 → 신 지점키 마이그레이션 (2026-06-22 지점명 변경 반영)
--   branch 는 immutable 트리거 차단 대상이 아니므로 서명완료 계약도 안전하게 갱신.
--   idempotent: 재실행 시 매칭 0건. 지점별 RLS 가 구키 계약을 놓치지 않도록 필수.
-- ===========================================================================
update public.contracts set branch = '용산 1호점'      where branch = '용산점';
update public.contracts set branch = '서초 2호점'      where branch = '서초점';
update public.contracts set branch = '피티앤골프 3호점' where branch = '골프스튜디오';

-- ===========================================================================
-- 직원 지점 권한 — 계정 생성(대시보드) 후 이 블록을 SQL Editor 에서 1회 실행.
--   app_metadata 는 service_role·SQL 로만 수정 가능. 변경 후 해당 직원 "재로그인" 필요
--   (JWT 는 로그인 시점에 발급되므로 기존 세션엔 즉시 반영 안 됨).
--   계정 이메일(로그인 ID): ceo / yongsan / seocho / ptgolf @nationalgym.kr
--   ※ 비밀번호는 보안상 이 파일(git)에 두지 않음 — 대표가 대시보드에서 설정·관리.
--   권한 회수/변경도 같은 방식으로 raw_app_meta_data 를 덮어쓰면 됨.
-- ---------------------------------------------------------------------------
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb
  where email = 'ceo@nationalgym.kr';
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"branches":["용산 1호점"]}'::jsonb
  where email = 'yongsan@nationalgym.kr';
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"branches":["서초 2호점"]}'::jsonb
  where email = 'seocho@nationalgym.kr';
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"branches":["피티앤골프 3호점"]}'::jsonb
  where email = 'ptgolf@nationalgym.kr';
-- 확인: select email, raw_app_meta_data from auth.users order by created_at;

-- ===========================================================================
-- 끝
-- 적용 후 Authentication > Users 메뉴에서 직원 계정을 추가하고,
-- 위 "직원 지점 권한" 섹션으로 각 계정에 지점(또는 admin)을 부여하세요.
-- ===========================================================================
