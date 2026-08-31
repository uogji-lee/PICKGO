const test = require('node:test');
const assert = require('node:assert/strict');

const { createKakaoLocalClient } = require('../services/kakaoLocal');

test('카카오 로컬 API에 REST 키를 헤더로 보내고 장소를 정규화한다', async () => {
  const requests = [];
  const client = createKakaoLocalClient({
    restApiKey: 'secret-rest-key',
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      const parsed = new URL(url);
      const keyword = parsed.searchParams.get('query');
      const categoryCode = parsed.searchParams.get('category_group_code') || '';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          documents: [{
            id: `${requests.length}`,
            place_name: `${keyword} 결과`,
            category_group_code: categoryCode,
            category_group_name: categoryCode === 'FD6' ? '음식점' : categoryCode === 'CE7' ? '카페' : '관광명소',
            road_address_name: '서울 종로구 테스트로 1',
            x: '126.98',
            y: '37.57',
            place_url: `https://place.map.kakao.com/${requests.length}`,
            distance: '1250',
          }],
        }),
      };
    },
  });

  const places = await client.getPersonalizedPlaces(
    '서울 종로구',
    { culture: 2 },
    { mapX: '126.98', mapY: '37.57' },
    [{ keyword: '반려동물 동반', votes: 2 }]
  );
  assert.equal(requests.length, 4);
  assert.equal(requests[0].options.headers.Authorization, 'KakaoAK secret-rest-key');
  assert.match(requests[0].url, /query=/);
  assert.match(requests[0].url, /radius=20000/);
  assert.equal(places[0].source, 'kakao');
  assert.equal(places.some(place => place.categoryCode === 'FD6'), true);
  assert.equal(places.some(place => place.categoryCode === 'CE7'), true);
  assert.equal(places.some(place => place.customKeyword === '반려동물 동반'), true);
});
