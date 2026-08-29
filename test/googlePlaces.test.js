const test = require('node:test');
const assert = require('node:assert/strict');

const { createGooglePlacesClient } = require('../services/googlePlaces');

test('Google Places가 최소 필드 마스크로 장소를 검색하고 출처 링크를 유지한다', async () => {
  const requests = [];
  const client = createGooglePlacesClient({
    apiKey: 'google-api-key',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          places: [{
            id: 'place-1',
            displayName: { text: '행궁동 테스트 장소' },
            formattedAddress: '경기도 수원시 팔달구 테스트로 1',
            location: { longitude: 127.01, latitude: 37.28 },
            primaryTypeDisplayName: { text: '카페' },
            googleMapsUri: 'https://maps.google.com/?cid=1',
          }],
        }),
      };
    },
  });

  const places = await client.getPersonalizedPlaces('경기 수원시', { activity: 1 });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(requests[0].options.headers['X-Goog-Api-Key'], 'google-api-key');
  assert.match(requests[0].options.headers['X-Goog-FieldMask'], /places\.googleMapsUri/);
  assert.doesNotMatch(requests[0].options.headers['X-Goog-FieldMask'], /reviews|rating/);
  assert.equal(places[0].sourceLabel, 'Google Maps');
  assert.equal(places[0].placeUrl, 'https://maps.google.com/?cid=1');
});
