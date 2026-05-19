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

init();
})();
