// db/schema.sql → api/_schema.cjs (서버가 실행할 문장 목록) 로 바꿔요.  실행: node db/build-schema.cjs
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const stmts = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
fs.writeFileSync(path.join(__dirname, '..', 'api', '_schema.cjs'),
  `// 자동 생성: db/schema.sql 을 고치면 \`node db/build-schema.cjs\` 로 다시 만들어요.\n// 앱이 처음 DB를 쓸 때 이 문장들을 차례로 실행해서 표·뷰를 만들어요.\nmodule.exports = ${JSON.stringify(stmts, null, 2)};\n`);
console.log(`${stmts.length}개 문장`);
