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
  assert.equal(new URL(requests[0].url).origin, 'https://naverapihub.apigw.ntruss.com');
  assert.equal(new URL(requests[0].url).pathname, '/search/v1/local');
  assert.equal(requests[0].options.headers['X-NCP-APIGW-API-KEY-ID'], 'naver-client-id');
  assert.equal(requests[0].options.headers['X-NCP-APIGW-API-KEY'], 'naver-client-secret');
  assert.equal(requests[0].options.headers['X-Naver-Client-Secret'], undefined);
  assert.match(requests[0].url, /sort=comment/);
  assert.equal(places[0].name, '행궁동 카페');
  assert.equal(places[0].source, 'naver');
});

test('숙소 정확도순 검색은 추천 리뷰순 검색과 캐시를 분리한다', async () => {
  const orders = [];
  const client = createNaverLocalClient({
    clientId: 'test-id', clientSecret: 'test-secret',
    fetchImpl: async url => {
      const sort = new URL(url).searchParams.get('sort');
      orders.push(sort);
      return {ok: true, json: async () => ({items: [{title: sort}]})};
    },
  });
  assert.equal((await client.searchLocal('숙소'))[0].title, 'comment');
  assert.equal((await client.searchLocal('숙소', {sort: 'random'}))[0].title, 'random');
  await client.searchLocal('숙소', {sort: 'random'});
  await client.searchLocal('숙소');
  assert.deepEqual(orders, ['comment', 'random']);
});

test('네이버 제목 HTML과 확대 좌표를 정규화한다', () => {
  assert.equal(stripHtml('<b>카페&amp;바</b>'), '카페&바');
  assert.equal(normalizeCoordinate('1270123456', 180), '127.0123456');
});
