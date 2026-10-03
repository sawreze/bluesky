// /api/data?a=… — 앱 데이터 (자세한 건 _data.cjs)
module.exports = require('./_data.cjs')(require('./_db.cjs'));
