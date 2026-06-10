# 직원 전달물에는 기술 용어 금지 — URL과 클릭 절차만, Supabase/SQL/HTML 작업은 대표 전용

## 배경 (2026-06, 도입 준비 중 사용자 교정)

직원용 안내에 "Supabase SQL Editor에서 스키마 실행" 같은 내용을 포함했다가 교정받음:
> "직원들은 코딩 이런거 하나도 모르니까 수파베이스 뭐 html 이런거 쓰지말고 주소창만 줘"

## 규칙

- 직원에게 주는 산출물 = **주소창에 입력할 URL + 화면에 보이는 버튼 이름 + 순서** 만.
- Supabase 콘솔 작업(스키마 실행, Authentication 계정 발급)은 **대표(ceo@nationalgym.kr) 전용** 섹션으로 분리해서 안내.
- 직원에게 실패 시나리오 테스트를 시키지 말 것. 검증은 Claude가 직접 (→ verify-locally-yourself.md).
- 직원이 외울 URL은 하나면 충분: `https://wellnessmode.github.io/Nationalgym-Renew/` (나머지는 화면 버튼으로 이동).
