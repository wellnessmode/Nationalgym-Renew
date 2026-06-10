# 내셔널짐 전자계약서 시스템 v2 (Enterprise)

PT · 골프 회원 **재계약 시 약관 변경 고지 누락** 및 동의 누락 문제를 해결하기 위한
정적 웹 + Supabase 기반 엔터프라이즈급 전자계약 시스템.

여러 지점에서 동일하게 사용할 수 있으며 (지점별 사업자 정보 자동 반영),
카카오톡으로 발송된 링크 하나로 회원이 **본인확인 → 약관 확인 → 동의** 3단계만으로
계약을 체결할 수 있습니다.

> 본 레포는 전자계약서 시스템 전용입니다.
> 골프PT 본 앱(`wellnessmode/Golf_PT_collabo`)과 코드·DB(Supabase 프로젝트) 모두 분리되어 있습니다.

## v2 Enterprise — 주요 변경점

- **체크박스 기반 동의** — 손글씨 서명 제거. 「전자서명법」(2020 개정) §3에 따른 체크박스 전자서명으로 동일한 법적 효력
- **본인확인 게이트** — 이름 + 생년월일 + 휴대폰 끝 4자리 일치 검증 후에만 동의 단계 진입
- **약관 끝까지 스크롤 강제** — 약관 맨 아래까지 확인해야 동의 버튼 활성화
- **다단계 wizard UI** — Welcome → 본인확인 → 약관 확인 → 동의 → 완료 (각 단계 진행 추적)
- **PIPA 분리 동의** — 약관 / 개인정보 수집·이용 / 제3자 제공 / 민감정보(건강) / 마케팅 5단계 분리
- **방문판매법 §31 중도해지권 안내** — 헬스장은 "계속거래"로 회원이 언제든 중도해지 가능 명시
- **표준약관 §10095 환불공식 노출** — 정상가 기준 일할 계산 + 위약금 10% 상한
- **무결성 강화** — SHA-256 content_hash · 자동 IP 수집(`inet_client_addr()`) · 디바이스 핑거프린트 해시 · server-side 스냅샷 재구성
- **감사 추적 강화** — 9가지 이벤트 (link_viewed / terms_scrolled / identity_verified / consent_checked / consented / pdf_viewed 등) 자동 기록
- **immutable 트리거** — 동의 완료 후 핵심 컨텐츠·서명 레코드·감사 로그 변경 차단
- **Certificate of Completion** — PDF에 무결성 해시 · 본인확인 시각 · IP · QR 검증 URL 자동 첨부
- **256bit 토큰** — `gen_random_bytes(32)` base64url (기존 128bit hex 대비 보안 강화)
- **관리자 대시보드** — 상태별 KPI 카드 + 검색·필터·기간·지점 + CSV 내보내기

## 구성

| 영역 | 사용 기술 |
|---|---|
| 프론트엔드 | 정적 HTML / CSS / JS (CDN) |
| 백엔드 | Supabase (PostgreSQL + Auth + RPC) |
| 동의 | 체크박스 (전자서명법 §3) |
| 무결성 | SHA-256 해시 + 서버 timestamp + IP + 디바이스 핑거프린트 |
| PDF | jsPDF + html2canvas + QRCode (클라이언트 생성) |
| 발송 | (MVP) 카카오톡 수동 복붙 → (다음) 알림톡 자동화 |

## 페이지

| 경로 | 용도 | 인증 |
|---|---|---|
| `index.html` | 진입 안내 | - |
| `admin.html` | 계약서 발송 | 관리자 (Supabase Auth) |
| `list.html` | 계약 대시보드 · 검색 · CSV | 관리자 |
| `sign.html?t=TOKEN` | 회원 본인확인 + 약관 확인 + 동의 | 토큰 |
| `view.html?id=ID&t=TOKEN` | 완료본 조회 + PDF + Certificate | 토큰 또는 관리자 |

## ⚠️ 중요: Supabase 프로젝트 분리

본 전자계약서 시스템은 **반드시 전용 신규 Supabase 프로젝트**에 적용해야 합니다.

- ❌ 기존 골프PT콜라보 프로젝트와 합치지 마세요
- ✅ 본 시스템 전용으로 신규 프로젝트를 하나 더 만드세요 (무료 티어로 충분)

`supabase_schema.sql` 에는 안전 가드가 들어 있어 기존 `members` 테이블이 있는 프로젝트에 잘못 실행하면 즉시 중단됩니다.

## 초기 셋업

### 1. 신규 Supabase 프로젝트 생성
1. https://supabase.com → **New project** (이름 예: `nationalgym-contract`)
2. **Project Settings → API** 에서 `Project URL` 과 `anon public key` 메모
3. **SQL Editor** 에서 [`supabase_schema.sql`](./supabase_schema.sql) 전체를 복사하여 실행
   - 실행 시 v2 약관 시드(`combo` / `pt` / `golf` 각 2026-05-19) 자동 입력
   - 기존 v1 시드는 자동으로 `is_active=false` 처리됨
4. **Authentication → Users → Add user** 로 관리자 계정 추가 (이메일 / 비밀번호)

### 2. 설정 파일 작성

```bash
cp config.example.js config.js
```

`config.js` 에 다음 값을 채워 주세요.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `BUSINESS_BY_BRANCH`: 지점별 사업자 정보 (지점마다 별도 사업자등록증인 경우 각각 입력)
- `BRANCHES`: 지점 키 배열
- `SIGN_BASE_URL`: 배포된 sign.html 의 절대 URL (빈 문자열 시 자동 추론)

### 3. 호스팅

- **GitHub Pages**: 자동 배포 (`.github/workflows/static.yml`)
  접속 URL: `https://wellnessmode.github.io/Nationalgym-Renew/`
- **Vercel / Netlify**: 정적 사이트로 폴더 단위 배포
- **로컬 테스트**: `python3 -m http.server 8080`

## 운영 플로우

```
[관리자]                                       [회원]
  1. admin.html 로그인
  2. 약관 종류 + 지점 선택
  3. 회원 정보 입력 (이름·전화·생년월일·항목·금액)
  4. "서명 링크 생성"
  5. 카카오톡 메시지 복사
  6. 회원에게 발송      ──────►  7. 링크 클릭 → Welcome
                                  8. 본인확인 (이름+생년월일+휴대폰끝4)
                                  9. 약관 확인 (끝까지 스크롤)
                                 10. 5개 그룹 동의 체크
                                 11. 제출 → 즉시 PDF 발급
 12. list.html '동의완료' ◄────  (자동 갱신)
 13. view.html 에서 PDF + 감사 로그
```

각 단계마다 server timestamp · IP · User-Agent · 디바이스 핑거프린트 해시가 자동 기록됩니다.

## 약관 버전 관리

약관 변경 시:
1. `contract_templates` 테이블에 새 version 행 INSERT
2. 기존 동일 contract_type 행은 `is_active=false` 로 변경

발송된 계약서는 발송 시점의 `template_id` 를 참조 → 이후 약관이 바뀌어도 추적 가능.
동의된 계약은 `contract_html_snapshot` 에 약관 전문이 박제 + `content_hash` 로 무결성 보장.

## 만료 처리 자동화

```sql
-- Supabase Cron 에 등록 (Database → Cron Jobs, 매시간)
select public.expire_old_contracts();
```

## 법적 준거

본 시스템은 다음 법령을 준수하도록 설계되었습니다:

| 법령 | 적용 |
|---|---|
| 「전자서명법」 §3 | 체크박스 전자서명의 법적 효력 |
| 「전자문서 및 전자거래 기본법」 §4 | 전자문서의 서면 동일 효력 |
| 「개인정보보호법」 §15, §22 | 분리 동의, 보유기간·목적·항목 명시 |
| 「전자상거래법」 §6 | 거래기록 5년, 분쟁기록 3년 보존 |
| 「방문판매법」 §31 | 계속거래 중도해지권 |
| 공정거래위원회 「체력단련장 이용 표준약관」 제10095호 | 위약금 10% 상한, 정상가 일할 환불 |
| 「소비자기본법」 §57 | 한국소비자원 분쟁조정 |

> 본 시스템은 일반 분쟁 대응 수준입니다. 100만원 이상 고액 또는 분쟁 빈도가 높은 경우
> 추가 본인확인(SMS OTP · PASS 인증) 및 RFC 3161 공인 타임스탬프(KISA TSA) 도입을 검토하세요.

## 디렉터리 구조

```
Nationalgym-Renew/
├── README.md
├── supabase_schema.sql        ─ DB 스키마 + RPC + immutable 트리거 + v2 시드
├── config.example.js          ─ 환경 설정 샘플
├── config.js                  ─ 실제 환경 설정 (배포 포함)
├── .gitignore
├── .github/workflows/static.yml ─ GitHub Pages 자동 배포
├── index.html
├── admin.html                 ─ 관리자 발송
├── list.html                  ─ 관리자 대시보드
├── sign.html                  ─ 회원 다단계 wizard
├── view.html                  ─ 완료본 + Certificate of Completion
├── css/style.css              ─ Design System v2
└── js/
    ├── supabase.js            ─ 공통 클라이언트
    ├── fingerprint.js         ─ 디바이스 핑거프린트 (SHA-256)
    ├── admin.js
    ├── list.js
    ├── sign.js                ─ 다단계 wizard + audit logging
    └── view.js                ─ PDF + QR + Certificate
```

## 추후 강화 (선택)

- **카카오 알림톡 자동화**: Supabase Edge Function `send-alimtalk` + 알림톡 솔루션 (알리고/NHN 비즈메시지/솔라피)
- **SMS OTP 2차 인증**: 본인확인 후 SMS 6자리 OTP 추가 (건당 약 9원)
- **RFC 3161 공인 타임스탬프**: KISA 인증 TSA 연동 (분쟁 시 증거력 최상위)
- **PASS / 카카오 본인인증**: CI/DI 수령으로 동일인 증명
- **PDF/A-3 + PAdES**: 서버 사이드 디지털 서명 (행정/공공 입찰용)
- **회원 보관함**: 본인확인 후 본인의 모든 계약서 열람·다운로드
- **약관 diff 뷰**: 약관 버전 간 변경 사항 시각화
- **자동 만료 알림**: D-3 / D-1 카카오톡 자동 알림
