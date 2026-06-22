# 지점별 약관: contract_templates.branch 컬럼으로 분기 (NULL=공통, 값=지점 전용)

## 배경 (2026-06-22)

지점마다 운영 방식이 달라 약관도 부분 상이 (예: 서초점 PT 는 운영시간 명시·홀딩 없음·짐 이용권 표현). contract_type 만으로는 한 약관을 모든 지점이 공유해야 해서 분기 불가능했음.

## 구조

- `contract_templates.branch text` 컬럼: NULL 이면 공통(default), 값이 있으면 해당 지점 전용
- `unique (contract_type, version)` 유지 — 지점별 약관은 version 에 접미사 (예: `2026-06-22-seocho`)
- 인덱스: `templates_type_branch_idx (contract_type, branch, is_active)`

## admin.js 선택 로직

```js
sb.from('contract_templates')
  .eq('contract_type', type).eq('is_active', true)
  .or('branch.eq.' + branch + ',branch.is.null')
  .order('branch', { ascending: false, nullsFirst: false })  // non-null 먼저
  .order('effective_from', { ascending: false }).limit(1)
```

지점 일치 약관이 있으면 그것, 없으면 공통(branch IS NULL) 약관으로 자동 fallback. UI 에는 `[지점명 전용]` 또는 `[공통]` 배지 노출.

## 새 지점 전용 약관 추가 절차

1. supabase_schema.sql 에 INSERT 추가 (`branch = '지점명'`, version 에 식별 접미사)
2. ON CONFLICT DO UPDATE 로 idempotent 하게
3. 대표가 SQL Editor 에서 재실행 — 기존 계약/서명에는 영향 없음 (template_id 시점 고정)

## 주의

- BUSINESS_BY_BRANCH 키 ↔ contract_templates.branch 값 일치 필수
- 매니저가 "1호점" 같은 비공식 호칭으로 요청할 수 있음 — config.js `BRANCHES` 와 매칭 확인 필요
