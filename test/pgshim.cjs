// 테스트 전용: neon 드라이버 대신 psql 로 진짜 Postgres 에 보내요 (값은 SQL 문자열로 안전하게 감싸요)
const { execFileSync } = require('child_process');
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? "'true'" : "'false'";
  if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};
function run(text, params = []) {
  // 진짜 Neon 처럼: 한 번에 명령 하나만 (DO 블록 $$…$$ 과 문자열 안의 ; 는 괜찮아요)
  const bare = String(text).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '').replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
  if (/;\s*\S/.test(bare)) return Promise.reject(new Error('cannot insert multiple commands into a prepared statement'));
  const q = text.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
  let wrapped = q;
  if (/^\s*with\b/i.test(q)) {
    // 맨 바깥 마지막 SELECT 를 찾아서 CTE 하나로 감싸요 (데이터 바꾸는 WITH 는 안쪽에 못 넣어서)
    let depth = 0, quote = false, last = -1;
    for (let i = 0; i < q.length; i++) {
      const ch = q[i];
      if (ch === "'") quote = !quote;
      if (quote) continue;
      if (ch === '(') depth++; else if (ch === ')') depth--;
      else if (depth === 0 && /select/i.test(q.slice(i, i + 6)) && !/\w/.test(q[i - 1] || ' ')) last = i;
    }
    wrapped = `${q.slice(0, last).trimEnd()}, __f AS (${q.slice(last)}) SELECT coalesce(json_agg(__f), '[]') FROM __f`;
  } else if (/^\s*select\b/i.test(q) || (/^\s*(insert|update|delete)\b/i.test(q) && /\breturning\b/i.test(q))) {
    wrapped = `WITH __r AS (${q}) SELECT coalesce(json_agg(__r), '[]') FROM __r`;
  }
  try {
    const out = execFileSync('psql', ['-h', 'localhost', '-U', 'postgres', '-d', process.env.TESTDB || 'pureun_app', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
      { env: { ...process.env, PGPASSWORD: 'test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (wrapped === q) return Promise.resolve([]);
    return Promise.resolve(JSON.parse(out || '[]'));
  } catch (e) {
    const msg = String(e.stderr || e.message);
    const err = new Error(msg.replace(/^.*ERROR:\s*/s, '').split('\n')[0]);
    if (/duplicate key/.test(msg)) err.code = '23505';
    return Promise.reject(err);
  }
}
module.exports = function makeSql() {
  const sql = (strings, ...vals) => run(strings.reduce((a, s, i) => a + '$' + i + s), vals);
  sql.query = (text, params) => run(text, params);
  return sql;
};
