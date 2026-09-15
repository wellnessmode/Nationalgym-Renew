# view.html PDF 40MB 문제: PNG 통짜 재삽입 → JPEG 페이지분할로 ~33배 감소

## 증상 (2026-06-27, 대표 보고)
재등록 계약서 조회기간 만료 후 데스크 재발급 시 view.html 다운로드 PDF 1파일당 **40MB**.

## 원인
`js/view.js` handlePdf 가 html2canvas 캔버스를 `toDataURL('image/png')` 로 만든 뒤,
**전체(다중페이지 높이) 이미지를 페이지 수만큼 offset 으로 통째 재삽입**했음.
jsPDF 2.5.1 은 PNG addImage 시 raw 비트맵으로 디코딩해 저장 → 장문 약관(5페이지) × 전체이미지 반복 = 40~53MB.
(원본 PNG dataURL 자체는 0.3MB 수준 — 문제는 jsPDF 저장 방식 + 페이지수만큼 반복)

## 수정
페이지 높이(`canvas.width * pageH / pageW`)만큼 원본 캔버스를 잘라
(`document.createElement('canvas')` + `drawImage`) **각 페이지에 JPEG(q=0.82) 1장씩만** 삽입 +
`new jsPDF({ compress: true })`. 아이폰/PC=`pdf.save`, 안드로이드=새탭 저장 분기는 그대로 유지.

## 검증 (브라우저 없이 로컬 Node 실측)
`@napi-rs/canvas` 로 1520×9200 합성 캔버스(계약서 유사: 한글 본문 밀도 + 서명 스트로크) 만들고
jsPDF(Node)로 옛/새 방식 `output('arraybuffer').byteLength` 실측:
- 옛방식(PNG 통짜): **53.35MB / 5p**
- 새방식(JPEG q0.82 분할): **1.60MB / 5p → 33배 감소** (q0.75=37배, q0.6=44배)

법적 문서 가독성 위해 q=0.82 유지. 스크립트 패턴: `scratchpad/pdf_size_test.js`
(`npm i @napi-rs/canvas jspdf@2.5.1` 후 createCanvas→toDataURL(png/jpeg)→jsPDF addImage 비교).

## 교훈
html2canvas+jsPDF 로 PDF 만들 땐 항상 **JPEG + 페이지별 슬라이스 + compress:true**.
PNG·전체이미지 재삽입은 용량 폭발. 이미지 삽입형 PDF 용량 의심 시 위 Node 실측으로 즉시 확인 가능.
