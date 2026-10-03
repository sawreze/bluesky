// 공개 주소는 /auth/kakao (vercel.json 의 rewrites 가 여기로 보내요)
module.exports = require('../_respond.cjs').makeHandler('/auth/kakao');
