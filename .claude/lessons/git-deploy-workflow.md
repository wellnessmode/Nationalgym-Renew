# 배포 워크플로우: feature 브랜치 커밋 → main ff-merge → push가 곧 배포 (사용자 위임됨)

## 배경

main 머지에 대해 사용자가 "너가 해"로 직접 위임 (2026-06). 이후 매 변경마다 동일 패턴 사용 중.

## 패턴

```bash
# 항상 feature 브랜치에서 작업
git checkout claude/migrate-code-session-hZAwm
git add ... && git commit -m "..."
git push -u origin claude/migrate-code-session-hZAwm
# main 으로 fast-forward 머지 → GitHub Pages 자동 배포 (30~60초)
git checkout main && git merge --ff-only claude/migrate-code-session-hZAwm && git push origin main
git checkout claude/migrate-code-session-hZAwm   # 복귀
```

- PR 만들지 않음 (사용자가 요청한 적 없음).
- `.github/workflows/static.yml`이 main push 시 Pages 배포. actions 버전은 v4/v5로 최신 (Node 24 대응 완료).
- 커밋 메시지는 한국어 본문 + conventional prefix (feat/fix/docs/chore) 스타일 유지.
