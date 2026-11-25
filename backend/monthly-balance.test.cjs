const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { monthlyBalance } = require('../public/assets/js/monthly-balance.js');

const entry = (date, type, amount) => ({ date, type, amount });

test('acumula vários meses e atravessa a virada do ano', () => {
  const records = [
    entry('2025-09-30', 'Receita', 10001),
    entry('2025-12-31', 'Despesa', 2502),
    entry('2026-01-01', 'Receita', 5003),
    entry('2026-01-31', 'Despesa', 4004),
    entry('2026-01-31', 'Transferência', 90000),
  ];
  assert.deepEqual(monthlyBalance(records, '2026-01'), {
    carryOver: 7499, income: 5003, expenses: 4004, total: 8498,
  });
  assert.deepEqual(monthlyBalance(records, '2026-02'), {
    carryOver: 8498, income: 0, expenses: 0, total: 8498,
  });
});

test('recalcula saldo negativo após inserir, editar e excluir lançamentos', () => {
  const records = [entry('2025-12-01', 'Despesa', 3001)];
  assert.equal(monthlyBalance(records, '2026-01').total, -3001);
  records.push(entry('2026-01-03', 'Receita', 1200));
  assert.equal(monthlyBalance(records, '2026-01').total, -1801);
  records[0] = entry('2026-01-04', 'Despesa', 2000);
  assert.deepEqual(monthlyBalance(records, '2026-01'), {
    carryOver: 0, income: 1200, expenses: 2000, total: -800,
  });
  records.splice(0, 1);
  assert.equal(monthlyBalance(records, '2026-01').total, 1200);
});

test('inclui todo o mês futuro e exclui somente meses posteriores', () => {
  const records = [
    entry('2098-11-30', 'Receita', 100),
    entry('2098-12-01', 'Receita', 200),
    entry('2098-12-31', 'Despesa', 50),
    entry('2098-12-31', 'Transferência', 900),
    entry('2099-01-01', 'Receita', 400),
  ];
  assert.deepEqual(monthlyBalance(records, '2098-12'), {
    carryOver: 100, income: 200, expenses: 50, total: 250,
  });
  assert.deepEqual(monthlyBalance(records, ''), {
    carryOver: 0, income: 700, expenses: 50, total: 650,
  });
});

test('reproduz o exemplo de saldo total com valores exatos em centavos', () => {
  const records = [
    entry('2026-10-31', 'Receita', 80000),
    entry('2026-11-01', 'Receita', 320000),
    entry('2026-11-30', 'Despesa', 58569),
  ];
  assert.deepEqual(monthlyBalance(records, '2026-11'), {
    carryOver: 80000, income: 320000, expenses: 58569, total: 341431,
  });
});

test('expõe o helper como script clássico e calcula os valores da demo', () => {
  const context = { Date: undefined };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/monthly-balance.js'), 'utf8'), context);
  const records = [
    entry('2026-11-05', 'Receita', 420000),
    entry('2026-11-07', 'Despesa', 135000),
    { ...entry('2026-11-12', 'Despesa', 38640), status: 'Pendente' },
    entry('2026-11-14', 'Despesa', 12850),
    entry('2026-11-15', 'Despesa', 8400),
  ];
  assert.deepEqual({ ...context.monthlyBalance(records, '2026-11') }, {
    carryOver: 0, income: 420000, expenses: 194890, total: 225110,
  });
});
