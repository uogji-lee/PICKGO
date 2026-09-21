const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('경비 요약은 해당 여행의 지출만 합산하고 회비가 아닌 직접 선결제액을 표시한다', () => {
  const context = vm.createContext({ won: value => `${value}원`, escapeHtml: value => String(value).replaceAll('<','&lt;') });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/expenseOverview.js'),'utf8'),context);
  context.data = {
    activeTripId:2, canManage:true, people:[{id:1,nickname:'<친구>'}], trips:[{id:2,title:'둘째 여행',status:'planning'},{id:1,title:'첫 여행',status:'completed'}],
    expenses:[{trip_id:1,amount:99999,payer_user_id:1,expense_date:'2026-09-01',title:'이전 지출',participant_ids:'[1]'},
      {trip_id:2,amount:12000,payer_user_id:1,expense_date:'2026-09-21',title:'<카페>',participant_ids:'[1]'},
      {trip_id:2,amount:5000,payer_user_id:null,expense_date:'2026-09-20',title:'숙소',participant_ids:'[1]'}],
  };
  const html = vm.runInContext('renderExpenseOverview({id:1},data,1)',context);
  assert.match(html,/17000원/);
  assert.match(html,/12000원/);
  assert.match(html,/지출 2건/);
  assert.doesNotMatch(html,/99999원|이전 지출|<카페>/);
  assert.match(html,/&lt;카페>/);
  assert.ok(html.indexOf('2026-09-21') < html.indexOf('2026-09-20'));
});
