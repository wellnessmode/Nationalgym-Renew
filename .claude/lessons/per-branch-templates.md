# 지점별 약관: contract_templates.branch 컬럼으로 분기 (NULL=공통, 값=지점 전용)

## 배경 (2026-06-22)

지점마다 운영 방식이 다를 수 있어 약관도 부분 상이 가능 (예: 운영시간이 지점별로 다른 경우). contract_type 만으로는 한 약관을 모든 지점이 공유해야 해서 분기 불가능했음. 이를 위한 인프라로 `branch` 컬럼을 도입.

## 현재 운영 상태 — 전 지점 공통 약관

- **용산점(1호점) = 서초점(2호점) PT 약관 동일** → 공통 템플릿 1개 (`branch IS NULL`, version `2026-06-22`)
- 골프스튜디오(3호점)는 PT 미운영, golf/combo 약관도 공통
- 즉, 현재 branch별 시드는 0개. 인프라만 준비된 상태

## ⚠️ contract_type 간 스코프는 독립 — PT 변경을 combo/golf 로 전파 금지 (2026-06-22 사용자 명시)

- PT 단독(`pt`) 신약관 v2026-06-22(운영시간·유효기간 첫 레슨일 1년·환불공제)는 **용산·서초의 PT 단독에만** 적용.
- **`combo`(PT+골프 통합)·`golf` = 3호점 피티앤골프 약관**으로, v2026-06-10 의 자체 조건(개월별 유효기간 표 + 홀딩) 유지. **변경 대상 아님.**
- combo 본문에 PT 성격 조항이 있더라도 **PT 단독 변경을 combo/golf 로 옮기거나 일원화하지 말 것.** 사용자 명시: "이번에 바꾼건 서초·용산만, 3호점 약관은 냅두는거야, 모두 통합하지말고." (2026-06-22)
- 약관 변경 요청을 받으면 **어느 contract_type(pt/combo/golf)에 한정되는지부터 확정.** PT 변경이라고 combo/golf 까지 손대면 3호점 계약 조건이 의도치 않게 바뀜.

## 흔한 함정

매니저가 "서초점 약관 바꿔주세요"라고 docx를 보낼 때, 두 가지 가능성을 반드시 확인:
1. **서초점만 다르다** → 지점 전용 시드 (`branch='서초점'`, version에 접미사) — 드뭄
2. **두 지점 다 바뀐다, 단지 서초점 매니저가 보낸 것뿐** → 공통 약관 자체를 교체 — 흔함

ceo@nationalgym.kr 확인 없이 1번으로 가정하면 용산점 약관이 구버전으로 방치된다. 2026-06-22 작업 시 처음에 1번으로 잘못 만들었다가 사용자 정정으로 2번으로 되돌린 사례 있음. **기본 가정은 2번**.

## 구조

- `contract_templates.branch text` 컬럼: NULL 이면 공통(default), 값이 있으면 해당 지점 전용
- `unique (contract_type, version)` 유지 — 지점별 약관은 version 에 접미사 (예: `2026-08-01-yongsan`)
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

## 새 지점 전용 약관 추가 절차 (지점 약관이 실제로 갈릴 때)

1. supabase_schema.sql 에 INSERT 추가 (`branch = '지점명'`, version 에 식별 접미사)
2. ON CONFLICT DO UPDATE 로 idempotent 하게
3. 대표가 SQL Editor 에서 재실행 — 기존 계약/서명에는 영향 없음 (template_id 시점 고정)

## 주의

- BUSINESS_BY_BRANCH 키 ↔ contract_templates.branch 값 일치 필수
- 매니저가 "1호점" 같은 비공식 호칭으로 요청할 수 있음 — config.js `BRANCHES` 와 매칭 확인 필요 (1호=용산, 2호=서초, 3호=골프스튜디오)
