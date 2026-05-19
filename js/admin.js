// 내셔널짐 전자계약서 — 관리자 발송 (v2 Enterprise)
(function () {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.NG_CONTRACT_CONFIG;
let session = null;
let activeTemplate = null;

function bizForBranch(branch) {
  const map = cfg.BUSINESS_BY_BRANCH || {};
  return map[branch] || cfg.BUSINESS || {};
}

function showLogin() { $('login').style.display='block'; $('app').style.display='none'; }
function showApp() {
  $('login').style.display='none'; $('app').style.display='block';
  $('who').textContent = session?.user?.email || '';
}

async function refreshTemplate() {
  const type = $('t-type').value;
  $('tpl-info').textContent = '약관 정보 조회 중...';
  const { data, error } = await sb.from('contract_templates')
    .select('id,version,title,effective_from')
    .eq('contract_type', type).eq('is_active', true)
    .order('effective_from', { ascending: false }).limit(1);
  if (error) { $('tpl-info').textContent = '약관 조회 오류: ' + error.message; activeTemplate = null; return; }
  if (!data || !data.length) { $('tpl-info').textContent = '활성 약관 없음. supabase_schema.sql 의 시드를 실행하세요.'; activeTemplate = null; return; }
  activeTemplate = data[0];
  $('tpl-info').innerHTML =
    '✓ 활성 약관: <b>' + escapeHTML(activeTemplate.title) + '</b> '
    + '<span class="badge-info">v' + escapeHTML(activeTemplate.version) + '</span>'
    + ' · 시행일 ' + new Date(activeTemplate.effective_from).toLocaleDateString('ko-KR');
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function init() {
  const branches = (cfg.BRANCHES && cfg.BRANCHES.length) ? cfg.BRANCHES : ['본점'];
  $('branch').innerHTML = branches.map(b => '<option>' + escapeHTML(b) + '</option>').join('');

  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) { showApp(); await refreshTemplate(); } else { showLogin(); }
  renderItems();
}

$('btn-login').onclick = async () => {
  const email = $('login-email').value.trim();
  const pw = $('login-pw').value;
  $('login-err').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) { $('login-err').textContent = error.message; return; }
  session = data.session; showApp(); await refreshTemplate();
};
$('btn-logout').onclick = async () => { await sb.auth.signOut(); session = null; showLogin(); };
$('t-type').onchange = refreshTemplate;

// --- items ---
const items = [];
function renderItems() {
  const root = $('items');
  root.innerHTML = '';
  items.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML =
      '<label>항목명 <input data-k="name" type="text" placeholder="예: PT 30회"></label>' +
      '<label>횟수/기간 <input data-k="qty" type="text" placeholder="예: 30회 / 4개월"></label>' +
      '<label>금액(원) <input data-k="price" type="number" min="0"></label>' +
      '<button class="btn-ghost rm" data-rm="' + i + '">삭제</button>';
    div.querySelectorAll('input').forEach(inp => {
      inp.value = it[inp.dataset.k] != null ? it[inp.dataset.k] : '';
      inp.oninput = () => {
        items[i][inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value;
        recalcTotal();
      };
    });
    div.querySelector('[data-rm]').onclick = () => { items.splice(i, 1); renderItems(); recalcTotal(); };
    root.appendChild(div);
  });
}
function recalcTotal() {
  const sum = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  if (!$('total').dataset.touched) $('total').value = sum;
}
$('total').oninput = () => { $('total').dataset.touched = '1'; };
$('btn-add-item').onclick = () => { items.push({ name:'', qty:'', price:0 }); renderItems(); };

$('btn-reset').onclick = () => {
  ['m-name','m-phone','m-birth','m-email','m-address','total','period-start','period-end','locker-no','locker-months','notes'].forEach(id => $(id).value='');
  delete $('total').dataset.touched;
  items.length = 0; renderItems();
  $('result').style.display='none';
  $('err').textContent='';
};

// --- token (256bit, base64url) ---
function rndToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  // base64url
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- create ---
$('btn-create').onclick = async () => {
  $('err').textContent = '';
  if (!session) { $('err').textContent='로그인이 필요합니다.'; showLogin(); return; }
  if (!activeTemplate) { $('err').textContent='활성 약관이 없습니다. 약관을 먼저 등록하세요.'; return; }

  const name = $('m-name').value.trim();
  const phone = $('m-phone').value.trim().replace(/[^0-9]/g, '');
  const birth = $('m-birth').value;
  if (!name || !phone) { $('err').textContent = '이름과 휴대폰은 필수입니다.'; return; }
  if (!/^01[016789][0-9]{7,8}$/.test(phone)) { $('err').textContent='휴대폰 번호 형식이 올바르지 않습니다.'; return; }
  if (!birth) { $('err').textContent = '생년월일은 본인확인용으로 필수입니다.'; return; }
  if (items.length === 0) { $('err').textContent = '계약 항목을 1개 이상 추가하세요.'; return; }
  for (const it of items) {
    if (!it.name || !it.qty || !it.price) { $('err').textContent='항목명·횟수·금액을 모두 입력하세요.'; return; }
  }
  const total = Number($('total').value || 0);
  if (total <= 0) { $('err').textContent = '총 결제금액을 입력하세요.'; return; }

  const token = rndToken();
  const expireDays = Math.max(1, Math.min(60, Number($('expire-days').value || 7)));
  const expiresAt = new Date(Date.now() + expireDays * 86400000).toISOString();

  const lockerMonths = Number($('locker-months').value) || null;

  const branch = $('branch').value;
  const biz = bizForBranch(branch);
  if (!biz.name || !biz.owner) {
    $('err').textContent = '선택한 지점의 사업자 정보가 config.js 에 없습니다.';
    return;
  }

  const payload = {
    template_id: activeTemplate.id,
    branch: branch,
    member_name: name, member_phone: phone,
    member_birth: birth,
    member_address: $('m-address').value || null,
    member_email: $('m-email').value || null,
    business_name: biz.name,
    business_owner: biz.owner,
    business_registration: biz.registration_no || null,
    business_address: biz.address || null,
    business_phone: biz.phone || null,
    items_json: items,
    total_amount: total,
    payment_method: $('pay').value,
    contract_period_start: $('period-start').value || null,
    contract_period_end: $('period-end').value || null,
    locker_no: $('locker-no').value || null,
    locker_months: lockerMonths,
    notes: $('notes').value || null,
    sign_token: token,
    status: 'sent',
    expires_at: expiresAt,
    created_by: session.user.id,
    sent_at: new Date().toISOString()
  };

  $('btn-create').disabled = true; $('btn-create').textContent = '생성 중...';
  const { data: ins, error } = await sb.from('contracts').insert(payload).select().single();
  $('btn-create').disabled = false; $('btn-create').textContent = '서명 링크 생성';
  if (error) { $('err').textContent = '저장 실패: ' + error.message; return; }

  await sb.from('contract_audit_log').insert([
    { contract_id: ins.id, event_type: 'created' },
    { contract_id: ins.id, event_type: 'sent' }
  ]);

  const url = (cfg.SIGN_BASE_URL || (location.origin + location.pathname.replace(/admin\.html$/, 'sign.html')))
    + '?t=' + token;
  $('sign-url').value = url;

  const itemSummary = items.map(it => '• ' + it.name + ' (' + it.qty + ') ' + Number(it.price).toLocaleString() + '원').join('\n');

  // v2 카카오톡 메시지 — 서명 → 동의, 본인확인 안내, 법적 효력 명시
  const msg =
    '[' + biz.name + '] ' + name + ' 회원님, 안녕하세요.\n\n' +
    '재계약 전자계약서 안내드립니다. 아래 링크에서\n' +
    '본인확인 → 약관 확인 → 동의 체크 3단계로 간편하게 진행하실 수 있습니다.\n\n' +
    '■ 계약 내용\n' + itemSummary + '\n' +
    '총 결제금액 ' + total.toLocaleString() + '원\n\n' +
    '■ 본인확인 정보 (필수)\n' +
    '· 이름: ' + name + '\n' +
    '· 생년월일: ' + birth + '\n' +
    '· 휴대폰 끝 4자리: ' + phone.slice(-4) + '\n\n' +
    '▶ 계약서 확인 및 동의\n' + url + '\n\n' +
    '※ 본 링크는 ' + expireDays + '일간 유효하며, 회원님만 사용할 수 있습니다.\n' +
    '※ 동의·서명 완료 시 「전자서명법」 §3에 따라 서면 계약과 동일한 효력이 발생합니다.\n\n' +
    '문의: ' + (biz.phone || '');

  $('kakao-msg').value = msg;
  $('result').style.display = 'block';
  $('result').scrollIntoView({ behavior: 'smooth' });
};

function copyToClipboard(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); document.body.removeChild(ta);
  return Promise.resolve();
}
$('btn-copy-url').onclick = async () => {
  await copyToClipboard($('sign-url').value);
  $('btn-copy-url').textContent = '✓ 복사됨';
  setTimeout(() => $('btn-copy-url').textContent = '링크 복사', 1500);
};
$('btn-copy-msg').onclick = async () => {
  await copyToClipboard($('kakao-msg').value);
  $('btn-copy-msg').textContent = '✓ 복사됨';
  setTimeout(() => $('btn-copy-msg').textContent = '메시지 복사', 1500);
};

init();
})();
