function monthlyBalance(records, month) {
  let carryOver = 0;
  let income = 0;
  let expenses = 0;

  for (const { date, type, amount } of records) {
    if (type !== 'Receita' && type !== 'Despesa') continue;

    const recordMonth = date.slice(0, 7);
    if (month && recordMonth < month) {
      carryOver += type === 'Receita' ? amount : -amount;
    } else if (!month || recordMonth === month) {
      if (type === 'Receita') income += amount;
      else expenses += amount;
    }
  }

  return { carryOver, income, expenses, total: carryOver + income - expenses };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.monthlyBalance = monthlyBalance;
}
