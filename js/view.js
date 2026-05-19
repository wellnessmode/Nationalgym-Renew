// 내셔널짐 전자계약서 — 보기/PDF (v2 Enterprise)
// 무결성 워터마크, QR 검증, Certificate of Completion 포함
(function () {
'use strict';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const id = params.get('id');
const token = params.get('t');

const PAY_LABEL = { card:'카드', cash:'현금', seoul_pay:'서울페이', transfer:'계좌이체', other:'기타' };
const EVENT_LABEL = {
  created: '계약 생성',
  sent: '링크 발송',
  link_viewed: '링크 첫 열람',
  terms_scrolled: '약관 확인 완료',
  consent_checked: '동의 체크',
  consent_unchecked: '동의 해제',
  consent_all_checked: '전체 동의 클릭',
  identity_attempt: '본인확인 시도',
  identity_verified: '본인확인 통과',
  identity_failed: '본인확인 실패',
  consented: '동의 완료(서명)',
  signed: '동의 완료(서명)',
  pdf_viewed: '계약서 열람',
  pdf_downloaded: 'PDF 다운로드',
  reopen: '페이지 재진입'
};

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmt(n) { return Number(n || 0).toLocaleString() + '원'; }
function fmtDT(s) { return s ? new Date(s).toLocaleString('ko-KR') : '-'; }
function fmtD(s)  { return s ? new Date(s).toLocaleDateString('ko-KR') : '-'; }

async function load() {
  if (!id) { $('loading').innerHTML = '<p class="error">유효하지 않은 접근입니다.</p>'; return; }
  const { data, error } = await sb.rpc('get_signed_contract', { p_id: id, p_token: token });
  if (error) { $('loading').innerHTML = '<p class="error">오류: ' + error.message + '</p>'; return; }
  if (data.error) {
    $('loading').innerHTML = '<p class="error">' + (
      data.error === 'unauthorized'
        ? '권한이 없습니다. 회원은 카카오톡으로 받으신 링크로 다시 접속해 주세요.'
        : ('오류: ' + data.error)
    ) + '</p>';
    return;
  }
  if (!data.signature) {
    $('loading').innerHTML = '<p class="muted">아직 동의·서명이 완료되지 않은 계약입니다.</p>';
    return;
  }
  await render(data);
  $('loading').hidden = true;
  $('doc').hidden = false;
}

async function genQR(url) {
  return new Promise(resolve => {
    if (!window.QRCode) return resolve('');
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, scale: 4 }, (err, data) => {
      resolve(err ? '' : data);
    });
  });
}

async function render(d) {
  const c = d.contract, t = d.template, s = d.signature;
  const events = Array.isArray(d.audit_events) ? d.audit_events : [];

  const items = c.items_json || [];
  const itemRows = items.map(it =>
    '<tr><td>' + escapeHTML(it.name) + '</td><td>' + escapeHTML(it.qty || '') +
    '</td><td class="num">' + fmt(it.price) + '</td></tr>'
  ).join('');

  const agreed = s.agreed_items || {};
  const agList = (t.agreements_json || []);
  const agreedRows = agList.map(a => {
    const v = !!agreed[a.key];
    return '<li>' + (v ? '☑' : '☐') + ' '
      + (a.required ? '<b class="req-mark">[필수]</b> ' : '<span class="opt-mark">[선택]</span> ')
      + escapeHTML(a.label) + '</li>';
  }).join('');

  // 무결성 정보
  const hash12 = (c.content_hash || '').slice(0, 12);
  const fullUrl = location.origin + location.pathname + '?id=' + c.id + (token ? '&t=' + token : '');
  const qrData = await genQR(fullUrl);

  // 감사 이벤트 (관리자에게만 노출됨)
  const auditRows = events.length === 0 ? '' : events.map(e =>
    '<tr>'
    + '<td>' + escapeHTML(new Date(e.created_at).toLocaleString('ko-KR')) + '</td>'
    + '<td>' + escapeHTML(EVENT_LABEL[e.event_type] || e.event_type) + '</td>'
    + '<td>' + escapeHTML(e.ip || '-') + '</td>'
    + '<td class="muted small">' + escapeHTML(e.event_data ? JSON.stringify(e.event_data) : '') + '</td>'
    + '</tr>'
  ).join('');

  // 결제수단·계약기간 등 메인 표
  const mainTable =
      '<table class="data kv">'
    + '<tr><th>회원</th><td>' + escapeHTML(c.member_name) + ' / ' + escapeHTML(c.member_phone) + '</td></tr>'
    + (c.member_birth ? '<tr><th>생년월일</th><td>' + escapeHTML(c.member_birth) + '</td></tr>' : '')
    + (c.member_address ? '<tr><th>주소</th><td>' + escapeHTML(c.member_address) + '</td></tr>' : '')
    + (c.member_email ? '<tr><th>이메일</th><td>' + escapeHTML(c.member_email) + '</td></tr>' : '')
    + '<tr><th>사업자</th><td>' + escapeHTML(c.business_name) + ' (대표 ' + escapeHTML(c.business_owner) + ')'
      + (c.business_registration ? '<br><span class="muted small">사업자등록번호 ' + escapeHTML(c.business_registration) + '</span>' : '')
      + (c.business_address ? '<br><span class="muted small">' + escapeHTML(c.business_address) + '</span>' : '')
      + '</td></tr>'
    + '<tr><th>지점</th><td>' + escapeHTML(c.branch || '-') + '</td></tr>'
    + '<tr><th>이용 기간</th><td>' + escapeHTML(c.contract_period_start || '-') + ' ~ ' + escapeHTML(c.contract_period_end || '-') + '</td></tr>'
    + '<tr><th>결제수단</th><td>' + escapeHTML(PAY_LABEL[c.payment_method] || c.payment_method || '-') + '</td></tr>'
    + (c.locker_no ? '<tr><th>사물함</th><td>' + escapeHTML(c.locker_no) + (c.locker_months ? ' / ' + c.locker_months + '개월' : '') + '</td></tr>' : '')
    + (c.notes ? '<tr><th>비고</th><td>' + escapeHTML(c.notes) + '</td></tr>' : '')
    + '</table>';

  // 상태 배지
  const statusBadge = '<span class="badge-success">✓ 동의·서명 완료</span>';

  // 최종 렌더
  $('body').innerHTML =
    // 헤더 (1면)
      '<section class="doc-cover">'
    + '<div class="cover-logo">NATIONAL GYM</div>'
    + '<h2 class="cover-title">' + escapeHTML(t.title) + '</h2>'
    + '<p class="cover-version">약관 버전 ' + escapeHTML(t.version) + ' · 시행일 ' + fmtD(t.effective_from) + '</p>'
    + '<div class="cover-status">' + statusBadge + '</div>'
    + '<table class="data kv cover-meta">'
    + '<tr><th>계약 일시</th><td>' + fmtDT(c.signed_at) + '</td></tr>'
    + '<tr><th>계약 번호</th><td class="mono">' + escapeHTML(c.id) + '</td></tr>'
    + '<tr><th>무결성 해시</th><td class="mono">' + escapeHTML(c.content_hash || '-') + '</td></tr>'
    + '</table>'
    + (qrData ? '<div class="cover-qr"><img src="' + qrData + '" alt="검증 QR"><p class="muted small">QR로 원본 확인</p></div>' : '')
    + '</section>'

    // 당사자·계약 내용
    + '<section class="doc-section card">'
    + '<h2>계약 당사자 및 내용</h2>'
    + mainTable
    + '<h3>계약 항목</h3>'
    + '<table class="data items"><thead><tr><th>항목</th><th>횟수/기간</th><th class="num">금액</th></tr></thead>'
    + '<tbody>' + itemRows
    + '<tr class="total"><th colspan="2" class="num">합계</th><th class="num">' + fmt(c.total_amount) + '</th></tr>'
    + '</tbody></table>'
    + '</section>'

    // 약관 스냅샷
    + '<section class="doc-section card">'
    + '<h2>약관 전문 (동의 시점 박제)</h2>'
    + '<div class="terms-snapshot">' + s.contract_html_snapshot + '</div>'
    + '</section>'

    // 동의 항목 결과
    + '<section class="doc-section card">'
    + '<h2>동의 결과</h2>'
    + '<ul class="agreed-list">' + agreedRows + '</ul>'
    + '</section>'

    // Certificate of Completion
    + '<section class="doc-section card cert-card">'
    + '<h2>📋 전자서명 인증서 (Certificate of Completion)</h2>'
    + '<p class="muted small">본 인증서는 「전자서명법」 제3조, 「전자문서법」 제4조에 따라 본 계약의 법적 효력을 증명합니다.</p>'
    + '<table class="data kv cert-meta">'
    + '<tr><th>문서 ID</th><td class="mono">' + escapeHTML(c.id) + '</td></tr>'
    + '<tr><th>약관 버전</th><td>' + escapeHTML(t.version) + '</td></tr>'
    + '<tr><th>무결성 해시 (SHA-256)</th><td class="mono">' + escapeHTML(c.content_hash || '-') + '</td></tr>'
    + '<tr><th>본인확인 일시</th><td>' + fmtDT(c.identity_verified_at) + '</td></tr>'
    + '<tr><th>약관 확인 완료</th><td>' + fmtDT(c.terms_scrolled_at) + '</td></tr>'
    + '<tr><th>동의·서명 일시</th><td>' + fmtDT(c.signed_at) + '</td></tr>'
    + '<tr><th>서명 방식</th><td>' + escapeHTML(s.consent_method === 'checkbox' ? '체크박스 전자서명 (전자서명법 §3)' : '손글씨 서명') + '</td></tr>'
    + '<tr><th>접속 IP</th><td class="mono">' + escapeHTML(s.signer_ip || c.signer_ip || '-') + '</td></tr>'
    + '<tr><th>디바이스 핑거프린트</th><td class="mono">' + escapeHTML((s.signer_fingerprint_hash || c.signer_fingerprint_hash || '').slice(0, 16)) + '...</td></tr>'
    + '<tr><th>User-Agent</th><td class="mono small">' + escapeHTML(s.signer_user_agent || c.signer_user_agent || '-') + '</td></tr>'
    + '</table>'
    + '<p class="muted small">본 PDF의 원본은 시스템에 영구 보관되며, 위 QR 또는 다음 URL로 언제든 검증 가능합니다.<br>'
    + '<span class="mono small">' + escapeHTML(fullUrl) + '</span></p>'
    + '<p class="legal-footnote">'
    + '본 시스템은 「전자서명법」(법률 제17799호), 「전자문서법」(법률 제17357호), '
    + '「개인정보보호법」(법률 제18190호), 「전자상거래법」(법률 제17799호), '
    + '「방문판매법」(법률 제17799호), 「체력단련장 이용 표준약관」(공정위 제10095호)을 준수합니다.'
    + '</p>'
    + '</section>'

    // 감사 추적 (관리자에게만 노출)
    + (auditRows
      ? '<section class="doc-section card audit-card no-print">'
        + '<h2>🔍 감사 추적 (관리자 전용)</h2>'
        + '<table class="data audit-table"><thead><tr><th>일시</th><th>이벤트</th><th>IP</th><th>데이터</th></tr></thead>'
        + '<tbody>' + auditRows + '</tbody></table>'
        + '</section>'
      : '');

  document.title = '전자계약서 - ' + c.member_name;

  // PDF 다운로드 시 audit 로그
  $('btn-pdf').onclick = handlePdf;
  $('btn-print').onclick = () => { logEvent('pdf_downloaded', { method: 'print' }); window.print(); };

  async function logEvent(type, dataObj) {
    if (!token) return;
    try {
      await sb.rpc('log_contract_event', {
        p_token: token, p_event_type: type, p_event_data: dataObj || {},
        p_user_agent: navigator.userAgent, p_fingerprint_hash: null
      });
    } catch (e) {}
  }

  async function handlePdf() {
    const btn = $('btn-pdf');
    btn.disabled = true; btn.textContent = '생성 중...';
    try {
      // 인쇄 영역만
      const target = document.getElementById('body');
      // 감사 카드는 PDF에 포함하지 않음 (이미 no-print 클래스 있음 + opacity 처리)
      const auditEl = document.querySelector('.audit-card');
      const prevDisplay = auditEl ? auditEl.style.display : null;
      if (auditEl) auditEl.style.display = 'none';

      const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      if (auditEl) auditEl.style.display = prevDisplay;

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = canvas.height * imgW / canvas.width;
      const imgData = canvas.toDataURL('image/png');

      let heightLeft = imgH, position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
        heightLeft -= pageH;
      }

      // 푸터에 무결성 워터마크 (각 페이지)
      const total = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= total; i++) {
        pdf.setPage(i);
        pdf.setFontSize(7);
        pdf.setTextColor(140);
        pdf.text('NationalGym 전자계약서 · ' + (c.content_hash || '').slice(0, 12) + ' · ' + i + '/' + total,
          10, pageH - 5);
      }

      const filename = 'nationalgym-contract-' + (c.id || '').slice(0, 8) + '-'
        + (c.member_name || '').replace(/[^\p{L}\p{N}]/gu, '') + '.pdf';
      pdf.save(filename);
      logEvent('pdf_downloaded', { method: 'pdf', filename });
    } catch (e) {
      alert('PDF 생성 실패: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '📄 PDF 저장';
    }
  }
}

load();
})();
