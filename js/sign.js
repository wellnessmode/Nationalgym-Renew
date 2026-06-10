// 내셔널짐 전자계약서 — 회원 동의 페이지 (v2 Enterprise)
// 다단계 wizard: welcome → identity → terms → consent → done
// 손글씨 서명 없이 체크박스 동의로 계약 완료 (전자서명법 §3, 2020 개정)
(function () {
'use strict';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const token = params.get('t');
const LS_KEY = token ? ('ng_sign_progress_' + token) : null;

const PAY_LABEL = { card:'카드', cash:'현금', seoul_pay:'서울페이', transfer:'계좌이체', other:'기타' };
const GROUP_TARGETS = {
  core: 'agreements-core',
  privacy: 'agreements-privacy',
  sensitive: 'agreements-sensitive',
  facility: 'agreements-facility',
  marketing: 'agreements-marketing'
};

const STEPS = ['welcome', 'identity', 'terms', 'consent', 'done'];

let intro = null;       // get_contract_intro 결과
let contract = null;    // get_contract_for_signing 결과 (본인확인 후)
let template = null;
let fpHash = '';
let termsReady = false; // 약관 끝까지 스크롤 도달
let agreementsMap = {}; // {key: checked}
let agreementsList = []; // 원본 순서

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmt(n) { return Number(n || 0).toLocaleString() + '원'; }

// ---- 상태 저장 (LocalStorage 중단 복구) ----
function saveProgress(step) {
  if (!LS_KEY) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      step,
      identityVerified: !!(contract),
      agreements: agreementsMap,
      ts: Date.now()
    }));
  } catch (e) { /* quota or private mode */ }
}
function loadProgress() {
  if (!LS_KEY) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > 24 * 3600 * 1000) { localStorage.removeItem(LS_KEY); return null; }
    return obj;
  } catch (e) { return null; }
}
function clearProgress() {
  if (!LS_KEY) return;
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

// ---- 감사 로그 (best-effort, 실패해도 진행 차단 안 함) ----
async function logEvent(eventType, eventData) {
  if (!token) return;
  try {
    await sb.rpc('log_contract_event', {
      p_token: token,
      p_event_type: eventType,
      p_event_data: eventData || {},
      p_user_agent: navigator.userAgent,
      p_fingerprint_hash: fpHash || null
    });
  } catch (e) { /* silent */ }
}

// ---- 스텝 전환 ----
function showStep(step) {
  STEPS.forEach(s => {
    const el = $('step-' + s); if (el) el.hidden = s !== step;
  });
  const stepper = $('stepper');
  stepper.hidden = false;
  stepper.querySelectorAll('li').forEach(li => {
    const s = li.dataset.step;
    const a = STEPS.indexOf(s), b = STEPS.indexOf(step);
    li.classList.toggle('active', a === b);
    li.classList.toggle('done',   a < b);
  });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  saveProgress(step);
}

function showError(msg, help, actions) {
  $('loading').hidden = true;
  STEPS.forEach(s => { const el = $('step-' + s); if (el) el.hidden = true; });
  $('error-box').hidden = false;
  $('error-msg').textContent = msg || '오류가 발생했습니다.';
  $('error-help').textContent = help || '';
  $('error-actions').innerHTML = '';
  (actions || []).forEach(a => {
    const b = document.createElement('a');
    b.href = a.href || '#'; b.className = a.cls || 'btn-ghost';
    b.textContent = a.label;
    if (a.onClick) b.onclick = (e) => { e.preventDefault(); a.onClick(); };
    $('error-actions').appendChild(b);
  });
}

// ---- 초기 진입 ----
async function init() {
  if (!token) {
    showError('유효하지 않은 링크입니다.', '카카오톡으로 받으신 링크로 다시 접속해 주세요.');
    return;
  }

  // 핑거프린트는 백그라운드에서
  try { fpHash = await window.ngFingerprint(); } catch (e) { fpHash = ''; }

  // 1차 조회 (인트로)
  const { data, error } = await sb.rpc('get_contract_intro', { p_token: token });
  if (error) { showError('서버 오류: ' + error.message); return; }
  if (data && data.error) {
    if (data.error === 'expired') {
      showError(
        '이 서명 링크는 만료되었습니다.',
        '계약 발송 담당자에게 재발송을 요청해 주세요.',
        data.business_phone ? [{ label: '📞 ' + data.business_phone + ' 전화', href: 'tel:' + data.business_phone, cls: 'btn-primary' }] : []
      );
      return;
    }
    if (data.error === 'already_signed') {
      const viewUrl = './view.html?id=' + data.contract_id + '&t=' + token;
      showError(
        '이미 동의·서명이 완료된 계약입니다.',
        '아래 버튼으로 계약서를 다시 확인하실 수 있습니다.',
        [{ label: '계약서 보기', href: viewUrl, cls: 'btn-primary' }]
      );
      return;
    }
    showError('유효하지 않은 링크입니다.', '담당자에게 문의해 주세요.');
    return;
  }

  intro = data;
  $('loading').hidden = true;
  $('biz-name').textContent = intro.business_name || '내셔널짐';
  $('biz-phone').textContent = intro.business_phone ? '문의 ' + intro.business_phone : '';
  $('member-masked').textContent = intro.member_name_masked || '회원';
  $('welcome-title').textContent = (intro.template_title || '전자계약서') + ' 서명 안내';
  const exp = new Date(intro.expires_at);
  $('welcome-meta').textContent =
    '약관 버전 ' + (intro.template_version || '') +
    ' · 링크 만료 ' + exp.toLocaleString('ko-KR');

  await logEvent('reopen', { stage: 'welcome' });

  // 이어서 진행
  const prog = loadProgress();
  if (prog && prog.step && prog.step !== 'done' && prog.step !== 'welcome') {
    // 중단된 진행이 있으면 사용자에게 알림. UX 위해 자동 복구는 identity 까지만.
    if (prog.identityVerified && prog.step === 'terms') {
      // identity 부터 다시 (서버 상태 확실히 보장 위해)
      showStep('identity');
      return;
    }
  }
  showStep('welcome');
}

// ---- Welcome → Identity ----
$('btn-to-identity').onclick = () => showStep('identity');

// ---- Identity verification ----
$('btn-verify').onclick = async () => {
  $('id-err').textContent = '';
  const name = $('id-name').value.trim();
  const birth = $('id-birth').value;
  const p4 = $('id-phone4').value.trim().replace(/[^0-9]/g, '');
  if (!name) { $('id-err').textContent = '이름을 입력해 주세요.'; return; }
  if (!birth) { $('id-err').textContent = '생년월일을 선택해 주세요.'; return; }
  if (!/^[0-9]{4}$/.test(p4)) { $('id-err').textContent = '휴대폰 끝 4자리를 정확히 입력해 주세요.'; return; }

  const btn = $('btn-verify');
  btn.disabled = true; btn.textContent = '확인 중...';
  await logEvent('identity_attempt');

  const { data, error } = await sb.rpc('verify_identity', {
    p_token: token, p_name: name, p_birth: birth, p_phone_last4: p4
  });

  btn.disabled = false; btn.textContent = '본인확인';

  if (error) { $('id-err').textContent = '서버 오류: ' + error.message; return; }
  if (data && data.error) {
    if (data.error === 'identity_mismatch') $('id-err').textContent = '입력하신 정보가 계약 발송 시 등록 정보와 일치하지 않습니다.';
    else if (data.error === 'too_many_attempts') $('id-err').textContent = '잠시 후 다시 시도해 주세요. (5분 후 가능)';
    else if (data.error === 'invalid_or_expired') $('id-err').textContent = '링크가 만료되었거나 유효하지 않습니다.';
    else $('id-err').textContent = data.error;
    return;
  }

  // 본인확인 통과 → 계약 전체 로드
  const r2 = await sb.rpc('get_contract_for_signing', { p_token: token });
  if (r2.error || (r2.data && r2.data.error)) {
    $('id-err').textContent = '계약 정보를 불러오는 중 오류가 발생했습니다.'; return;
  }
  contract = r2.data.contract;
  template = r2.data.template;
  renderTerms();
  renderContractSummary();
  renderPolicies();
  buildAgreements();
  showStep('terms');
};

// ---- Terms render ----
function renderTerms() {
  $('terms-title').textContent = (template.title || '약관') + ' (v' + (template.version || '') + ')';
  $('terms-meta').textContent = '시행일: ' + new Date(template.effective_from).toLocaleDateString('ko-KR');
  $('terms-body').innerHTML = template.body_html;
  termsReady = false;
  $('btn-to-consent').disabled = true;
  $('btn-to-consent').textContent = '약관을 끝까지 확인해 주세요';
  setupScrollObserver();
}

function setupScrollObserver() {
  const scrollEl = $('terms-scroll');
  const bar = $('terms-progress-bar');
  const text = $('terms-progress-text');

  function isAtBottom() {
    // 끝까지 스크롤 도달 검사 (8px 허용 오차 — 모바일 sub-pixel 보정)
    return scrollEl.scrollTop + scrollEl.clientHeight + 8 >= scrollEl.scrollHeight;
  }

  function updateProgress() {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    const pct = max <= 0 ? 100 : Math.min(100, Math.round(scrollEl.scrollTop / max * 100));
    bar.style.width = pct + '%';
    text.textContent = pct + '%';
    if (!termsReady && isAtBottom()) markTermsReady();
  }

  scrollEl.addEventListener('scroll', updateProgress, { passive: true });

  // 초기 1회 — 콘텐츠가 짧아 스크롤이 불필요한 경우(max<=4)만 즉시 통과
  setTimeout(() => {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (max <= 4) markTermsReady();
    updateProgress();
  }, 200);
}

function markTermsReady() {
  if (termsReady) return;
  termsReady = true;
  const btn = $('btn-to-consent');
  btn.disabled = false;
  btn.textContent = '동의 단계로 이동';
  $('scroll-hint').classList.add('done');
  $('scroll-hint').innerHTML = '<b>✅ 약관 확인 완료</b><p>아래 [동의 단계로 이동] 버튼을 눌러 진행해 주세요.</p>';
  logEvent('terms_scrolled');
}

// ---- 계약 요약 ----
function renderContractSummary() {
  const c = contract;
  const items = c.items_json || [];
  const itemRows = items.map(it =>
    '<tr><td>' + escapeHTML(it.name) + '</td><td>' + escapeHTML(it.qty || '') +
    '</td><td class="num">' + fmt(it.price) + '</td></tr>'
  ).join('');

  $('contract-summary').innerHTML =
      '<table class="data kv">'
    + '<tr><th>회원</th><td>' + escapeHTML(c.member_name) + ' / ' + escapeHTML(c.member_phone) + '</td></tr>'
    + (c.member_birth ? '<tr><th>생년월일</th><td>' + escapeHTML(c.member_birth) + '</td></tr>' : '')
    + (c.member_address ? '<tr><th>주소</th><td>' + escapeHTML(c.member_address) + '</td></tr>' : '')
    + '<tr><th>지점</th><td>' + escapeHTML(c.branch || '-') + '</td></tr>'
    + '<tr><th>사업자</th><td>' + escapeHTML(c.business_name) + ' (대표 ' + escapeHTML(c.business_owner) + ')'
      + (c.business_registration ? '<br><span class="muted small">사업자등록 ' + escapeHTML(c.business_registration) + '</span>' : '') + '</td></tr>'
    + '<tr><th>이용 기간</th><td>' + escapeHTML(c.contract_period_start || '-') + ' ~ ' + escapeHTML(c.contract_period_end || '-') + '</td></tr>'
    + '<tr><th>결제수단</th><td>' + escapeHTML(PAY_LABEL[c.payment_method] || c.payment_method || '-') + '</td></tr>'
    + (c.locker_no ? '<tr><th>사물함</th><td>' + escapeHTML(c.locker_no) + (c.locker_months ? ' / ' + c.locker_months + '개월' : '') + '</td></tr>' : '')
    + (c.notes ? '<tr><th>비고</th><td>' + escapeHTML(c.notes) + '</td></tr>' : '')
    + '</table>'
    + '<h3>계약 항목</h3>'
    + '<table class="data items"><thead><tr><th>항목</th><th>횟수/기간</th><th class="num">금액</th></tr></thead>'
    + '<tbody>' + itemRows
    + '<tr class="total"><th colspan="2" class="num">합계</th><th class="num">' + fmt(c.total_amount) + '</th></tr>'
    + '</tbody></table>';
}

// ---- 환불정책 / 개인정보 박스 ----
function renderPolicies() {
  // 환불 요약 (v1 원본 공식: 위약금 10% / 카드수수료 5% / 이용 회차 정상가 / 사은품)
  const rp = (template.refund_policy_json && Object.keys(template.refund_policy_json).length) ? template.refund_policy_json : null;
  const rpBox = $('refund-policy-box');
  if (rp) {
    const penalty = rp.penalty_pct != null ? rp.penalty_pct : (rp.max_penalty_pct != null ? rp.max_penalty_pct : 10);
    const cardFee = rp.card_fee_pct != null ? rp.card_fee_pct : 5;
    const deductions = (rp.deductions || []).map(d => '<li>' + escapeHTML(d) + '</li>').join('');
    rpBox.innerHTML =
      '<p><b>환불 공제금액</b>: 결제금액 − 위약금 ' + penalty + '% − 카드 수수료 ' + cardFee + '% − 사은품 및 서비스 공제</p>'
      + (deductions ? '<ul class="deduction-list">' + deductions + '</ul>' : '');
  } else {
    rpBox.innerHTML = '<p class="muted small">약관 §3 환불 조항을 참조해 주세요.</p>';
  }

  // 개인정보
  const pj = (template.privacy_json && Object.keys(template.privacy_json).length) ? template.privacy_json : null;
  const pBox = $('privacy-policy-box');
  if (pj) {
    pBox.innerHTML =
      '<table class="data kv">'
      + '<tr><th>수집 항목</th><td>' + (pj.items || []).map(escapeHTML).join(', ') + '</td></tr>'
      + '<tr><th>이용 목적</th><td>' + escapeHTML(pj.purpose || '') + '</td></tr>'
      + '<tr><th>보유 기간</th><td>' + escapeHTML(pj.retention || '') + '</td></tr>'
      + '<tr><th>제3자 제공</th><td>' + (pj.third_party || []).map(escapeHTML).join(', ') + '</td></tr>'
      + '</table>'
      + '<p class="muted small">필수 항목 미동의 시 계약 체결이 불가합니다.</p>';
  } else {
    pBox.innerHTML = '<p class="muted small">약관 §4 개인정보 조항을 참조해 주세요.</p>';
  }
}

// ---- 동의 항목 그룹 렌더 ----
function buildAgreements() {
  const agreements = (template.agreements_json && template.agreements_json.length)
    ? template.agreements_json
    : [
      { key:'terms', label:'위 약관 전문에 동의합니다.', required:true, group:'core' },
      { key:'privacy', label:'개인정보 수집·이용에 동의합니다.', required:true, group:'privacy' }
    ];
  agreementsList = agreements;
  agreementsMap = {};
  Object.values(GROUP_TARGETS).forEach(id => {
    const root = $(id);
    // 헤더(h4)만 남기고 자식 제거
    const h4 = root.querySelector('h4');
    root.innerHTML = '';
    if (h4) root.appendChild(h4);
  });

  // 그룹별 존재 여부
  const groupUsed = {};

  agreements.forEach((a, i) => {
    const groupId = GROUP_TARGETS[a.group] || GROUP_TARGETS.core;
    const root = $(groupId);
    if (!root) return;
    groupUsed[groupId] = true;

    const wrap = document.createElement('label');
    wrap.className = 'agreement-row';
    wrap.innerHTML =
      '<input type="checkbox" data-key="' + escapeHTML(a.key) + '" data-req="' + (a.required ? '1':'0') + '">' +
      '<span class="ag-text">' +
      (a.required ? '<b class="req-mark">[필수]</b> ' : '<span class="opt-mark">[선택]</span> ') +
      escapeHTML(a.label) +
      '</span>';
    root.appendChild(wrap);

    const cb = wrap.querySelector('input');
    agreementsMap[a.key] = false;
    cb.addEventListener('change', () => {
      agreementsMap[a.key] = cb.checked;
      logEvent(cb.checked ? 'consent_checked' : 'consent_unchecked', { key: a.key });
      updateConsentState();
      saveProgress('consent');
    });
  });

  // 빈 그룹 숨기기
  Object.entries(GROUP_TARGETS).forEach(([g, id]) => {
    if (!groupUsed[id]) $(id).style.display = 'none';
    else $(id).style.display = '';
  });

  $('ag-all').checked = false;
  $('ag-all').onchange = () => {
    const all = $('ag-all').checked;
    document.querySelectorAll('.agreement-row input[type=checkbox]').forEach(cb => {
      cb.checked = all;
      agreementsMap[cb.dataset.key] = all;
    });
    logEvent(all ? 'consent_all_checked' : 'consent_unchecked', { all_toggle: true });
    updateConsentState();
    saveProgress('consent');
  };

  updateConsentState();
}

function updateConsentState() {
  const missing = agreementsList.filter(a => a.required && !agreementsMap[a.key]);
  const btn = $('btn-submit');
  if (missing.length === 0) {
    btn.disabled = false;
    btn.textContent = '동의·서명 제출';
  } else {
    btn.disabled = true;
    btn.textContent = '필수 ' + missing.length + '개 미체크';
  }
}

// ---- Step navigation ----
document.querySelectorAll('[data-back]').forEach(b => {
  b.onclick = () => showStep(b.dataset.back);
});
$('btn-to-consent').onclick = () => {
  if (!termsReady) { return; }
  showStep('consent');
};

// ---- Submit ----
$('btn-submit').onclick = async () => {
  $('consent-err').textContent = '';
  const missing = agreementsList.filter(a => a.required && !agreementsMap[a.key]);
  if (missing.length > 0) {
    $('consent-err').textContent = '필수 항목 ' + missing.map(m => '"' + m.label.slice(0,12) + '..."').join(', ') + ' 미체크';
    return;
  }
  const btn = $('btn-submit');
  btn.disabled = true; btn.textContent = '제출 중...';

  const { data, error } = await sb.rpc('submit_consent', {
    p_token: token,
    p_agreed_items: agreementsMap,
    p_user_agent: navigator.userAgent,
    p_fingerprint_hash: fpHash || null
  });

  if (error) {
    $('consent-err').textContent = '제출 실패: ' + error.message;
    btn.disabled = false; btn.textContent = '동의·서명 제출';
    return;
  }
  if (data && data.error) {
    if (data.error === 'required_consent_missing') {
      $('consent-err').textContent = '필수 항목 미동의: ' + (data.missing_key || '');
    } else if (data.error === 'identity_required') {
      $('consent-err').textContent = '본인확인이 필요합니다. 처음부터 다시 시도해 주세요.';
    } else {
      $('consent-err').textContent = '오류: ' + data.error;
    }
    btn.disabled = false; btn.textContent = '동의·서명 제출';
    return;
  }

  // 성공
  clearProgress();
  $('done-hash').textContent = '문서 무결성 해시 (앞 12자): ' + (data.content_hash || '').slice(0, 12);
  $('view-link').href = './view.html?id=' + data.contract_id + '&t=' + token;

  // 카톡 공유 (지원되는 환경에서만)
  if (navigator.share) {
    $('btn-share').hidden = false;
    $('btn-share').onclick = async () => {
      try {
        await navigator.share({
          title: '내셔널짐 전자계약서',
          text: '서명 완료된 계약서를 확인하세요.',
          url: location.origin + location.pathname.replace(/sign\.html$/, 'view.html') + '?id=' + data.contract_id + '&t=' + token
        });
      } catch (e) { /* user cancel */ }
    };
  }

  showStep('done');
};

// ---- 페이지 종료 로깅 ----
window.addEventListener('beforeunload', () => {
  // 비콘으로 베스트 에포트
  if (navigator.sendBeacon) {
    // RPC 가 아니라 단순 로그만
  }
});

init();
})();
