// 시연용 휴대폰 틀: 화면 크기에 맞춰 휴대폰을 키우고 줄이고, 상태 표시줄 시계를 맞춰요
(function () {
  const phone = document.getElementById('phone');
  const W = 420; const H = 874; // .phone 크기 (demo.css)
  function fit() {
    const pad = Math.max(16, Math.min(window.innerWidth, window.innerHeight) * 0.03);
    const s = Math.min((window.innerHeight - pad * 2) / H, (window.innerWidth - pad * 2) / W);
    phone.style.transform = `scale(${Math.max(0.3, s).toFixed(4)})`;
  }
  fit();
  window.addEventListener('resize', fit);
  // 시계: 실제 시각 (12시간제, 예: 9:41)
  const time = document.getElementById('time');
  function tick() { const d = new Date(); time.textContent = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; }
  tick(); setInterval(tick, 10000);
  // 전체화면 버튼 (브라우저 주소창 · 탭까지 숨겨요)
  const fs = document.getElementById('fs');
  fs.addEventListener('click', () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); });
  document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('fs', !!document.fullscreenElement); setTimeout(fit, 50); });
  // 처음에 앱을 눌러 바로 쓸 수 있게 휴대폰 화면으로 초점을 옮겨요
  const app = document.getElementById('app');
  app.addEventListener('load', () => { try { app.contentWindow.focus(); } catch (e) { /* 무시 */ } });
})();
