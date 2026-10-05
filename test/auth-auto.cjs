// 테스트 도우미: 메일 대신 인증 코드를 여기 모아 두고,
//  가입·로그인이 "코드 필요"로 오면 받은 코드로 바로 인증까지 해 줘요 (인증 코드 자체는 auth-code.test.cjs 에서 따로 확인)
const mail = require('../api/_mail.cjs');
const db = require('../api/_db.cjs');
const outbox = [];
mail._send = async (to, code, purpose) => { outbox.push({ to, code, purpose }); };
module.exports = (raw, { relax = true } = {}) => {
  if (relax) Object.assign(db.CODE_LIMIT, { resendSec: 0, perEmailHour: 100000, perIpHour: 100000 });
  const code = require('../api/auth/code.js');
  const login = require('../api/auth/login.js');
  const signup = require('../api/auth/signup.js');
  const call = async (h, opt = {}) => {
    const r = await raw(h, opt);
    if ((h === login || h === signup) && r.statusCode === 200 && r.body && r.body.needCode) {
      const last = outbox[outbox.length - 1];
      return raw(code, { method: 'POST', body: { a: 'verify', ticket: r.body.ticket, code: last.code, remember: (opt.body || {}).remember !== false }, headers: opt.headers });
    }
    return r;
  };
  return { call, outbox };
};
