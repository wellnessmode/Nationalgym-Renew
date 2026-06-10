// 내셔널짐 전자계약서 — 계약 목록 (v2 Enterprise)
(function () {
'use strict';
const $ = id => document.getElementById(id);
const cfg = window.NG_CONTRACT_CONFIG;
let session = null;
let allRows = [];

const STATUS_LABEL = {
  pending: '대기', sent: '발송', viewed: '열람', identified: '본인확인',
  signed: '동의완료', expired: '만료', canceled: '취소'
};

async function init() {
  const branches = cfg.BRANCHES || [];
  $('filter-branch').innerHTML = '<option value="">전체 지점</option>'
    + branches.map(b => '<option>' + escapeHTML(b) + '</option>').join('');

  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { $('login').style.display='block'; $('app').style.display='none'; return; }
  $('login').style.display='none'; $('app').style.display='block';
  load();
}
$('btn-login').onclick = async () => {
  const email = $('login-email').value.trim(), pw = $('login-pw').value;
  $('login-err').textContent='';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) { $('login-err').textContent = error.message; return; }
  session = data.session; init();
};

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let _searchTimer = null;
function load() {
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(_load, 200);
}

function periodFilter(value) {
  const now = new Date();
  if (value === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (value === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString();
  }
  if (value === 'month') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString();
  }
  if (value === '3month') {
    const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString();
  }
  return null;
}

async function _load() {
  const tbody = document.querySelector('#tbl tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted text-center">불러오는 중...</td></tr>';
  let q = sb.from('contracts')
    .select('id,branch,member_name,member_phone,total_amount,status,sign_token,template_id,created_at,signed_at,viewed_at,identity_verified_at,expires_at,content_hash')
    .order('created_at', { ascending: false }).limit(500);
  const txt = $('q').value.trim();
  const st = $('filter-status').value;
  const br = $('filter-branch').value;
  const pr = periodFilter($('filter-period').value);
  if (txt) q = q.or('member_name.ilike.%' + txt + '%,member_phone.ilike.%' + txt + '%');
  if (st)  q = q.eq('status', st);
  if (br)  q = q.eq('branch', br);
  if (pr)  q = q.gte('created_at', pr);

  const { data, error } = await q;
  if (error) { tbody.innerHTML = '<tr><td colspan="8" class="error">' + escapeHTML(error.message) + '</td></tr>'; return; }
  allRows = data || [];
  $('count').textContent = '검색 결과 ' + allRows.length + '건';

  // KPI 갱신 (전체 기준이 아니라 현재 필터 기준)
  updateKPI(allRows);

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted text-center" style="padding:24px">조건에 맞는 계약이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = allRows.map(c => {
    const tag = '<span class="status-tag s-' + c.status + '">' + (STATUS_LABEL[c.status] || c.status) + '</span>';
    let actions = '';
    if (c.status === 'signed') {
      actions = '<a href="./view.html?id=' + c.id + '" class="btn-mini">📄 보기</a>';
    } else if (c.status === 'expired' || c.status === 'canceled') {
      actions = '<span class="muted small">-</span>';
    } else {
      const url = (cfg.SIGN_BASE_URL || (location.origin + location.pathname.replace(/list\.html$/, 'sign.html'))) + '?t=' + c.sign_token;
      actions = '<button class="btn-mini" data-copy="' + escapeHTML(url) + '">🔗 링크</button>';
    }

    // 기간/상태 추가 정보
    const expiresAt = new Date(c.expires_at);
    const expiringSoon = c.status !== 'signed' && c.status !== 'expired' && c.status !== 'canceled'
      && (expiresAt - new Date()) < 2 * 86400 * 1000;

    return '<tr' + (expiringSoon ? ' class="row-warn"' : '') + '>'
      + '<td><b>' + escapeHTML(c.member_name) + '</b></td>'
      + '<td class="mono small">' + escapeHTML(c.member_phone) + '</td>'
      + '<td>' + escapeHTML(c.branch || '-') + '</td>'
      + '<td class="muted small">-</td>'
      + '<td class="num">' + Number(c.total_amount || 0).toLocaleString() + '원</td>'
      + '<td>' + tag + (expiringSoon ? ' <span class="badge-warn">D-' + Math.max(0, Math.ceil((expiresAt - new Date()) / 86400000)) + '</span>' : '') + '</td>'
      + '<td class="muted small">' + new Date(c.created_at).toLocaleDateString('ko-KR') + '</td>'
      + '<td>' + actions + '</td>'
      + '</tr>';
  }).join('');

  tbody.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.copy;
      if (navigator.clipboard) navigator.clipboard.writeText(v);
      else {
        const ta = document.createElement('textarea'); ta.value = v;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      b.textContent = '✓ 복사';
      setTimeout(() => b.textContent = '🔗 링크', 1500);
    };
  });
}

function updateKPI(rows) {
  const total = rows.length;
  const pending = rows.filter(r => ['sent','viewed','identified','pending'].includes(r.status)).length;
  const signed = rows.filter(r => r.status === 'signed');
  const expired = rows.filter(r => r.status === 'expired').length;
  const signedAmt = signed.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);

  $('kpi-total').textContent = total;
  $('kpi-sent').textContent = pending;
  $('kpi-signed').textContent = signed.length;
  $('kpi-signed-amt').textContent = signedAmt > 0 ? signedAmt.toLocaleString() + '원' : '-';
  $('kpi-expired').textContent = expired;
}

// KPI 카드 클릭 → 필터링
document.querySelectorAll('.kpi-card').forEach(card => {
  card.onclick = () => {
    $('filter-status').value = card.dataset.quickfilter || '';
    load();
  };
});

// CSV 내보내기
$('btn-export').onclick = () => {
  if (!allRows.length) return alert('내보낼 데이터가 없습니다.');
  const headers = ['계약번호','회원','휴대폰','지점','금액','상태','생성일','동의일','만료일','무결성해시'];
  const rows = allRows.map(r => [
    r.id, r.member_name, r.member_phone, r.branch || '',
    r.total_amount || '', STATUS_LABEL[r.status] || r.status,
    new Date(r.created_at).toLocaleString('ko-KR'),
    r.signed_at ? new Date(r.signed_at).toLocaleString('ko-KR') : '',
    r.expires_at ? new Date(r.expires_at).toLocaleString('ko-KR') : '',
    (r.content_hash || '').slice(0, 16)
  ]);
  const csv = [headers, ...rows].map(row =>
    row.map(cell => {
      const s = String(cell == null ? '' : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');
  // BOM 으로 한글 깨짐 방지
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nationalgym-contracts-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('q').oninput = load;
$('filter-status').onchange = load;
$('filter-branch').onchange = load;
$('filter-period').onchange = load;

// ===== 전체 백업 (이중 보관: Supabase + 로컬 파일) =====
// 모든 계약·약관 박제본·동의 결과·감사 로그를 자체 열람 가능한
// HTML 파일 하나로 다운로드. 인터넷 없이 더블클릭으로 열람·검색·인쇄 가능.
const EVENT_LABEL = {
  created:'계약 생성', sent:'링크 발송', link_viewed:'링크 첫 열람',
  terms_scrolled:'약관 확인 완료', consent_checked:'동의 체크', consent_unchecked:'동의 해제',
  consent_all_checked:'필수 일괄 동의', identity_attempt:'본인확인 시도',
  identity_verified:'본인확인 통과', identity_failed:'본인확인 실패',
  consented:'동의 완료(서명)', signed:'동의 완료(서명)',
  pdf_viewed:'계약서 열람', pdf_downloaded:'PDF 다운로드', reopen:'페이지 재진입'
};

async function fetchAll(table, orderCol) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select('*')
      .order(orderCol, { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

function buildBackupHtml(payload) {
  // 임베드 JSON 의 모든 '<' 를 < 로 — 스크립트 태그 조기 종료 방지
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const head =
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>내셔널짐 계약 백업 ' + payload.exported_at.slice(0, 10) + '</title>'
    + '<style>'
    + 'body{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:0;background:#f4f6f9;color:#111;line-height:1.55}'
    + '.wrap{max-width:920px;margin:0 auto;padding:16px}'
    + '.head{background:#0f1f15;color:#d7f0df;padding:16px;border-radius:10px;margin-bottom:12px}'
    + '.head h1{margin:0;font-size:18px}.head p{margin:6px 0 0;font-size:12px;opacity:.9}'
    + '.warn{background:#fff5e1;border-left:4px solid #b6741f;padding:10px 12px;border-radius:6px;font-size:12px;margin:10px 0}'
    + 'input[type=search]{width:100%;padding:10px 12px;border:1px solid #cfd6de;border-radius:8px;font-size:14px;margin:8px 0}'
    + '.row{background:#fff;border:1px solid #e6ebf0;border-radius:8px;margin:8px 0;overflow:hidden}'
    + '.row>summary{padding:10px 14px;cursor:pointer;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;list-style:none}'
    + '.row>summary::-webkit-details-marker{display:none}'
    + '.row b{font-size:14px}.mut{color:#54606c;font-size:12px}'
    + '.tag{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#eee;color:#666}'
    + '.tag.signed{background:#dff5e3;color:#1f7a3a}.tag.expired,.tag.canceled{background:#f8d7da;color:#a02732}'
    + '.detail{padding:12px 14px;border-top:1px solid #e6ebf0;font-size:13px}'
    + 'table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}'
    + 'th,td{border:1px solid #e0e5ea;padding:6px 8px;text-align:left;vertical-align:top}'
    + 'th{background:#f4f6f9;font-weight:600;width:130px}'
    + '.snap{border:1px dashed #cfd6de;border-radius:8px;padding:10px 12px;margin:8px 0;background:#fafafa;font-size:12px}'
    + '.snap table th{width:auto}'
    + '.mono{font-family:monospace;word-break:break-all;font-size:11px}'
    + '@media print{.warn,input{display:none}.row{page-break-inside:avoid}}'
    + '</style></head><body><div class="wrap">'
    + '<div class="head"><h1>내셔널짐 전자계약서 — 로컬 백업</h1>'
    + '<p>생성: ' + payload.exported_at + ' · 계약 ' + payload.contracts.length + '건 · 동의완료 '
    + payload.contracts.filter(function(c){ return c.status === 'signed'; }).length + '건</p>'
    + '<p>원본은 Supabase 에 보관 중이며 본 파일은 이중 보관용 사본입니다. 인터넷 없이 열람 가능합니다.</p></div>'
    + '<div class="warn">⚠️ 본 파일에는 회원 개인정보가 포함되어 있습니다. 사무실 PC·USB 등 안전한 곳에만 보관하고 외부 공유를 금지합니다.</div>'
    + '<input type="search" id="q" placeholder="🔍 이름 / 휴대폰 검색">'
    + '<div id="list"></div>'
    + '</div>'
    + '<script type="application/json" id="ng-backup-data">' + json + '<\/script>';

  const renderer =
    '<script>(function(){\n'
    + 'var D=JSON.parse(document.getElementById("ng-backup-data").textContent);\n'
    + 'var STATUS=' + JSON.stringify(STATUS_LABEL) + ';\n'
    + 'var EVENT=' + JSON.stringify(EVENT_LABEL) + ';\n'
    + 'function esc(s){return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});}\n'
    + 'function dt(s){return s?new Date(s).toLocaleString("ko-KR"):"-";}\n'
    + 'function won(n){return Number(n||0).toLocaleString()+"원";}\n'
    + 'var sigBy={};D.signatures.forEach(function(s){sigBy[s.contract_id]=s;});\n'
    + 'var audBy={};D.audit.forEach(function(a){(audBy[a.contract_id]=audBy[a.contract_id]||[]).push(a);});\n'
    + 'function detail(c){var s=sigBy[c.id];var h="";\n'
    + 'h+="<table>";\n'
    + 'h+="<tr><th>회원</th><td>"+esc(c.member_name)+" / "+esc(c.member_phone)+(c.member_birth?" / "+esc(c.member_birth):"")+"</td></tr>";\n'
    + 'h+="<tr><th>사업자</th><td>"+esc(c.business_name)+" (대표 "+esc(c.business_owner)+")"+(c.business_registration?" · "+esc(c.business_registration):"")+"</td></tr>";\n'
    + 'h+="<tr><th>지점</th><td>"+esc(c.branch||"-")+"</td></tr>";\n'
    + 'h+="<tr><th>금액/결제</th><td>"+won(c.total_amount)+" / "+esc(c.payment_method||"-")+"</td></tr>";\n'
    + 'h+="<tr><th>이용 기간</th><td>"+esc(c.contract_period_start||"-")+" ~ "+esc(c.contract_period_end||"-")+"</td></tr>";\n'
    + 'h+="<tr><th>상태</th><td>"+esc(STATUS[c.status]||c.status)+"</td></tr>";\n'
    + 'h+="<tr><th>생성/동의</th><td>"+dt(c.created_at)+" / "+dt(c.signed_at)+"</td></tr>";\n'
    + 'h+="<tr><th>계약번호</th><td class=mono>"+esc(c.id)+"</td></tr>";\n'
    + 'h+="<tr><th>무결성 해시</th><td class=mono>"+esc(c.content_hash||"-")+"</td></tr>";\n'
    + 'h+="<tr><th>접속 IP/기기</th><td class=mono>"+esc((s&&s.signer_ip)||c.signer_ip||"-")+"<br>"+esc((s&&s.signer_user_agent)||c.signer_user_agent||"-")+"</td></tr>";\n'
    + 'h+="</table>";\n'
    + 'var items=c.items_json||[];if(items.length){h+="<table><tr><th>항목</th><th>횟수/기간</th><th>금액</th></tr>";items.forEach(function(it){h+="<tr><td>"+esc(it.name)+"</td><td>"+esc(it.qty||"")+"</td><td>"+won(it.price)+"</td></tr>";});h+="</table>";}\n'
    + 'if(s&&s.contract_html_snapshot){h+="<details><summary style=cursor:pointer;font-weight:600>약관 전문 + 동의 결과 (동의 시점 보존본)</summary><div class=snap>"+s.contract_html_snapshot+"</div></details>";}\n'
    + 'var ev=audBy[c.id]||[];if(ev.length){h+="<details><summary style=cursor:pointer;font-weight:600>감사 기록 "+ev.length+"건</summary><table><tr><th>일시</th><th>이벤트</th><th>IP</th></tr>";ev.forEach(function(e){h+="<tr><td>"+dt(e.created_at)+"</td><td>"+esc(EVENT[e.event_type]||e.event_type)+"</td><td class=mono>"+esc(e.ip||"-")+"</td></tr>";});h+="</table></details>";}\n'
    + 'return h;}\n'
    + 'var root=document.getElementById("list");\n'
    + 'function draw(f){root.innerHTML="";var n=0;\n'
    + 'D.contracts.slice().reverse().forEach(function(c){\n'
    + 'if(f&&(String(c.member_name).indexOf(f)<0&&String(c.member_phone).indexOf(f)<0))return;n++;\n'
    + 'var d=document.createElement("details");d.className="row";\n'
    + 'd.innerHTML="<summary><b>"+esc(c.member_name)+"</b><span class=mut>"+esc(c.member_phone)+"</span><span class=mut>"+esc(c.branch||"")+"</span><span class=mut>"+won(c.total_amount)+"</span><span class=\\"tag "+esc(c.status)+"\\">"+esc(STATUS[c.status]||c.status)+"</span><span class=mut>"+dt(c.signed_at||c.created_at)+"</span></summary><div class=detail></div>";\n'
    + 'var body=d.querySelector(".detail");var done=false;\n'
    + 'd.addEventListener("toggle",function(){if(d.open&&!done){body.innerHTML=detail(c);done=true;}});\n'
    + 'root.appendChild(d);});\n'
    + 'if(!n)root.innerHTML="<p class=mut style=padding:12px>검색 결과 없음</p>";}\n'
    + 'document.getElementById("q").addEventListener("input",function(e){draw(e.target.value.trim());});\n'
    + 'draw("");\n'
    + '})();<\/script></body></html>';

  return head + renderer;
}

function renderBackupHint() {
  const el = $('backup-hint');
  if (!el) return;
  const last = localStorage.getItem('ng_last_backup');
  if (!last) { el.innerHTML = '<span style="color:var(--warn)">백업 이력 없음 — 월 1회 권장</span>'; return; }
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  el.textContent = '마지막 백업: ' + new Date(last).toLocaleDateString('ko-KR') + ' (' + days + '일 전)';
  if (days > 30) el.innerHTML += ' <span style="color:var(--warn)">— 새 백업 권장</span>';
}

$('btn-backup').onclick = async () => {
  const btn = $('btn-backup');
  btn.disabled = true;
  const orig = btn.textContent;
  try {
    btn.textContent = '데이터 수집 중...';
    const [contracts, signatures, audit, templates] = await Promise.all([
      fetchAll('contracts', 'created_at'),
      fetchAll('contract_signatures', 'signed_at'),
      fetchAll('contract_audit_log', 'id'),
      fetchAll('contract_templates', 'created_at')
    ]);
    if (!contracts.length) { alert('백업할 계약이 없습니다.'); return; }
    btn.textContent = '파일 생성 중...';
    const html = buildBackupHtml({
      exported_at: new Date().toISOString(),
      contracts, signatures, audit, templates
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nationalgym-계약백업-' + new Date().toISOString().slice(0, 10) + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
    localStorage.setItem('ng_last_backup', new Date().toISOString());
    renderBackupHint();
  } catch (e) {
    alert('백업 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
};

init();
renderBackupHint();
})();
