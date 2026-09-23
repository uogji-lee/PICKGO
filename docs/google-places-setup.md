# Google Places 연결 준비

현재 Google은 추천 코스에 연결하지 않으며 자동 과금 요청도 보내지 않습니다.
기존 `services/googlePlaces.js` 클라이언트와 모의 테스트를 재사용합니다.

1. Google Cloud 프로젝트에서 결제 계정 연결 여부와 비용을 직접 확인합니다.
2. **Places API (New)**만 활성화합니다. OAuth 로그인 키가 아니라 서버 API 키가 필요합니다.
3. 키의 API 제한을 Places API (New)로 지정하고, 배포 후 서버의 고정 송신 IP로 제한합니다. 브라우저 코드나 Git에 키를 넣지 않습니다.
4. `.env`의 `GOOGLE_PLACES_API_KEY`에 설정합니다. 키 입력만으로는 현재 추천 기능에서 호출하지 않습니다.
5. 콘솔에서 할당량과 예산 알림을 설정합니다. 예산 알림만으로 지출이 자동 차단되지는 않습니다.
6. 실제 연결 전 별도 Google 검색 화면과 출처 표기를 구현·검증합니다. Google 결과를 카카오 지도에 표시하거나 현재 코스 JSON에 영구 저장하지 않습니다.

지도 없이 결과를 보여줄 때도 Google Maps 출처 표시가 필요하며, 비Google 지도와의 결합 및 캐싱 제한을 확인해야 합니다. 따라서 기존 카카오 지도 코스와 단순 병합하지 않는 구조로 준비합니다.

공식 문서:
- https://developers.google.com/maps/documentation/places/web-service/get-api-key
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/billing-and-pricing/manage-costs
