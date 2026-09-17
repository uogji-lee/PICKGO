// All money is integer KRW. Per-expense remainders go to ascending member IDs.
function calculateFinance(members, duesAmount, payments, expenses, refunds = []) {
  const accounts = new Map(members.map(member => [member.id, {
    id: member.id, nickname: member.nickname, active: Boolean(member.active),
    paid: 0, advanced: 0, share: 0, refunded: 0,
  }]));
  let collected = 0;
  let spent = 0;
  let poolSpent = 0;
  for (const payment of payments) {
    accounts.get(payment.user_id).paid += payment.amount;
    collected += payment.amount;
  }
  let refunded = 0;
  for (const refund of refunds) {
    accounts.get(refund.user_id).refunded += refund.amount;
    refunded += refund.amount;
  }
  for (const expense of expenses) {
    spent += expense.amount;
    if (expense.payer_user_id === null) poolSpent += expense.amount;
    else accounts.get(expense.payer_user_id).advanced += expense.amount;
    const ids = JSON.parse(expense.participant_ids).slice().sort((a, b) => a - b);
    const base = Math.floor(expense.amount / ids.length);
    const remainder = expense.amount % ids.length;
    ids.forEach((id, index) => { accounts.get(id).share += base + (index < remainder ? 1 : 0); });
  }
  const people = [...accounts.values()].map(person => ({
    ...person,
    unpaid: person.active ? Math.max(0, duesAmount - person.paid) : 0,
    // Positive = refund from the pool; negative = additional payment to the pool.
    balance: person.paid - person.refunded + person.advanced - person.share,
  }));
  return {
    duesAmount, collected, spent, poolSpent, refunded, poolBalance: collected - poolSpent - refunded,
    expected: duesAmount * people.filter(person => person.active).length,
    additionalTotal: people.reduce((sum, person) => sum + Math.max(0, -person.balance), 0),
    refundTotal: people.reduce((sum, person) => sum + Math.max(0, person.balance), 0),
    people,
  };
}

module.exports = { calculateFinance };
