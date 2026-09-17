const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinance } = require('../services/finance');
const members = [1, 2, 3].map(id => ({ id, nickname: `member${id}`, active: 1 }));

test('회비와 개인 선결제를 상계하고 일부 멤버 지출을 정확히 분담한다', () => {
  const result = calculateFinance(members, 10000, [1, 2].map(user_id => ({ user_id, amount: 10000 })), [
    { amount: 9000, payer_user_id: null, participant_ids: '[1,2,3]' },
    { amount: 7001, payer_user_id: 2, participant_ids: '[2,3]' },
  ]);
  assert.equal(result.spent, 16001);
  assert.equal(result.poolBalance, 11000);
  assert.deepEqual(result.people.map(person => person.share), [3000, 6501, 6500]);
  assert.deepEqual(result.people.map(person => person.balance), [7000, 10500, -6500]);
  assert.equal(result.refundTotal - result.additionalTotal, result.poolBalance);
  assert.equal(result.people[2].unpaid, 10000);
});

test('추가 납부와 반환을 모두 기록하면 각자의 잔액과 공동금고가 0이 된다', () => {
  const result = calculateFinance(members, 10000, [
    { user_id: 1, amount: 10000 }, { user_id: 2, amount: 10000 }, { user_id: 3, amount: 6500 },
  ], [
    { amount: 9000, payer_user_id: null, participant_ids: '[1,2,3]' },
    { amount: 7001, payer_user_id: 2, participant_ids: '[2,3]' },
  ], [{ user_id: 1, amount: 7000 }, { user_id: 2, amount: 10500 }]);
  assert.equal(result.poolBalance, 0);
  assert.ok(result.people.every(person => person.balance === 0));
});

test('1원 나머지와 추방된 사람의 이미 확정된 분담을 보존한다', () => {
  const result = calculateFinance(members.map(member => ({ ...member, active: member.id !== 1 })), 10000, [], [
    { amount: 2, payer_user_id: 1, participant_ids: '[3,2,1]' },
  ]);
  assert.deepEqual(result.people.map(person => person.share), [1, 1, 0]);
  assert.equal(result.expected, 20000);
  assert.equal(result.people[0].unpaid, 0);
  assert.equal(result.people.reduce((sum, person) => sum + person.balance, 0), 0);
});

test('지출이 없으면 납부한 회비는 반환 대상이며 미납과 최종 정산을 혼동하지 않는다', () => {
  const result = calculateFinance(members, 10000, [{ user_id: 1, amount: 3000 }], []);
  assert.equal(result.people[0].balance, 3000);
  assert.equal(result.people[0].unpaid, 7000);
  assert.equal(result.additionalTotal, 0);
});
