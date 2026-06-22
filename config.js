// 내셔널짐 전자계약서 — 실제 환경 설정
// ⚠️ SUPABASE_URL 은 전자계약서 전용 Supabase 프로젝트 (기존 골프PT콜라보와 별도)
window.NG_CONTRACT_CONFIG = {
  SUPABASE_URL: 'https://fcawftihhpccsqvawbxi.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYXdmdGloaHBjY3NxdmF3YnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODU1MDcsImV4cCI6MjA5NDc2MTUwN30.FGog7EfGiSmSMf70bqtbYF0tal8nOrgOCgn1BdM9aR8',

  BRAND_NAME: '내셔널짐',

  // 지점별 사업자 정보 (각 지점이 별도 사업자등록증)
  BUSINESS_BY_BRANCH: {
    '용산 1호점': {
      name: '내셔널짐 PT 용산점',
      owner: '최현승',
      registration_no: '188-62-00405',
      address: '서울특별시 용산구 백범로 341, A동 302호(원효로1가, 리첸시아 용산)',
      phone: '010-9760-0096'
    },
    '서초 2호점': {
      name: '내셔널짐 PT 서초점',
      owner: '최현승',
      registration_no: '598-67-00456',
      address: '서울특별시 서초구 사임당로 143, 4층 407,408호(서초동, Cross 143)',
      phone: '010-9783-0096'
    },
    '피티앤골프 3호점': {
      name: '내셔널짐 피티앤골프 스튜디오',
      owner: '최현승',
      registration_no: '297-09-02814',
      address: '서울특별시 용산구 백범로 341, A동 지1층 115,116,117,118호(원효로1가, 리첸시아 용산)',
      phone: '010-9781-0096'
    }
  },

  BRANCHES: ['용산 1호점', '서초 2호점', '피티앤골프 3호점'],

  // 약관 종류 라벨 (contract_type → 표시명)
  CONTRACT_TYPE_LABELS: { pt: 'PT 단독', golf: '골프 단독', combo: 'PT + 골프 통합' },

  // 지점별 발송 가능한 약관 종류. 용산·서초 = PT 단독만, 3호점(피티앤골프) = PT·골프·통합 전부.
  // admin.js 가 지점 선택 시 '약관 종류' 드롭다운을 이 목록으로 제한 (배열 첫 항목이 기본 선택).
  CONTRACT_TYPES_BY_BRANCH: {
    '용산 1호점': ['pt'],
    '서초 2호점': ['pt'],
    '피티앤골프 3호점': ['pt', 'golf', 'combo']
  },

  // 관리자 발송 화면의 상품 드롭다운 목록 (qty 는 선택 시 자동 입력, 수정 가능)
  // 목록에 없는 상품은 드롭다운의 '직접 입력' 으로 추가
  PRODUCTS: [
    { name: 'PT 10회',            qty: '10회 / 2개월' },
    { name: 'PT 20회',            qty: '20회 / 3개월' },
    { name: 'PT 30회',            qty: '30회 / 4개월' },
    { name: '골프 25분 레슨 8회',  qty: '8회 / 2개월' },
    { name: '골프 25분 레슨 20회', qty: '20회 / 4개월' },
    { name: '골프 25분 레슨 30회', qty: '30회 / 4개월' },
    { name: '골프 50분 레슨 8회',  qty: '8회 / 2개월' },
    { name: '골프 50분 레슨 20회', qty: '20회 / 4개월' },
    { name: '골프 50분 레슨 30회', qty: '30회 / 4개월' },
    { name: '골프 타석 1개월',     qty: '1개월' },
    { name: '골프 타석 3개월',     qty: '3개월' },
    { name: '골프 타석 6개월',     qty: '6개월' },
    { name: '사물함',              qty: '' }
  ],

  // 서명 페이지 절대 URL — GitHub Pages 배포 후 실제 URL로 교체
  SIGN_BASE_URL: ''
};
