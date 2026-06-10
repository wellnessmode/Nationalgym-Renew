# CLAUDE.md — 내셔널짐 전자계약서 (Nationalgym-Renew)

> **작업 시작 전 `.claude/lessons/` 의 레슨 파일들을 먼저 읽을 것.**
> 사용자 교정 사항과 검증된 작업 방식이 파일별로 기록되어 있다 (한 파일 = 한 레슨, 첫 줄 = 요약).

## 프로젝트 개요

내셔널짐 전자계약서 시스템 **v2 Enterprise**. PT/골프 회원 재계약 시 약관 변경 고지 누락·서명 누락 문제 해결.
손글씨 서명 없이 **본인확인 + 체크박스 동의**로 계약 체결 (전자서명법 §3, 2020 개정 근거).
원래 `wellnessmode/Golf_PT_collabo` 레포의 `contract/` 폴더에서 시작해 법적 시스템 분리를 위해 별도 레포로 이관됨.

## 기술 스택 / 배포

- 프론트: 정적 HTML/CSS/JS (CDN만, 빌드 없음)
- 백엔드: Supabase `fcawftihhpccsqvawbxi.supabase.co` — **전자계약 전용 프로젝트. Golf_PT_collabo 와 절대 공유 금지** (스키마에 members 테이블 감지 가드 있음)
- 배포: GitHub Pages — **main 에 push 하면 자동 배포** (30~60초, `.github/workflows/static.yml`)
- 운영 URL: https://wellnessmode.github.io/Nationalgym-Renew/
- 브랜치: `claude/migrate-code-session-hZAwm` 에서 작업 → main 으로 ff-merge (사용자가 위임함, → lessons/git-deploy-workflow.md)

## 페이지

| 경로 | 용도 |
|---|---|
| `admin.html` | 직원: 계약 발송 (Supabase Auth 로그인) |
| `list.html` | 직원: KPI 대시보드·검색·CSV |
| `sign.html?t=토큰` | 회원: 5단계 wizard (안내→본인확인→약관→동의→완료) |
| `view.html?id=..&t=..` | 완료본 + PDF + Certificate of Completion + QR |
| `manual.html` | 직원 운영 매뉴얼 (인쇄 가능) |
| `demo.html` | 미팅 시연용 (백엔드 연결 없음, mock) |
| `docs/` | 운영매뉴얼.md · 도입기획서.md · 회원안내문.html(A4 게시용) |

## 회원 플로우 핵심 동작

- **본인확인**: 이름 + 생년월일 + 휴대폰 끝 4자리 일치. 5회 실패 → 5분 잠금. **admin 발송 시 생년월일 필수** (누락하면 회원이 진행 불가 — 가장 흔한 운영 실수)
- **약관**: 끝까지 스크롤해야 동의 단계 진입 (100% strict, 8px 모바일 보정만 허용. 90% 아님)
- **동의**: PIPA 5그룹 분리 (core / privacy / sensitive / facility / marketing)
- **제출(submit_consent RPC)**: 서버측에서 template 재조회해 스냅샷 재구성 + `extensions.digest()` SHA-256 content_hash + `request_ip()` 자동 IP + 핑거프린트 해시 저장. 완료 후 immutable 트리거가 핵심 필드 변경 차단, audit_log는 append-only

## 사업자 구조 (지점마다 별도 사업자등록증 — 계약서에 해당 지점 정보 필수)

| 지점 키 | 상호 | 사업자등록번호 |
|---|---|---|
| `용산점` | 내셔널짐 PT 용산점 | 188-62-00405 |
| `서초점` | 내셔널짐 PT 서초점 | 598-67-00456 |
| `골프스튜디오` | 내셔널짐 피티앤골프 스튜디오 | 297-09-02814 |

대표자 3개 모두 최현승. `config.js` 의 `BUSINESS_BY_BRANCH` 키 ↔ `BRANCHES` 배열 값 일치 필수. config.js 는 git 포함 (anon key 는 RLS 보호, 사업자 정보는 계약서 인쇄 공개정보).

## 운영 상태 (2026-06-10 기준)

- 코드: 로컬 PostgreSQL 16단계 시뮬레이션 **전부 통과** (digest 수정, 무결성 트리거, rate-limit, 만료, idempotent 재실행 포함 — 절차는 lessons/verify-locally-yourself.md)
- DB: 대표가 초기 스키마는 실행 완료. **digest 수정본(`extensions.digest`) 재실행 여부 미확인** — 미실행 상태면 회원 제출 단계에서 "function digest does not exist" 재발. 재실행은 안전 (idempotent, 기존 계약·서명 보존 검증됨)
- 도입 단계: 직원 파일럿 → 본 도입 진행 중 (docs/도입기획서.md)

## 보류 항목 (외부 서비스 필요)

- 카카오 알림톡 자동화 (Edge Function `send-alimtalk`, 솔루션 계약 필요)
- SMS OTP 2차 인증 (CoolSMS/NHN, 건당 ~9원)
- RFC 3161 공인 타임스탬프 (KISA TSA)
- `config.js` SIGN_BASE_URL 명시 (현재 빈 문자열 — location 기반 fallback 으로 동작 중이라 필수 아님)

## 관련 레포

- `wellnessmode/Golf_PT_collabo` — 골프PT 본 앱. 코드·Supabase 프로젝트 완전 분리.
