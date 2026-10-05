// 이메일 인증 코드 확인 · 다시 받기
const db = require('../_db.cjs');
const u = require('../_users.cjs');
module.exports = u.wrap(u.code, db);
