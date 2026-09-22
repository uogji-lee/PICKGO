const {test} = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {registerAccommodation,verifyAccommodation} = require('../services/accommodation');
test('숙소 검색 좌표는 네이버 결과로 서명하며 사용자·여행·방이 달라지면 거부한다',async()=>{
  let handler;
  const room={id:1,active_trip_id:2,host_user_id:3};
  registerAccommodation({get:(path,auth,fn)=>handler=fn},{auth:()=>{},getRoomOr404:()=>room,secret:'test-secret',naverLocal:{searchLocal:async()=>[
    {title:'<b>숙소</b>',roadAddress:'수원 테스트로 1',mapx:'1270000000',mapy:'370000000'},
    {title:'좌표없음',mapx:'',mapy:''}
  ]}});
  let body; const res={json:value=>body=value,status(){return this;}};
  await handler({query:{q:'수원 숙소'},user:{id:3}},res);
  assert.equal(body.places.length,1);
  const p=body.places[0];
  assert.equal(p.mapX,'127');
  assert.equal(p.name,'숙소');
  assert.equal(verifyAccommodation(p.proof,room,3,'test-secret').address,'수원 테스트로 1');
  assert.throws(()=>verifyAccommodation(p.proof,room,4,'test-secret'));
  assert.throws(()=>verifyAccommodation(p.proof,{...room,active_trip_id:4},3,'test-secret'));
  assert.throws(()=>verifyAccommodation(p.proof,{...room,id:4},3,'test-secret'));
  const expired=jwt.sign({place:p,roomId:1,tripId:2,owner:3},'test-secret',{audience:'accommodation',expiresIn:-1});
  assert.throws(()=>verifyAccommodation(expired,room,3,'test-secret'));
});
