# 푸른하늘 — 탄소 절약 내비게이션

팀 아우름(이원우, 임해인) · ESG(E) 문제해결 서비스형 프로젝트

출발지와 도착지를 검색하면 실제 경로를 찾아 **많이 / 중간 / 약간 절약** 단계로 나눠 추천하고,
휴대폰 GPS로 내 위치를 따라가며 안내하는 모바일 웹앱이에요. HTML · CSS · JS 만으로 만들었어요.

## 파일 구성

```
pureun-haneul/
├─ index.html   ← 뼈대 (거의 고칠 일 없음)
├─ style.css    ← 디자인 (색, 글꼴, 크기)
├─ app.js       ← 기능 전체 (데이터, 계산, 지도, 화면)
├─ config.js    ← API 키 넣는 곳
├─ server.js    ← 실행 서버 + 네이버 비밀키 중계 (설치 필요 없음)
├─ private/
│  └─ keys.json ← 비밀키 (Client Secret) — 서버만 읽어요
└─ public/      ← 앱 아이콘, 홈 화면 추가 정보
```

## 화면 구성 (네이버 지도 길찾기 방식)

1. **홈**: 지도 위에 출발·도착 입력칸. 장소를 검색해 고르면 바로 경로 목록으로 넘어가요.
2. **경로 목록**: 위에는 지도(고른 경로를 실제 노선 색으로 표시), 아래에는 경로 카드
   - 탭: **조금 절약 · 중간 절약 · 많이 절약** (혼자 자동차보다 탄소를 1~69% / 70~96% / 97% 이상 줄이는 경로)
   - 카드: 총 시간, 도착 시각, 요금, 탄소량, 구간별 시간 막대, **대중교통·도보·자차 시간**, 노선과 정류장
   - 정렬(빠른 순·탄소 적은 순·덜 걷는 순·환승 적은 순), 도보 거리, 자전거·자차 사용 여부로 거르기
3. **실시간 안내**: GPS로 내 위치를 따라가며 다음 안내로 자동으로 넘어가요.
4. **도착**: 아낀 탄소량을 보여줘요.

절약 단계마다 나오는 경로 종류가 달라요.
- 조금 절약: 자차로 지하철역까지 간 뒤 지하철 타기, 여럿이 함께 차 타기
- 중간 절약: 버스가 들어간 대중교통 경로
- 많이 절약: 지하철 위주 경로, 자전거, 걷기

## 실행하기

> `index.html` 을 더블클릭해서 열면 지도가 뜨지 않아요.
> 네이버·카카오는 **등록한 주소(`http://localhost:5173`)** 에서만 지도를 보여주기 때문이에요.

### VS Code에서 Live Server로 열기 (가장 간단)

1. VS Code → **파일 → 폴더 열기** → `pureun-naver` 폴더 선택
2. 오른쪽 아래 확장 추천이 뜨면 **Live Server 설치** (또는 확장 탭에서 "Live Server" 검색)
3. `index.html` 을 열고 오른쪽 아래 **Go Live** 클릭 (또는 index.html 우클릭 → **Open with Live Server**)
4. 브라우저에 `http://localhost:5173` 이 열려요 (포트는 `.vscode/settings.json` 에 맞춰 둠)

Live Server는 파일만 보여주는 서버라서 **server.js 기능은 꺼져요**:
카카오 로그인은 체험용, 네이버 자동차 길찾기·장소 이름 검색·도로명주소 검색 중계는 안 돼요.
(지도, ODsay 대중교통 길찾기, 주소 검색, 탄소 계산, 안내 화면은 그대로 돼요)
전부 쓰려면 아래 방법(맥: `START.command`, 윈도우: `START.bat`)으로 실행해요.

### 맥: `START.command` 더블클릭

처음 한 번은 "확인되지 않은 개발자" 경고가 뜰 수 있어요 → 파일 우클릭 → **열기** → 열기.
터미널 창은 앱을 쓰는 동안 닫지 마세요.

### 윈도우: `START.bat` 더블클릭

폴더 안의 **START.bat** 을 더블클릭하면 서버가 켜지고 브라우저가 자동으로 열려요.
검은 창은 앱을 쓰는 동안 닫지 마세요. (닫으면 앱도 꺼져요)

### 방법 1. node 로 실행

VS Code에서 이 폴더를 열고 **터미널 → 새 터미널** 에서:

```bash
node server.js
```

`http://localhost:5173` 을 Ctrl + 클릭해서 열어요. 끌 때는 `Ctrl + C`.

### 방법 2. VS Code 확장 Live Server

1. 확장(Extensions)에서 **Live Server** 를 설치해요. (폴더를 열면 설치 추천이 떠요)
2. `index.html` 을 열고 오른쪽 아래 **Go Live** 를 눌러요.
3. 포트는 `.vscode/settings.json` 에 5173 으로 맞춰 뒀어요.

### 휴대폰 크기로 보기

브라우저에서 **F12 → Ctrl + Shift + M** 을 누르고 위쪽에서 iPhone·Galaxy를 골라요.

## 비밀키 넣기 (`private/keys.json`)

Client Secret처럼 **남에게 보이면 안 되는 키**는 `config.js`가 아니라 `private/keys.json`에 넣어요.
`server.js`만 이 파일을 읽고, 브라우저로는 절대 보내지 않아요. (`.gitignore`에 들어 있어 GitHub에도 안 올라가요)

| 항목 | 하는 일 | 어디서 받나요 |
|---|---|---|
| `NAVER_CLOUD_CLIENT_ID` / `NAVER_CLOUD_CLIENT_SECRET` | 네이버 **자동차 길찾기** (Directions 5) | 네이버 클라우드 Maps Application → 인증 정보 |
| `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` | 네이버 **장소 이름 검색** | [네이버 개발자센터](https://developers.naver.com) → 애플리케이션 등록 → 사용 API "검색" |
| `JUSO_CONFM_KEY` | 행정안전부 **도로명주소 검색** (건물명·도로명·지번, 전국 공식 주소) | [도로명주소 개발자센터](https://business.juso.go.kr) → 검색 API 승인키 |

| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | **카카오 로그인** | [카카오 디벨로퍼스](https://developers.kakao.com/console/app) → 앱 → 플랫폼 키 → REST API 키 (아래 "카카오 로그인 켜기") |

`node server.js` 를 실행하면 터미널에 어떤 중계 기능이 켜졌는지 표시돼요.

### 장소·건물·가게 이름으로 검색하기 (카카오 장소 검색)

`config.js` 의 `KAKAO_JS_KEY` 에 카카오 JavaScript 키가 들어 있어요. 카카오 콘솔에서 두 가지만 켜면 돼요.

1. **[카카오맵] → [사용 설정]** 상태를 **ON**
2. **[앱] → [플랫폼 키] → [JavaScript 키]** → **JavaScript SDK 도메인** 에 `http://localhost:5173` 등록
   (배포하면 그 https 주소도 추가)

검색칸에 한 글자만 입력해도 관련 장소·건물·가게·지역이 바로 떠요.
도착지를 찾을 때는 출발지 근처, 출발지를 찾을 때는 도착지 근처를 먼저 보여줘요.
Live Server로 열어도 동작해요 (server.js 필요 없음).

### 카카오 로그인 켜기

1. [카카오 디벨로퍼스](https://developers.kakao.com/console/app) 에 카카오 계정으로 로그인 → **앱 만들기** (이름: 푸른하늘)
2. **[앱] → [플랫폼 키] → [REST API 키]** 를 열어요
   - 키 값을 복사해 `KAKAO_REST_API_KEY` 에 넣어요
   - 같은 화면의 **카카오 로그인 리다이렉트 URI** 에 `http://localhost:5173/auth/kakao` 를 등록해요 (글자 하나라도 다르면 KOE006 오류)
   - **클라이언트 시크릿** 값을 복사해 `KAKAO_CLIENT_SECRET` 에 넣어요 (꺼져 있으면 비워 둬도 돼요)
3. **[카카오 로그인] → [일반]** 에서 **사용 설정** 을 ON
4. **[카카오 로그인] → [동의항목]** 에서 **닉네임** 을 "필수 동의"로 설정 (앱에서 이름을 보여주려고)
5. `private/keys.json` 저장 → START.bat 다시 실행 → 검은 창에 `카카오 로그인: 켜짐` 이 보이면 끝

키를 넣기 전에는 카카오 버튼을 누르면 체험용으로 바로 로그인돼요.
휴대폰에서 쓰려고 https 주소로 배포할 때는 그 주소의 `/auth/kakao` 도 리다이렉트 URI에 추가하고, `KAKAO_REDIRECT_URI` 에 그 주소를 넣어요.
(Netlify 처럼 파일만 올리는 곳에서는 server.js 가 돌지 않아 카카오 로그인이 안 돼요. Render 같은 Node 서버 호스팅이 필요해요.)

※ 도로명주소 검색 결과에는 좌표가 없어서, 결과를 고르면 네이버(또는 카카오) 주소 변환으로 위치를 찾아요.

## API 키 넣기 (`config.js`)

| 항목 | 하는 일 | 어디서 받나요 | 없으면 |
|---|---|---|---|
| `NAVER_MAP_KEY_ID` | 지도 화면, 주소 검색 | [네이버 클라우드 플랫폼](https://console.ncloud.com) → Maps → Application 등록 → **Client ID** | 지도를 카카오로 표시 |
| `KAKAO_JS_KEY` | 장소 이름 검색(강남역, ○○중학교) | [카카오 개발자](https://developers.kakao.com) → 앱 → 플랫폼 키 → **JavaScript 키** | 네이버 주소 검색만 가능 |
| `KAKAO_REST_KEY` | 자동차 실제 경로 | 같은 카카오 앱의 **REST API 키** | 자동차 경로를 추정 |
| `ODSAY_KEY` | 버스·지하철 실제 경로 | [ODsay LAB](https://lab.odsay.com) → 애플리케이션 → **Web 키** | 대중교통 경로를 추정 |

- 지도 키는 **네이버·카카오 중 하나만 있어도** 돼요. 둘 다 넣으면 지도는 네이버, 장소 이름 검색은 카카오를 써요.
- 키가 하나도 없으면 거리만 넣어 보는 **체험 모드**로 열려요.
- 키를 바꾼 뒤에는 브라우저를 **새로고침**하면 돼요.

### ODsay 하루 호출 수 (Basic 요금제: 하루 30건)
- 출발·도착을 정해 경로를 찾을 때 **1건**, "안내 시작"을 누를 때 노선 모양을 불러오느라 **1건**을 써요.
- 경로 카드를 눌러 보거나 탭을 바꾸는 건 호출하지 않아요.
- 같은 날 같은 출발·도착은 저장해 둔 결과를 다시 써서 호출하지 않아요.
- 더 필요하면 ODsay LAB 애플리케이션 화면의 "서비스 업그레이드 문의"를 이용해요.

### 주소(도메인) 등록 — 안 하면 지도가 안 떠요

- 네이버: Maps Application의 **Web 서비스 URL** 에 **포트 없이** `http://localhost` 등록 (`http://localhost:5173` 처럼 포트를 붙이면 인증 실패), 사용할 API로 **Dynamic Map** 과 **Geocoding** 선택
- 카카오: JavaScript 키의 **JavaScript SDK 도메인** 에 `http://localhost:5173` 등록
- ODsay: 애플리케이션에 사용할 주소(URI) 등록

## 휴대폰에서 쓰기

휴대폰 브라우저는 **https 주소에서만 GPS(현재 위치)를 허용**해요.

1. 이 폴더를 GitHub에 올리거나, [Netlify Drop](https://app.netlify.com/drop) 에 폴더를 끌어다 놓아 배포해요.
2. 생긴 https 주소를 네이버 Web 서비스 URL, 카카오 JavaScript SDK 도메인, ODsay URI 에 등록해요.
3. 휴대폰에서 그 주소를 열고 **홈 화면에 추가** 하면 앱처럼 쓸 수 있어요.

※ `config.js` 의 키는 누구나 볼 수 있어요. 대회 시연용으로는 괜찮지만, 공개 서비스로 키울 때는 서버를 거치게 바꾸는 게 좋아요.

## 자주 고치는 곳

| 바꾸고 싶은 것 | 파일 | 찾을 곳 |
|---|---|---|
| 배출계수(g/km), 출처 문구 | `app.js` | `FACTORS`, `FACTOR_SOURCE` |
| 절약 단계 기준(97% / 70%) | `app.js` | `TIERS` |
| 화면 문구 | `app.js` | `8. 화면(HTML) 만들기` |
| 색 | `style.css` | 맨 위 `:root` |

## 배출계수 출처

서울시 자료(그린피스 코리아 인용), 1인 1km 이동 기준: 승용차 210g · 버스 27.7g · 지하철 1.53g
