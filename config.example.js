// 내셔널짐 전자계약서 — 환경 설정 샘플
// 사용법:
//   1) 이 파일을 같은 폴더에 'config.js'로 복사
//   2) 아래 값을 실제 값으로 채워 저장
//   3) config.js 는 운영 정책에 따라 git 에 올릴지 결정
//      (anon key 는 공개돼도 안전하고 사업자 정보는 계약서에 어차피 인쇄됨)
//
// ⚠️ SUPABASE_URL 은 반드시 "전자계약서 전용 신규 프로젝트"의 URL 을 입력하세요.
//     기존 골프PT콜라보 프로젝트와 절대 같은 URL 을 쓰지 마세요.
window.NG_CONTRACT_CONFIG = {
  // 전자계약서 전용 신규 Supabase 프로젝트 (예: nationalgym-contract)
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',

  // 브랜드명 (지점 공통)
  BRAND_NAME: '내셔널짐',

  // 지점별 사업자(개인사업자) 정보
  //   - 키는 BRANCHES 배열의 값과 일치해야 함
  //   - 각 지점이 별도 사업자등록증을 가진 경우 지점별로 작성
  //   - 단일 사업자인 경우 모든 지점에 동일 값 입력
  BUSINESS_BY_BRANCH: {
    '용산 1호점': {
      name: '내셔널짐 PT 용산점',
      owner: '대표자명',
      registration_no: '000-00-00000',
      address: '서울특별시 ...',
      phone: '010-0000-0000'
    },
    '서초 2호점': {
      name: '내셔널짐 PT 서초점',
      owner: '대표자명',
      registration_no: '000-00-00000',
      address: '서울특별시 ...',
      phone: '010-0000-0000'
    }
  },

  // 지점 목록 (관리자 발송 화면에서 선택). BUSINESS_BY_BRANCH 의 키와 일치해야 함.
  BRANCHES: ['용산 1호점', '서초 2호점'],

  // 관리자 발송 화면 상품 드롭다운 (선택). 비우면 '직접 입력' 만 표시됨.
  // qty 는 상품 선택 시 자동으로 채워지는 횟수/기간 (이후 수정 가능)
  // cat: 'pt'/'golf'/'etc' — admin.js 가 지점별로 필터 (PT 전용 지점은 pt 만 노출)
  PRODUCTS: [
    { name: 'PT 10회', qty: '10회 / 1년', cat: 'pt' },
    { name: 'PT 20회', qty: '20회 / 1년', cat: 'pt' },
    { name: 'PT 30회', qty: '30회 / 1년', cat: 'pt' },
    { name: 'PT 50회', qty: '50회 / 1년', cat: 'pt' }
  ],

  // 서명 페이지 절대 URL (배포 후 채움)
  // 카카오톡 메시지에 들어갈 링크의 베이스
  SIGN_BASE_URL: 'https://YOUR-DOMAIN/contract/sign.html'
};
