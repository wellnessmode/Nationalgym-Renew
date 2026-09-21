# 사용자 작업 스타일: 한국어로, 묻지 말고 끝까지 실행·배포, 결과는 URL로

## 확정된 선호 (이 사용자와의 세션에서 직접 확인됨)

- **응답 언어: 한국어.** 기술 식별자만 영어.
- **자율 진행.** "내가 말하지 않아도 진행해, 나는 응답 못해" — 질문(AskUserQuestion)으로 멈추면 작업이 막힘. 선택지가 갈리면 추천안으로 진행하고 결과에 근거와 함께 보고. (실제로 AskUserQuestion을 한 번 닫아버린 이력 있음.)
- **완성 = 배포.** 코드만 고치고 끝내지 말고 커밋→푸시→main 머지→배포 URL 전달까지가 한 단위.
- **병렬 선호.** 리서치·감사는 서브에이전트 백그라운드로 돌리고 본 작업 계속.
- 산출물 전달은 **URL 중심** (사용자가 직원·회원에게 그대로 전달함). 파일 경로보다 운영 URL.
- **외부 서비스·콘솔·페이지를 언급할 땐 이름만 말하지 말고 주소창에 바로 붙여넣을 수 있는 전체 URL을 항상 제시** (2026-06-22 명시 요청, "여러 코드를 동시에 하니까"). 예: Supabase SQL Editor → `https://supabase.com/dashboard/project/fcawftihhpccsqvawbxi/sql/new`. 주요 URL은 아래 표 참조.

## 자주 쓰는 URL (이름 대신 이 전체 주소로 전달)

| 대상 | URL |
|---|---|
| Supabase SQL Editor | https://supabase.com/dashboard/project/fcawftihhpccsqvawbxi/sql/new |
| Supabase 대시보드(홈) | https://supabase.com/dashboard/project/fcawftihhpccsqvawbxi |
| 운영 사이트(GitHub Pages) | https://wellnessmode.github.io/Nationalgym-Renew/ |
| admin(직원 발송) | https://wellnessmode.github.io/Nationalgym-Renew/admin.html |
| list(KPI·검색·백업) | https://wellnessmode.github.io/Nationalgym-Renew/list.html |
| GitHub 레포 | https://github.com/wellnessmode/nationalgym-renew |
- 사용자 = 대표. 비개발자에 가깝지만 Supabase 콘솔에서 SQL 실행·계정 생성 정도는 직접 수행함. 그 이상의 기술 작업은 기대하지 말 것.

## ⚠️ 계정 두 개 — 항상 헷갈려함 (2026-09-21 명시 교정, 절대 섞지 말 것)

완전히 다른 시스템의 로그인이다. 사용자가 반복해서 헷갈리므로 매번 먼저 구분해서 답할 것.

| 계정 | 용도 | 비고 |
|---|---|---|
| **`project.renew@nationalgym.kr`** | **Supabase 콘솔(대시보드) 로그인.** SQL Editor·프로젝트 설정 접근용 | 스크린샷 상단에 "project.renew@nationalgym.kr's Org" 로 확인됨. 로그인 수단(GitHub/구글/이메일)은 화면을 볼 수 없어 불명 |
| `ceo@nationalgym.kr` | **앱 내부 로그인** (admin.html/list.html). `auth.users` 의 `role:admin` — 전 지점 열람 | 콘솔과 무관, 오직 전자계약 웹앱용. 세션 컨텍스트의 userEmail 도 이 주소(claude.ai 계정 이메일 — 이것도 또 다른 별개 식별자) |
| `yongsan@` / `seocho@` / `ptgolf@nationalgym.kr` | 앱 내부 로그인, 지점별(`branches:[...]`) | 마찬가지로 콘솔과 무관 |

- Supabase **콘솔** 얘기(SQL 실행 주체, 프로젝트 소유자)가 나오면 → `project.renew@nationalgym.kr`
- 전자계약 **웹앱** 로그인(계약 발송·조회 화면) 얘기가 나오면 → `ceo@`/`yongsan@`/`seocho@`/`ptgolf@nationalgym.kr`

## 주의

- 직원·회원 대상 자료의 난이도는 staff-communication.md 참조.
- 약관 문구 관련은 legal-text-verbatim.md 참조.
