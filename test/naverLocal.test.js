const test = require('node:test');
const assert = require('node:assert/strict');

const { createNaverLocalClient, normalizeCoordinate, stripHtml } = require('../services/naverLocal');

test('네이버 지역 검색이 인증 헤더와 리뷰순 정렬을 사용한다', async () => {
  const requests = [];
  const client = createNaverLocalClient({
    clientId: 'naver-client-id',
    clientSecret: 'naver-client-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            title: '<b>행궁동 카페</b>',
            category: '음식점>카페,디저트',
            roadAddress: '경기도 수원시 팔달구 테스트로 1',
            mapx: '1270123456',
            mapy: '372345678',
            link: 'https://map.naver.com/p/entry/place/1',
          }],
        }),
      };
    },
  });

  const places = await client.getPersonalizedPlaces('경기 수원시', { activity: 2 });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers['X-Naver-Client-Id'], 'naver-client-id');
  assert.equal(requests[0].options.headers['X-Naver-Client-Secret'], 'naver-client-secret');
  assert.match(requests[0].url, /sort=comment/);
  assert.equal(places[0].name, '행궁동 카페');
  assert.equal(places[0].source, 'naver');
});

test('네이버 제목 HTML과 확대 좌표를 정규화한다', () => {
  assert.equal(stripHtml('<b>카페&amp;바</b>'), '카페&바');
  assert.equal(normalizeCoordinate('1270123456', 180), '127.0123456');
});
