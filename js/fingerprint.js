// 디바이스 핑거프린트 (PIPA 최소수집 원칙 — 원본값 저장하지 않고 hash 만)
(function () {
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function compute() {
    const parts = [
      navigator.userAgent || '',
      navigator.language || '',
      navigator.languages ? navigator.languages.join(',') : '',
      screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || ''),
      window.devicePixelRatio || '',
      (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '',
      navigator.platform || '',
      navigator.maxTouchPoints || ''
    ];
    try { return await sha256(parts.join('||')); }
    catch (e) { return ''; }
  }
  window.ngFingerprint = compute;
})();
