// db/schema.sql → api/_schema.cjs (서버가 실행할 문장 목록) 로 바꿔요.  실행: node db/build-schema.cjs
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const stmts = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
// 한 문장 안에 명령이 둘 이상 들어가면 Neon(진짜 DB)이 거부해요. (예: 'ALTER ...; -- 설명' 처럼 ; 뒤에 같은 줄 주석)
//  DO 블록($$ … $$) 밖에서 ; 가 문장 중간에 있으면 여기서 멈춰요.
stmts.forEach((s, i) => {
  const outside = s.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '').replace(/'(?:[^']|'')*'/g, "''");
  if (/;/.test(outside)) throw new Error(`${i}번 문장에 ; 가 두 번 이상 있어요 (같은 줄 주석을 따로 줄로 빼 주세요):\n${s.slice(0, 200)}`);
});
fs.writeFileSync(path.join(__dirname, '..', 'api', '_schema.cjs'),
  `// 자동 생성: db/schema.sql 을 고치면 \`node db/build-schema.cjs\` 로 다시 만들어요.\n// 앱이 처음 DB를 쓸 때 이 문장들을 차례로 실행해서 표·뷰를 만들어요.\nmodule.exports = ${JSON.stringify(stmts, null, 2)};\n`);
console.log(`${stmts.length}개 문장`);
