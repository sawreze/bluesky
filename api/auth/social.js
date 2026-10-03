const db = require('../_db.cjs');
const u = require('../_users.cjs');
module.exports = u.wrap(u.social, db);
