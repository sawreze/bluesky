// =====================================================================
//  인증 코드 메일 보내기 (Gmail SMTP, 추가 패키지 없이 Node 기본 tls 로)
//  Vercel 환경 변수에 두 개만 넣으면 켜져요:
//    GMAIL_USER          보내는 지메일 주소 (예: bluesky.app@gmail.com)
//    GMAIL_APP_PASSWORD  그 계정의 "앱 비밀번호" 16자리 (구글 계정 > 보안 > 2단계 인증 > 앱 비밀번호)
//  둘 중 하나라도 없으면 메일을 못 보내니까, 인증 코드를 화면에 보여 주는 "시연 모드"로 동작해요.
// =====================================================================
const tls = require('tls');
const net = require('net');

const cfg = () => ({
  user: String(process.env.GMAIL_USER || '').trim(),
  pass: String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
});
const configured = () => { const c = cfg(); return !!(c.user && c.pass); };

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encWord = (s) => `=?UTF-8?B?${b64(s)}?=`; // 한글 제목·이름
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

// SMTP 대화: 한 줄 보내고, 서버 응답 코드가 기대한 값인지 확인
function smtpSend({ host, port, user, pass, from, to, raw, plain = false, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const sock = plain ? net.connect(port, host) : tls.connect({ host, port, servername: host, rejectUnauthorized: !process.env.SMTP_INSECURE });
    sock.setEncoding('utf8');
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error('메일 서버 응답이 없어요.')); });
    sock.on('error', reject);
    let buf = '';
    const steps = [
      [null, '220'],
      ['EHLO pureun.app', '250'],
      ['AUTH LOGIN', '334'],
      [b64(user), '334'],
      [b64(pass), '235'],
      [`MAIL FROM:<${from}>`, '250'],
      [`RCPT TO:<${to}>`, '250'],
      ['DATA', '354'],
      [`${raw.replace(/\r\n\./g, '\r\n..')}\r\n.`, '250'],
      ['QUIT', '221'],
    ];
    let i = 0;
    const next = () => {
      i += 1;
      if (i >= steps.length) { sock.end(); return resolve(true); }
      sock.write(`${steps[i][0]}\r\n`);
    };
    sock.on('data', (d) => {
      buf += d;
      // 여러 줄 응답(250-...)은 마지막 줄(250 ...)까지 기다려요
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last) || !buf.endsWith('\r\n')) return;
      buf = '';
      const code = last.slice(0, 3);
      if (code !== steps[i][1]) {
        sock.destroy();
        return reject(new Error(code === '535' ? '메일 계정 로그인에 실패했어요 (앱 비밀번호 확인).' : `메일 서버 오류 ${last.slice(0, 120)}`));
      }
      next();
    });
  });
}

function buildMail({ from, to, subject, text, html }) {
  const boundary = `pureun-${Date.now().toString(36)}`;
  return [
    `From: ${encWord('푸른하늘')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@pureun.app>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)).trimEnd(),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)).trimEnd(),
    `--${boundary}--`,
  ].join('\r\n');
}

function codeMail(code, purpose) {
  const what = purpose === 'signup' ? '회원가입' : '로그인';
  const subject = `[푸른하늘] ${what} 인증 코드 ${code}`;
  const text = `푸른하늘 ${what} 인증 코드: ${code}\n\n10분 안에 앱에 입력해 주세요.\n직접 요청하지 않았다면 이 메일은 무시해도 돼요. 코드를 다른 사람에게 알려 주지 마세요.`;
  const html = `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:420px;margin:0 auto;padding:28px 24px;border-radius:20px;background:#F1F8FE;color:#1E2A44">
  <p style="margin:0 0 6px;font-size:14px;color:#1976D2;font-weight:700">☁️ 푸른하늘</p>
  <h1 style="margin:0 0 18px;font-size:20px">${what} 인증 코드</h1>
  <p style="margin:0 0 10px;font-size:15px">아래 6자리 코드를 앱에 입력해 주세요.</p>
  <p style="margin:0 0 18px;padding:16px 0;border-radius:14px;background:#fff;text-align:center;font-size:34px;font-weight:800;letter-spacing:10px;color:#0050F5">${code}</p>
  <p style="margin:0;font-size:13px;color:#5B6B82;line-height:1.6">코드는 10분 동안만 쓸 수 있어요.<br>직접 요청하지 않았다면 이 메일은 무시해도 돼요. 코드를 다른 사람에게 알려 주지 마세요.</p>
</div>`;
  return { subject, text, html };
}

// 보내기: 성공 { sent: true } · 설정 전 { demo: true }
async function sendCode(to, code, purpose) {
  if (module.exports._send) { await module.exports._send(to, code, purpose); return { sent: true }; } // 테스트용
  if (!configured()) return { demo: true };
  const c = cfg();
  const m = codeMail(code, purpose);
  await smtpSend({ ...c, from: c.user, to, raw: buildMail({ from: c.user, to, ...m }), plain: !!process.env.SMTP_PLAIN });
  return { sent: true };
}

module.exports = { sendCode, configured, buildMail, codeMail, smtpSend, _send: null };
