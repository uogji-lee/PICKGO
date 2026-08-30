# 🧭 PICKGO

친구들과 함께 여행 날짜 · 여행지 · 드레스코드를 정하는 웹앱입니다.

## 주요 기능

1. 닉네임 + 비밀번호로 간단 회원가입 / 로그인
2. 방 생성 후 초대코드로 친구 초대, 초대코드 입력으로 방 입장
3. 각자 캘린더에서 가능한 날짜 표시 → 가장 많은 인원이 가능한 날짜 자동 집계
4. 방장이 최다 인원 날짜 중 하나를 최종 여행일로 확정
5. 방장이 버튼 클릭 시 전국 인기 시/군/구 여행지 중 하나를 랜덤으로 추첨
6. 멤버 여행 취향을 집계해 TourAPI·카카오·네이버·Google 장소 데이터로 맛집·카페·체험 장소 추천
7. 당일치기부터 7박 8일까지 기간 선택, 장소 간 거리를 고려한 날짜별 맞춤 코스 생성
8. 여행 인원·차량 수·대중교통 여부와 숙소 위치를 반영해 이동 가능 반경, 방문 순서, 숙소 복귀 동선 구성
9. 멤버 각자 원하는 드레스코드 입력 → 방장이 여행지 추첨 시 드레스코드도 함께 랜덤 추첨
10. 방장이 언제든 방제(방 이름) 수정 가능

## 기술 스택

- Node.js + Express (백엔드 API 서버)
- better-sqlite3 (파일 기반 데이터베이스, 별도 DB 서버 불필요)
- 바닐라 HTML/CSS/JavaScript (프론트엔드, 별도 빌드 과정 없음)
- JWT 쿠키 기반 로그인 세션

## 로컬에서 실행하기

사전 준비: [Node.js](https://nodejs.org) 20 버전 이상 설치

```bash
cd pickgo
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속하면 바로 사용할 수 있습니다.
데이터는 `data/pickgo.db` 파일에 저장됩니다.

### 환경변수 (선택)

| 변수명 | 설명 | 기본값 |
| --- | --- | --- |
| `PORT` | 서버 포트 | `3000` |
| `PICKGO_JWT_SECRET` | 로그인 토큰 서명 비밀키 (배포 시 꼭 변경하세요) | 개발용 기본값 |
| `PICKGO_DB_PATH` | SQLite 파일 경로 | `data/pickgo.db` |
| `TOUR_API_SERVICE_KEY` | 한국관광공사 TourAPI 일반 인증키(Decoding 키 권장) | 미설정 시 기본 장소 데이터 사용 |
| `KAKAO_REST_API_KEY` | 카카오디벨로퍼스 앱의 REST API 키 | 미설정 시 맛집·카페·체험 검색 생략 |
| `KAKAO_JAVASCRIPT_KEY` | 카카오 지도 JavaScript 키 | 미설정 시 코스 지도 버튼 숨김 |
| `NAVER_CLIENT_ID` | 네이버 검색 API Client ID | 미설정 시 네이버 지역 검색 생략 |
| `NAVER_CLIENT_SECRET` | 네이버 검색 API Client Secret | 미설정 시 네이버 지역 검색 생략 |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) 키 | 미설정 시 Google 교차 검색 생략 |

### 맞춤 장소 추천 API 설정

1. `.env.example`을 `.env`로 복사
2. [공공데이터포털 국문 관광정보 서비스](https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15101578)에서 활용신청 후 Decoding 키를 `TOUR_API_SERVICE_KEY`에 입력
3. [카카오디벨로퍼스](https://developers.kakao.com/)에서 앱을 만들고 REST API 키를 `KAKAO_REST_API_KEY`에 입력
4. 필요할 때만 코스 지도를 펼쳐 보려면 같은 앱의 JavaScript 키를 `KAKAO_JAVASCRIPT_KEY`에 입력하고 `http://localhost:3000`을 JavaScript SDK 도메인으로 등록
5. [네이버 개발자센터](https://developers.naver.com/)에서 검색 API 애플리케이션을 등록하고 Client ID/Secret을 입력
6. Google Places는 [Google Cloud Console](https://console.cloud.google.com/)에서 Places API (New)와 결제를 활성화한 뒤 제한을 건 API 키를 입력
7. 서버 재시작 후 멤버들이 방에서 여행 취향을 최대 3개까지 선택
8. 여행 기간과 실제 인원, 차량 수 또는 대중교통, 숙소명·주소를 저장
9. 여행지 추첨 후 사용 가능한 제공자의 장소를 결합한 날짜별 코스를 확인

각 API가 설정되지 않았거나 일시적으로 응답하지 않으면 사용 가능한 데이터만으로 코스를 만들고, 모두 사용할 수 없으면 기존 지역별 명소를 표시합니다. REST API 비밀키는 브라우저로 전달되지 않으며 서버에서만 사용합니다. 카카오 JavaScript 키는 브라우저 SDK에서 사용하는 공개 키이므로 카카오디벨로퍼스에서 허용 도메인을 꼭 제한해야 합니다. Google Places 결과는 Google Maps 출처와 원본 링크를 유지하고 카카오 코스 지도에는 표시하지 않습니다.

## 친구들과 실제로 같이 쓰려면 (배포)

로컬 `localhost`는 내 컴퓨터에서만 열리므로, 친구들과 함께 쓰려면 인터넷에 배포해야 합니다.
이 앱은 SQLite **파일**에 데이터를 저장하므로, 파일이 계속 유지되는(디스크가 리셋되지 않는) 호스팅이 필요합니다. Vercel 같은 서버리스 플랫폼은 파일이 저장되지 않으니 피해주세요.

### 추천: Railway (가장 쉬움)

1. [railway.app](https://railway.app) 가입 (GitHub 계정으로 가능)
2. 이 프로젝트 폴더를 GitHub 저장소로 업로드
3. Railway에서 "New Project" → "Deploy from GitHub repo" 선택
4. 환경변수에 `PICKGO_JWT_SECRET` 을 임의의 긴 문자열로 설정
5. "Volumes" 기능으로 `/app/data` 경로에 볼륨(디스크) 하나 추가 (DB 파일 유지를 위해 필수)
6. 배포 완료 후 생성된 URL을 친구들에게 공유하면 끝!

### 대안: Render, Fly.io

- Render: "Web Service"로 배포 + "Disks"에서 `/opt/render/project/src/data` 경로에 디스크 추가
- Fly.io: `fly volumes create` 로 볼륨 생성 후 `fly.toml`에서 `data` 폴더에 마운트

### 직접 서버(VPS)에 올리는 경우

```bash
git clone <저장소>
cd pickgo
npm install
PICKGO_JWT_SECRET=원하는-비밀키 npm start
```

`pm2`나 `systemd`로 상시 실행되게 등록하고, Nginx 등으로 도메인을 연결하면 됩니다.

--> 비용 문제로 Cloudflare Tunnel 사용



## 폴더 구조

```
pickgo/
├── server.js          # Express 서버 & API
├── db.js              # SQLite 초기화 및 스키마
├── data/
│   └── regions.js     # 전국 인기 시/군/구 여행지 + 명소/즐길거리 데이터
└── public/            # 프론트엔드 (정적 파일)
    ├── index.html
    ├── style.css
    └── js/app.js
```

## 사용 방법 한눈에 보기

1. 닉네임/비밀번호로 회원가입 후 로그인
2. "방 만들기"에서 방제 입력 후 생성 → 초대코드 확인
3. 친구들에게 초대코드 공유 → 친구들은 회원가입/로그인 후 "초대코드로 입장"
4. 모두가 캘린더에서 가능한 날짜 표시 + 원하는 드레스코드 입력
5. 방장이 실제 여행 인원·교통수단·숙소와 최종 날짜를 확정
6. 인원이 다 모이면 방장이 "추첨하기" 클릭 → 랜덤 여행지 + 드레스코드 + 교통 조건별 맞춤 코스 확인
7. 필요할 때 후보 장소와 카카오 코스 지도를 펼쳐 세부 장소 확인
8. 다 같이 떠나면 끝! ✈️

## 참고 / 한계

- 소규모(친구 단위) 사용을 위한 심플한 구현입니다. 대규모 트래픽 대비 최적화는 되어 있지 않습니다.
- 비밀번호는 bcrypt로 안전하게 해시되어 저장됩니다.
- 지역 추첨 범위는 전국 250여개 시/군/구 전체가 아니라, 실제 여행지로 인기 있는 시/군/구(약 45곳)를 엄선한 목록입니다.
