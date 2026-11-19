const initial = [
  {description:'Salário',date:'2026-11-05',type:'Receita',category:'Salário',amount:420000,paymentMethod:'Crédito em conta',status:'Pago'},
  {description:'Aluguel',date:'2026-11-07',type:'Despesa',category:'Moradia',amount:135000,paymentMethod:'Transferência',status:'Pago'},
  {description:'Supermercado',date:'2026-11-12',type:'Despesa',category:'Alimentação',amount:38640,paymentMethod:'Cartão de crédito',status:'Pendente'},
  {description:'Transporte por aplicativo',date:'2026-11-14',type:'Despesa',category:'Transporte',amount:12850,paymentMethod:'Cartão de débito',status:'Pago'},
  {description:'Cinema',date:'2026-11-15',type:'Despesa',category:'Lazer',amount:8400,paymentMethod:'Pix',status:'Pago'}
];
const categories = {Receita:['Salário','Outras receitas'],Despesa:['Moradia','Alimentação','Transporte','Lazer','Outras despesas']};
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const format = cents => currency.format(cents/100);
const demoDate = '2026-11-17';
const demoMonth = demoDate.slice(0,7);
const monthsOfYear = year => Array.from({length:12}, (_, index) =>
  year + '-' + String(index + 1).padStart(2,'0')
);
const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
const formatMonth = month => monthLabel.format(new Date(month + '-01T00:00:00Z'));
const main = document.querySelector('main');
const scenario = document.querySelector('#scenario');
const filters = {month:demoMonth,type:'',category:'',paymentMethod:''};
const paymentMethods = ['Pix','Cartão de crédito','Cartão de débito','Débito automático','Boleto bancário','Transferência','Crédito em conta'];
const transactionStatuses = ['Pago','Pendente'];
let listPage = 1;
let listPageSize = 10;
const deletingTransactionIds = new Set();

function resetTransactionFilters(month){
  Object.assign(filters,{month,type:'',category:'',paymentMethod:''});
  listPage = 1;
}
let homeMonth = demoMonth;
let balanceHidden = false;
const search = document.querySelector('#search-query');
let query = '';
const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
let appMode = location.hostname === '127.0.0.1' ? 'checking' : 'demo';
let entries = appMode === 'demo' ? initial.map((item,index) => ({...item,id:index+1})) : [];
let accountUser = null;
let accountEpoch = 0;
let accountState = 'idle';
let authBusy = false;
let saveBusy = false;
let sessionProblem = false;
let logoutProblem = false;
let authNotice = '';
let message = '';
let draft = null;
const escape = value => String(value).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const records = () => appMode === 'demo' && scenario.value === 'empty' ? [] : entries;
const newest = items => [...items].reverse().sort((a,b)=>
  b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0)
);
const add = '<a class="nav primary" href="#novo"><span aria-hidden="true">＋</span>Novo lançamento</a>';
const rows = (items, recent = false) => '<ul>' + items.map(item => {
  const date = item.date.split('-').reverse().join('/');
  const expense = item.type === 'Despesa';
  const tone = expense ? 'debit' : 'credit';
  const iconTone = recent && item.category === 'Transporte' ? ' transport' : recent && item.category === 'Lazer' ? ' fun' : '';
  const icon = recent ? '<span class="material-symbols-outlined">' + ({
    Salário:'account_balance', Moradia:'account_balance_wallet', Alimentação:'shopping_basket',
    Transporte:'local_taxi', Lazer:'subscriptions'
  }[item.category] ?? 'payments') + '</span>' : expense ? '↓' : '↑';
  const metadata = recent
    ? '<small class="recent-meta"><span class="recent-tag ' + tone + '">' + item.category + '</span><span>' + date + '</span></small>'
    : '<small>' + date + ' · ' + item.category + ' · ' + item.type + '</small>';
  const amount = '<strong class="money '+tone+'">'+(expense?'−':'+')+format(item.amount)+'</strong>';
  return '<li class="row"><div class="row-info"><span aria-hidden="true" class="movement '+tone+iconTone+'">'+icon+'</span><div><strong>'+escape(item.description)+'</strong><br>'+metadata+'</div></div>'
    + (recent ? '<div class="recent-amount">' + amount + '<small>' + item.type + '</small></div>' : amount) + '</li>';
}).join('') + '</ul>';
const options = (values,selected) => values.map(value=>'<option'+(value===selected?' selected':'')+'>'+value+'</option>').join('');
const sum = items => items.reduce((total,item)=>total+item.amount,0);

const stitchSlot = (root,name) => root.querySelector('[data-stitch="' + name + '"]');
const stitchTemplate = name => document.querySelector('#stitch-' + name).content.cloneNode(true);

function homeSpending(expenses, category, days){
  const visible = category ? expenses.filter(item => item.category === category) : expenses;
  const total = sum(visible);
  if(!total){
    const empty = document.createElement('p');
    empty.className = 'stitch-empty';
    empty.textContent = category ? 'Nenhuma despesa em ' + category + ' neste mês.' : 'Nenhuma despesa neste mês.';
    return empty;
  }

  const chart = stitchTemplate('chart');
  const weeks = [[1,7],[8,14],[15,21],[22,days]].map(([start,end]) => ({
    start, end, amount: sum(visible.filter(item => {
      const day = Number(item.date.slice(-2));
      return day >= start && day <= end;
    }))
  }));
  const peak = Math.max(...weeks.map(week => week.amount));
  const coordinates = [30,170,310,470];
  const points = weeks.map(({amount}, index) => [coordinates[index], 125 - amount / peak * 90]);
  const path = points.reduce((line,[x,y],index) => {
    if(index === 0) return 'M' + x + ',' + y;
    const [lastX,lastY] = points[index-1];
    const approach = Math.round((x - lastX) * .43);
    return line + ' C' + (lastX + approach) + ',' + lastY + ' ' + (x - approach) + ',' + y + ' ' + x + ',' + y;
  },'');
  stitchSlot(chart,'line').setAttribute('d',path);
  stitchSlot(chart,'area').setAttribute('d',path + ' L470,140 H30 Z');
  const labels = chart.querySelector('[data-week-labels]').children;
  chart.querySelectorAll('[data-point]').forEach((point,index)=>{
    const [x,y] = points[index];
    point.setAttribute('cx',x);
    point.setAttribute('cy',y);
    point.setAttribute('r',weeks[index].amount === peak ? '6' : '4.5');
    labels[index].firstElementChild.classList.remove('text-primary');
    labels[index].lastElementChild.classList.remove('text-primary');
    labels[index].firstElementChild.classList.toggle('stitch-peak', weeks[index].amount === peak);
    labels[index].lastElementChild.classList.toggle('stitch-peak', weeks[index].amount === peak);
    labels[index].firstElementChild.textContent = format(weeks[index].amount);
    labels[index].lastElementChild.textContent = 'Sem ' + (index + 1) + ' (' + weeks[index].start + '–' + weeks[index].end + ')';
  });

  const ranking = categories.Despesa.map(name => ({
    name, amount: sum(visible.filter(item => item.category === name))
  })).filter(item => item.amount > 0).sort((a,b) => b.amount - a.amount);
  const colors = ['#4338ca','#006c49','#777586'];
  stitchSlot(chart,'ranking').innerHTML = ranking.map(({name,amount},index) => {
    const share = Math.round(amount / total * 100);
    return '<div class="stitch-rank-row" style="--rank-color:' + colors[index % colors.length] + '"><div><span>' + name + '</span><strong class="money">' + format(amount) + ' (' + share + '%)</strong><span class="mobile-rank-share">' + share + '%</span></div>'
      + '<div class="stitch-rank-track" aria-hidden="true"><span style="width:' + share + '%;background:' + colors[index % colors.length] + '"></span></div></div>';
  }).join('');
  stitchSlot(chart,'ranking-daily').textContent = format(Math.round(total / days)) + '/dia';
  return chart;
}

function salaryForecast(items, reference){
  const salaries = items.filter(item => item.type === 'Receita' && item.category === 'Salário');
  const dates = salaries.map(item => item.date).sort();
  let date = dates.find(value => value >= reference);
  const estimated = !date;
  if(estimated){
    const last = dates.at(-1);
    if(!last) return null;
    const [year, month, day] = last.split('-').map(Number);
    // Preserve the original day across short months and skip elapsed estimates.
    const [referenceYear, referenceMonth] = reference.split('-').map(Number);
    const earliest = Math.max(year * 12 + month, referenceYear * 12 + referenceMonth - 1);
    const estimate = offset => {
      const targetYear = Math.floor(offset / 12);
      const targetMonth = offset % 12 + 1;
      const end = new Date(Date.UTC(targetYear,targetMonth,0)).getUTCDate();
      return new Date(Date.UTC(targetYear,targetMonth-1,Math.min(day,end))).toISOString().slice(0,10);
    };
    date = estimate(earliest);
    if(date < reference) date = estimate(earliest + 1);
  }
  const before = items.filter(item => item.date < date);
  const balance = sum(before.filter(item=>item.type==='Receita')) - sum(before.filter(item=>item.type==='Despesa'));
  const days = (Date.parse(date) - Date.parse(reference)) / 86400000;
  return {date, estimated, balance, days, daily:days ? Math.floor(Math.max(0,balance) / days) : null};
}

const salaryDateLabel = new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});

function localCalendarDate(now = new Date()){
  return [now.getFullYear(),now.getMonth()+1,now.getDate()]
    .map((part,index)=>String(part).padStart(index===0?4:2,'0')).join('-');
}

function mountHome(showDashboard){
  const home = stitchTemplate('home');
  if(accountUser) home.querySelector('h1').textContent='Visão da conta';
  const monthText = formatMonth(homeMonth);
  const monthSelect = home.querySelector('#home-month');
  monthSelect.innerHTML = monthOptions(homeMonth,{baseMonths:monthsOfYear((accountUser ? localCalendarDate() : demoDate).slice(0,4))});
  stitchSlot(home,'intro').textContent = 'Aqui está o resumo financeiro do seu mês de ' + monthText + '.';
  if(!showDashboard){
    home.querySelectorAll('.stitch-metrics,.mobile-quick,.stitch-spending,.home-recent').forEach(node=>node.remove());
    main.replaceChildren(home);
    return;
  }

  const items = records();
  const today = localCalendarDate();
  const month = items.filter(item => item.date.slice(0,7) === homeMonth);
  const throughToday = items.filter(item => item.date <= today);
  const income = sum(throughToday.filter(item => item.type === 'Receita'));
  const spentThroughToday = sum(throughToday.filter(item => item.type === 'Despesa'));
  const expenses = month.filter(item => item.type === 'Despesa');
  const spent = sum(expenses);
  const balance = income - spentThroughToday;
  const [year, monthNumber] = homeMonth.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const salary = salaryForecast(items,today);
  const salaryDate = salary ? salaryDateLabel.format(new Date(salary.date)) : '';
  const salaryPeriod = salary ? (salary.days === 0 ? 'Hoje' : salary.days === 1 ? 'Falta 1 dia' : 'Faltam ' + salary.days + ' dias') + ' · ' + salaryDate : 'Sem data de salário';
  const recent = newest(month).slice(0,5);
  const moneyNumber = cents => currency.formatToParts(cents / 100).filter(part => part.type !== 'currency' && part.type !== 'literal').map(part => part.value).join('');
  const categoriesUsed = new Set(expenses.map(item=>item.category)).size;
  const values = {
    balance:moneyNumber(balance), 'balance-badge':'Até hoje',
    income:'+' + format(income), 'spent-summary':'−' + format(spentThroughToday),
    'salary-prefix':salary ? 'R$' : '',
    'salary-balance':salary ? moneyNumber(salary.balance) : '—',
    'salary-period':salaryPeriod,
    'mobile-salary-period':salary ? (salary.days === 0 ? 'Hoje' : salary.days + (salary.days === 1 ? ' dia' : ' dias')) + ' · ' + salary.date.slice(-2) + '/' + salary.date.slice(5,7) : 'Sem data de salário',
    'salary-note':salary ? 'Saldo dos lançamentos anteriores a ' + salaryDate + '.' : 'Cadastre um lançamento como Receita → Salário para acompanhar a próxima data.',
    daily:salary ? (salary.daily === null ? 'Dia do salário' : 'Disponível por dia: ' + format(salary.daily) + '/dia') : 'Disponível por dia ainda sem cálculo',
    'salary-daily-note':salary ? (salary.daily === null ? 'Nenhum dia restante para distribuir o saldo.' : salary.balance < 0 ? 'O saldo antes do salário é negativo.' : 'Saldo dividido pelos dias restantes.') : '',
    'salary-status':salary ? (salary.estimated ? 'Estimativa' : 'Agendado') : '',
    'analysis-badge':categoriesUsed ? categoriesUsed + (categoriesUsed === 1 ? ' categoria' : ' categorias') : '',
    'analysis-copy':'Evolução e distribuição de despesas ao longo das semanas de ' + monthText,
    'mobile-spent':format(spent),
    'recent-count':recent.length ? recent.length + (recent.length === 1 ? ' recente' : ' recentes') : ''
  };
  for(const [name,value] of Object.entries(values)){
    const target=stitchSlot(home,name);
    target.textContent=value;
    target.hidden=!value;
  }
  const monthIncome = sum(month.filter(item => item.type === 'Receita'));
  if (monthIncome > 0 && salary) {
    const percentage = Math.round(100 * spent / monthIncome);
    stitchSlot(home,'pace').hidden = false;
    stitchSlot(home,'pace-label').textContent = percentage + '% das receitas do mês';
    stitchSlot(home,'pace-fill').style.width = Math.min(percentage,100) + '%';
    stitchSlot(home,'salary-note').hidden = true;
  }
  stitchSlot(home,'mobile-salary-period').setAttribute('aria-label',salaryPeriod);
  stitchSlot(home,'salary-daily-note').classList.toggle('mobile-redundant',!!salary && salary.days > 0 && salary.balance >= 0);
  stitchSlot(home,'recent-rows').innerHTML = recent.length ? rows(recent,true) : '<p>Nenhum lançamento neste mês.</p>' + add;
  const chart = stitchSlot(home,'chart');
  chart.replaceChildren(homeSpending(expenses,'',days));
  const buttons = [...home.querySelectorAll('[data-spend-category]')];
  buttons.forEach(button => button.addEventListener('click',()=>{
    buttons.forEach(item=>item.setAttribute('aria-pressed',String(item === button)));
    chart.replaceChildren(homeSpending(expenses,button.dataset.spendCategory,days));
    const category = button.dataset.spendCategory;
    stitchSlot(main,'mobile-spent').textContent=format(sum(category ? expenses.filter(item=>item.category===category) : expenses));
  }));
  const toggle = home.querySelector('#toggleSaldoBtn');
  const balanceText = stitchSlot(home,'balance');
  const prefix = balanceText.parentElement.querySelector('[data-prefix]');
  const updateBalanceVisibility = () => {
    toggle.setAttribute('aria-pressed',String(balanceHidden));
    toggle.setAttribute('aria-label',balanceHidden ? 'Mostrar saldo' : 'Ocultar saldo');
    toggle.title=balanceHidden ? 'Mostrar saldo' : 'Ocultar saldo';
    toggle.firstElementChild.textContent=balanceHidden ? 'visibility_off' : 'visibility';
    prefix.hidden=balanceHidden;
    balanceText.textContent=balanceHidden ? '••••••' : values.balance;
    balanceText.setAttribute('aria-label',balanceHidden ? 'Saldo oculto' : format(balance));
  };
  updateBalanceVisibility();
  toggle.addEventListener('click',()=>{
    balanceHidden=!balanceHidden;
    updateBalanceVisibility();
  });
  home.querySelectorAll('[data-list-month]').forEach(item=>{item.dataset.listMonth=homeMonth;});
  main.replaceChildren(home);
}

function monthOptions(selected, {includeAll = false, baseMonths = [accountUser ? localCalendarDate().slice(0,7) : demoMonth]} = {}){
  const months = new Set([...baseMonths, ...records().map(item => item.date.slice(0,7))]);
  if(selected) months.add(selected);
  return (includeAll ? '<option value="">Todos os meses</option>' : '') + [...months].sort().reverse().map(month => {
    return '<option value="' + month + '"' + (month === selected ? ' selected' : '') + '>' + formatMonth(month) + '</option>';
  }).join('');
}

const transactionDate = new Intl.DateTimeFormat('pt-BR', {timeZone:'UTC'});
const savingsRate = new Intl.NumberFormat('pt-BR', {style:'percent', maximumFractionDigits:1});
const categoryIcons = {
  Salário:'account_balance', Moradia:'account_balance_wallet', Alimentação:'shopping_basket',
  Transporte:'local_taxi', Lazer:'subscriptions'
};
const signedMoney = (amount, sign) => (amount ? sign + ' ' : '') + format(Math.abs(amount));

function adjacentMonth(month, step){
  if(!month || (month === '0001-01' && step < 0) || (month === '9999-12' && step > 0)) return '';
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.toISOString().slice(0,7);
}

function transactionsInPeriod(){
  return records().filter(item => !filters.month || item.date.startsWith(filters.month));
}

function filteredTransactions(inPeriod){
  return newest(inPeriod.filter(item =>
    (!filters.type || item.type === filters.type) &&
    (!filters.category || item.category === filters.category) &&
    (!filters.paymentMethod || (item.paymentMethod || 'unknown') === filters.paymentMethod) &&
    (!query || searchKey(item.description + ' ' + item.category).includes(query))
  ));
}

function transactionRow(item){
  const income = item.type === 'Receita';
  const tone = income ? 'income' : 'expense';
  const date = transactionDate.format(new Date(item.date + 'T00:00:00Z'));
  const status = transactionStatuses.includes(item.status) ? item.status : '';
  const icon = categoryIcons[item.category] ?? 'payments';
  return '<tr role="row" data-tone="' + tone + '">'
    + '<td role="cell"><time datetime="' + item.date + '">' + date + '</time></td>'
    + '<td role="cell"><div class="transactions-description"><span class="transactions-category-icon material-symbols-outlined" aria-hidden="true">' + icon + '</span><strong>' + escape(item.description) + '</strong></div></td>'
    + '<td role="cell"><span class="transactions-category">' + escape(item.category) + '</span></td>'
    + '<td role="cell"><span class="transactions-payment">' + escape(item.paymentMethod || 'Não informada') + '</span></td>'
    + '<td role="cell"><span class="transactions-status" data-status="' + (status ? status.toLowerCase() : 'unknown') + '">'
    + (status ? '<span aria-hidden="true">' + (status === 'Pago' ? '✓' : '◷') + '</span> ' : '') + (status || 'Não informado') + '</span></td>'
    + '<td role="cell" class="transactions-amount" data-tone="' + tone + '">' + signedMoney(item.amount, income ? '+' : '−') + '</td>'
    + '<td role="cell" class="transactions-action"><button type="button" class="transactions-delete" data-delete-id="' + item.id + '" aria-label="Excluir lançamento ' + escape(item.description) + ' de ' + date + '" title="Excluir lançamento"' + (deletingTransactionIds.has(item.id) ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/></svg></button></td>'
    + '</tr>';
}

function updateTransactionSummary(inPeriod){
  const incomes = inPeriod.filter(item => item.type === 'Receita');
  const expenses = inPeriod.filter(item => item.type === 'Despesa');
  const income = sum(incomes);
  const expense = sum(expenses);
  const balance = income - expense;
  main.querySelector('[data-total=income]').textContent = signedMoney(income, '+');
  main.querySelector('[data-total=expense]').textContent = signedMoney(expense, '−');
  main.querySelector('[data-total=balance]').textContent = signedMoney(balance, balance < 0 ? '−' : '+');
  main.querySelector('[data-detail=income]').textContent = incomes.length + (incomes.length === 1 ? ' receita registrada' : ' receitas registradas');
  main.querySelector('[data-detail=expense]').textContent = expenses.length + (expenses.length === 1 ? ' despesa registrada' : ' despesas registradas');
  main.querySelector('[data-detail=balance]').textContent = income ? 'Taxa de poupança · ' + savingsRate.format(balance / income) : 'Taxa de poupança · Indisponível sem receitas';
  const badge = stitchSlot(main,'balance-status');
  badge.dataset.status = balance < 0 ? 'negative' : balance > 0 ? 'positive' : 'neutral';
  badge.textContent = balance < 0 ? 'Déficit' : balance > 0 ? 'Superávit' : 'Saldo zerado';
}

function updateTransactionPeriod(){
  main.querySelector('#transactions-month').textContent = filters.month ? formatMonth(filters.month) : 'Todos os meses';
  main.querySelectorAll('[data-month-step]').forEach(button => {
    button.disabled = !adjacentMonth(filters.month, Number(button.dataset.monthStep));
  });
  updateTransactionSummary(transactionsInPeriod());
}

function updateTransactionPagination(pages){
  const pagination = main.querySelector('.transactions-pagination');
  const focusedPage = pagination.contains(document.activeElement) ? document.activeElement.dataset.pageKey : '';
  pagination.hidden = pages < 2;
  const start = Math.max(1, Math.min(listPage - 2, pages - 4));
  const end = Math.min(start + 4, pages);
  let buttons = '<button type="button" data-page-key="previous" data-page="' + (listPage-1) + '"' + (listPage === 1 ? ' disabled' : '') + '>‹ <span>Anterior</span></button>';
  for(let page = start; page <= end; page++){
    buttons += '<button type="button" data-page-key="' + page + '" data-page="' + page + '" aria-label="Página ' + page + '"'
      + (page === listPage ? ' aria-current="page"' : '') + '>' + page + '</button>';
  }
  pagination.innerHTML = pages < 2 ? '' : buttons + '<button type="button" data-page-key="next" data-page="' + (listPage+1) + '"' + (listPage === pages ? ' disabled' : '') + '><span>Próxima</span> ›</button>';
  if(focusedPage){
    const target = pagination.querySelector('[data-page-key="' + focusedPage + '"]:enabled')
      ?? pagination.querySelector('[aria-current="page"]');
    target?.focus({preventScroll:true});
  }
}

function listResults(resetPage = false){
  if(resetPage) listPage = 1;
  const items = filteredTransactions(transactionsInPeriod());
  const pages = Math.ceil(items.length / listPageSize);
  listPage = Math.max(1, Math.min(listPage, pages));
  const offset = (listPage - 1) * listPageSize;
  const end = Math.min(offset + listPageSize, items.length);
  const table = main.querySelector('.transactions-table');
  const empty = main.querySelector('.transactions-empty');
  table.querySelector('tbody').innerHTML = items.slice(offset,end).map(transactionRow).join('');
  table.hidden = !items.length;
  empty.hidden = !!items.length;
  if(!items.length){
    empty.textContent = records().length ? 'Nenhum lançamento corresponde aos filtros.' : 'Registre uma receita ou despesa para começar.';
  }
  stitchSlot(main,'count').textContent = items.length
    ? 'Mostrando ' + (offset+1) + '–' + end + ' de ' + items.length + (items.length === 1 ? ' lançamento' : ' lançamentos')
    : '0 lançamentos';
  main.querySelector('.transactions-export').disabled = !items.length;
  updateTransactionPagination(pages);
}

function updateTransactionTypes(){
  main.querySelectorAll('[data-type]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.type === filters.type));
  });
  const values = filters.type ? categories[filters.type] : Object.values(categories).flat();
  main.querySelector('#transactions-category').innerHTML = '<option value="">Todas as categorias</option>' + options(values,filters.category);
}

function csvCell(value){
  return '"' + String(value).replaceAll('"','""') + '"';
}

function exportTransactions(){
  const rows = filteredTransactions(transactionsInPeriod()).map(item => {
    const description = /^(?:\s*[=+\-@＝＋－＠]|[\t\r\n])/.test(item.description) ? "'" + item.description : item.description;
    const amount = String(item.amount).padStart(3,'0');
    const value = (item.type === 'Despesa' ? '-' : '') + amount.slice(0,-2) + ',' + amount.slice(-2);
    return [item.date, description, item.category, item.type, item.paymentMethod ?? '', item.status ?? '', value];
  });
  const header = ['Data','Descrição','Categoria','Tipo','Forma de pagamento','Status','Valor (R$)'];
  const csv = [header,...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
  const file = URL.createObjectURL(new Blob(['\uFEFF',csv], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = file;
  link.download = 'finflow-lancamentos' + (filters.month ? '-' + filters.month : '') + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(file),1000);
}

async function deleteTransaction(id){
  if(!Number.isSafeInteger(id) || id <= 0 || deletingTransactionIds.has(id)) return;
  const item = entries.find(entry => entry.id === id);
  if(!item || !window.confirm('Excluir o lançamento “' + item.description + '” de ' + transactionDate.format(new Date(item.date + 'T00:00:00Z')) + '?')) return;
  const epoch = accountEpoch;
  deletingTransactionIds.add(id);
  const button = main.querySelector('.transactions-delete[data-delete-id="' + id + '"]');
  if(button) button.disabled = true;
  try{
    if(appMode !== 'demo') await apiRequest('/api/transactions/' + id, undefined, 'DELETE');
    if(epoch !== accountEpoch) return;
    entries = entries.filter(entry => entry.id !== id);
    if(main.querySelector('.transactions-table')){
      updateTransactionPeriod();
      listResults();
      const notice = main.querySelector('.transactions-notice');
      notice.textContent = 'Lançamento excluído.';
      notice.hidden = false;
      notice.setAttribute('role','status');
    }
  }catch(error){
    if(epoch !== accountEpoch) return;
    const notice = main.querySelector('.transactions-notice');
    if(notice){
      notice.textContent = 'Não foi possível excluir o lançamento. Tente novamente.';
      notice.hidden = false;
      notice.setAttribute('role','alert');
    }else message = 'Não foi possível excluir o lançamento. Tente novamente.';
  }finally{
    deletingTransactionIds.delete(id);
    const currentButton = main.querySelector('.transactions-delete[data-delete-id="' + id + '"]');
    if(currentButton) currentButton.disabled = false;
  }
}

function mountTransactions(){
  main.replaceChildren(stitchTemplate('transactions'));
  const notice = main.querySelector('.transactions-notice');
  notice.hidden = !message;
  notice.textContent = message;
  message = '';
  const listSearch = main.querySelector('#transactions-query');
  const payment = main.querySelector('#transactions-payment');
  const pageSize = main.querySelector('#transactions-page-size');
  listSearch.value = search.value;
  pageSize.value = listPageSize;
  payment.innerHTML = '<option value="">Forma de pagamento</option>' + options(paymentMethods,filters.paymentMethod)
    + '<option value="unknown">Não informada</option>';
  payment.value = filters.paymentMethod;

  main.querySelectorAll('[data-month-step]').forEach(button => button.addEventListener('click', () => {
    filters.month = adjacentMonth(filters.month, Number(button.dataset.monthStep));
    updateTransactionPeriod();
    listResults(true);
    if(button.disabled) main.querySelector('[data-month-step="' + -Number(button.dataset.monthStep) + '"]').focus();
  }));
  listSearch.addEventListener('input', () => {
    search.value = listSearch.value;
    query = searchKey(listSearch.value);
    listResults(true);
  });
  main.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
    if(filters.type === button.dataset.type) return;
    filters.type = button.dataset.type;
    filters.category = '';
    updateTransactionTypes();
    listResults(true);
  }));
  main.querySelector('#transactions-category').addEventListener('change', event => {
    filters.category = event.currentTarget.value;
    listResults(true);
  });
  payment.addEventListener('change', () => {
    filters.paymentMethod = payment.value;
    listResults(true);
  });
  main.querySelector('#transactions-clear').addEventListener('click', () => {
    listSearch.value = '';
    search.value = '';
    query = '';
    Object.assign(filters,{type:'',category:'',paymentMethod:''});
    payment.value = '';
    updateTransactionTypes();
    listResults(true);
  });
  pageSize.addEventListener('change', () => {
    listPageSize = Number(pageSize.value);
    listResults(true);
  });
  main.querySelector('.transactions-pagination').addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if(!button) return;
    listPage = Number(button.dataset.page);
    listResults();
  });
  main.querySelector('.transactions-export').addEventListener('click',exportTransactions);
  main.querySelector('.transactions-table tbody').addEventListener('click', event => {
    const button = event.target.closest('button[data-delete-id]');
    if(button) deleteTransaction(Number(button.dataset.deleteId));
  });
  updateTransactionPeriod();
  updateTransactionTypes();
  listResults();
}

function form(){
  const data=draft??{type:'Despesa',amount:'',date:accountUser?localCalendarDate():demoDate,category:'',description:''};
  return '<form class="card form" novalidate><fieldset><legend>Tipo de lançamento</legend>'+Object.keys(categories).map(type=>'<label class="radio"><input type="radio" name="kind" value="'+type+'" '+(data.type===type?'checked':'')+'>'+type+'</label>').join('')+'</fieldset><div class="fields"><label>Valor (R$)<input name="amount" required inputmode="decimal" placeholder="0,00" value="'+escape(data.amount)+'" aria-describedby="amount-help amount-error"><small id="amount-help">Exemplo: 123,45</small><span class="field-error" id="amount-error"></span></label><label>Data<input name="date" type="date" required value="'+escape(data.date)+'" aria-describedby="date-error"><span class="field-error" id="date-error"></span></label><label class="wide">Categoria<select name="category" required aria-describedby="category-error"><option value="">Selecione</option>'+options(categories[data.type],data.category)+'</select><span class="field-error" id="category-error"></span></label><label>Forma de pagamento (opcional)<select name="paymentMethod"><option value="">Não informada</option>'+options(paymentMethods,data.paymentMethod)+'</select></label><label>Status (opcional)<select name="status"><option value="">Não informado</option>'+options(transactionStatuses,data.status)+'</select></label><label class="wide">Descrição (opcional)<input name="description" maxlength="80" value="'+escape(data.description)+'"></label></div><div id="form-status" role="alert"></div><div class="actions"><button class="primary" type="submit">Salvar lançamento</button><a class="nav" id="cancel" href="#lancamentos">Cancelar</a></div></form>';
}
function formDraft(element){
  const data=new FormData(element);
  return {
    type:data.get('kind'),amount:data.get('amount'),date:data.get('date'),
    category:data.get('category'),description:data.get('description'),
    paymentMethod:data.get('paymentMethod') || null,status:data.get('status') || null
  };
}
function parseCents(value){
  const raw=value.trim().replace(/^R\$\s*/,'');
  if(!/^(?:\d{1,9}|\d{1,3}(?:\.\d{3}){1,2})(?:,\d{1,2})?$/.test(raw)) return 0;
  const [whole,decimal='']=raw.replaceAll('.','').split(',');
  return Number(whole)*100+Number(decimal.padEnd(2,'0'));
}
function wireForm(){
  const element=main.querySelector('form');
  const field=name=>element.elements.namedItem(name);
  const status=document.querySelector('#form-status');
  function error(name,text){
    document.querySelector('#'+name+'-error').textContent=text;
    if(text) field(name).setAttribute('aria-invalid','true');
    else field(name).removeAttribute('aria-invalid');
  }
  element.addEventListener('change',event=>{
    if(event.target.name!=='kind') return;
    field('category').innerHTML='<option value="">Selecione</option>'+options(categories[field('kind').value],'');
    error('category','');
  });
  document.querySelector('#cancel').addEventListener('click',()=>{draft=null;});
  element.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saveBusy) return;
    draft=formDraft(element);
    const cents=parseCents(draft.amount);
    const errors={amount:cents>0?'':'Informe um valor maior que zero, como 123,45.',date:draft.date&&field('date').validity.valid?'':'Informe uma data válida.',category:categories[draft.type].includes(draft.category)?'':'Selecione uma categoria.'};
    status.className='';
    status.textContent='';
    Object.entries(errors).forEach(([name,value])=>error(name,value));
    const invalid=Object.keys(errors).find(name=>errors[name]);
    if(invalid){field(invalid).focus();return;}
    if(appMode==='demo'&&scenario.value==='save'){
      status.className='notice error';
      status.textContent='Não foi possível salvar. Seus dados continuam no formulário. Troque o cenário para Dados fictícios e tente novamente.';
      return;
    }
    const record={...draft,description:draft.description.trim()||draft.category,amount:cents};
    if(accountUser){
      const epoch=accountEpoch;
      const submit=element.querySelector('button[type=submit]');
      submit.disabled=true;
      saveBusy=true;
      try{
        const payload=await apiRequest('/api/transactions',record);
        if(epoch!==accountEpoch) return;
        entries.push(requireTransaction(payload.item));
      }catch(error){
        if(epoch!==accountEpoch) return;
        if(error.status===401){expireAccount();return;}
        status.className='notice error';
        status.textContent=error.status===400?'Confira os dados do lançamento.':'Não foi possível confirmar o salvamento. Verifique a lista antes de tentar novamente.';
        return;
      }finally{
        if(epoch===accountEpoch){saveBusy=false;submit.disabled=false;}
      }
    }else{
      if(scenario.value==='empty'){entries=[];scenario.value='normal';}
      entries.push(record);
    }
    search.value='';
    query='';
    resetTransactionFilters(record.date.slice(0,7));
    draft=null;
    message='Lançamento salvo.';
    location.hash='lancamentos';
  });
}
const accountTools = document.querySelector('.account-tools');
const accountChannel = appMode === 'checking' && typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('finflow-account-local') : null;

async function apiRequest(path, body, method){
  const request = {cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)};
  if(method) request.method=method;
  if(body !== undefined){
    request.method='POST';
    request.headers={'Content-Type':'application/json'};
    request.body=JSON.stringify(body);
  }
  const response = await fetch(path,request);
  if(!response.ok) throw Object.assign(new Error('API request failed'),{status:response.status});
  return response.status === 204 ? null : response.json();
}

function requireAccountUser(payload){
  if(!Number.isSafeInteger(payload?.user?.id) || typeof payload.user.email !== 'string') throw new Error('Invalid account response');
  return payload.user;
}

function requireTransaction(item){
  if(!Number.isSafeInteger(item?.id) || !categories[item.type]?.includes(item.category)
    || !Number.isSafeInteger(item.amount) || item.amount <= 0 || typeof item.description !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error('Invalid transaction response');
  return item;
}

function forgetAccount(){
  accountEpoch++;
  accountUser=null;
  accountState='idle';
  entries=[];
  draft=null;
  message='';
  saveBusy=false;
  balanceHidden=false;
  query='';
  search.value='';
  homeMonth=localCalendarDate().slice(0,7);
  resetTransactionFilters(homeMonth);
  listPageSize=10;
}

function expireAccount(){
  forgetAccount();
  authNotice='Sua sessão expirou. Entre novamente para continuar.';
  document.querySelector('.toolbar-settings').open=false;
  render(true);
}

async function loadAccountTransactions(){
  const epoch=accountEpoch;
  accountState='loading';
  render(false);
  try{
    const payload=await apiRequest('/api/transactions');
    if(epoch!==accountEpoch) return;
    entries=payload.items.map(requireTransaction);
    accountState='ready';
  }catch(error){
    if(epoch!==accountEpoch) return;
    if(error.status===401){expireAccount();return;}
    accountState='error';
  }
  render(true);
}

async function restoreAccount(){
  const initialProbe=appMode==='checking';
  const previousUser=accountUser;
  const previousForm=main.querySelector('form.form:not(.account-card)');
  const previousDraft=previousForm && location.hash==='#novo' ? formDraft(previousForm) : draft;
  const previousView={month:homeMonth,filters:{...filters},query,search:search.value,balanceHidden,listPage,listPageSize};
  forgetAccount();
  const epoch=accountEpoch;
  authBusy=true;
  sessionProblem=false;
  authNotice='';
  render(false);
  try{
    const user=requireAccountUser(await apiRequest('/api/auth/session'));
    if(epoch!==accountEpoch) return;
    appMode='account';
    accountUser=user;
    if(user.id===previousUser?.id){
      draft=previousDraft;
      homeMonth=previousView.month;
      Object.assign(filters,previousView.filters);
      ({listPage,listPageSize}=previousView);
      query=previousView.query;
      search.value=previousView.search;
      balanceHidden=previousView.balanceHidden;
    }
  }catch(error){
    if(epoch!==accountEpoch) return;
    if(initialProbe && error.status===404){
      appMode='demo';
      entries=[...initial];
      homeMonth=demoMonth;
      filters.month=demoMonth;
    }else{
      appMode='account';
      sessionProblem=error.status!==401;
      if(!sessionProblem && previousUser) authNotice='Sua sessão expirou. Entre novamente para continuar.';
    }
  }finally{
    if(epoch===accountEpoch) authBusy=false;
  }
  if(accountUser) await loadAccountTransactions();
  else render(false);
}

async function logout(){
  if(authBusy) return;
  forgetAccount();
  const epoch=accountEpoch;
  authBusy=true;
  logoutProblem=false;
  authNotice='';
  document.querySelector('.toolbar-settings').open=false;
  render(true);
  try{
    await apiRequest('/api/auth/logout',{});
    accountChannel?.postMessage('account-changed');
    if(location.hash!=='#login') location.hash='login';
  }catch{
    logoutProblem=true;
  }finally{
    if(epoch===accountEpoch) authBusy=false;
  }
  render(true);
}

function updateAccountChrome(authPreview){
  document.body.classList.toggle('account-mode',appMode!=='demo');
  document.body.classList.toggle('account-gated',authPreview||(appMode!=='demo'&&!accountUser));
  accountTools.hidden=!accountUser;
  accountTools.querySelector('.account-email').textContent=accountUser?.email ?? '';
}

function renderAccountGate(focus,authPreview){
  const register=location.hash==='#cadastro';
  const pending=appMode==='checking'||authBusy;
  const problem=sessionProblem||logoutProblem;
  if(pending||problem){
    const title=pending?'Verificando sessão…':logoutProblem?'Não foi possível encerrar a sessão':'Não foi possível verificar a sessão';
    main.innerHTML='<section class="card form account-card"><h1 tabindex="-1">'+title+'</h1>'
      +(pending?'<p role="status">Aguarde um momento.</p>':'<p role="alert">Verifique a conexão com a API local.</p><button id="account-retry">Tentar novamente</button>')+'</section>';
    main.querySelector('#account-retry')?.addEventListener('click',logoutProblem?logout:restoreAccount);
  }else{
    main.replaceChildren(document.querySelector('#stitch-auth').content.cloneNode(true));
    main.querySelectorAll(register ? '[data-login]' : '[data-register]').forEach(element=>element.remove());
    main.querySelector('.auth-tabs a[href="'+(register?'#cadastro':'#login')+'"]').setAttribute('aria-current','page');
    main.querySelector('h1').textContent=register?'Comece em 2 minutos':'Bem-vindo de volta';
    main.querySelector('.auth-intro').textContent=register?'Crie sua conta e descubra para onde vai cada centavo.':'Acesse seu painel com segurança para gerenciar suas contas.';
    main.querySelector('.auth-submit span').textContent=register?'Criar minha conta gratuita':'Entrar no FinFlow';
    const password=main.querySelector('#auth-password');
    password.autocomplete=register?'new-password':'current-password';
    password.placeholder=register?'Mínimo 15 caracteres':'••••••••••••';
    if(register){
      password.minLength=15;
      password.setAttribute('aria-describedby','auth-password-help');
      main.querySelector('label[for="auth-password"]').textContent='Crie uma senha segura';
      password.addEventListener('input',()=>{
        const length=[...password.value].length;
        main.querySelector('meter').value=Math.min(length,15);
        password.setCustomValidity(length<15?'Use pelo menos 15 caracteres.':'');
      });
    }
    const eye=main.querySelector('#auth-eye');
    eye.addEventListener('click',()=>{
      const visible=password.type==='password';
      password.type=visible?'text':'password';
      eye.setAttribute('aria-pressed',String(visible));
      eye.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');
      eye.querySelector('i').textContent=visible?'visibility_off':'visibility';
    });
    main.querySelector('#auth-status').textContent=authNotice;
    if(authPreview) main.querySelector('.auth-assurance').textContent='Acesso à conta indisponível nesta prévia.';
    main.querySelector('.auth-submit').disabled=authPreview;
    main.querySelector('form').addEventListener('submit',event=>{
      if(authPreview) event.preventDefault();
      else submitAccount(event,register);
    });
  }
  if(focus) main.querySelector('h1').focus();
}

async function submitAccount(event, register){
  event.preventDefault();
  if(authBusy) return;
  const form=event.currentTarget;
  const submit=form.querySelector('button[type=submit]');
  const status=form.querySelector('#auth-status');
  const fields=new FormData(form);
  const credentials={email:fields.get('email').trim(),password:fields.get('password')};
  const epoch=accountEpoch;
  authBusy=true;
  submit.disabled=true;
  status.textContent='';
  let registered=false;
  try{
    if(register){
      await apiRequest('/api/auth/register',{...credentials,name:fields.get('name').trim(),salaryDay:fields.get('salaryDay')});
      registered=true;
    }
    const login=register?credentials:{...credentials,remember:fields.has('remember')};
    const user=requireAccountUser(await apiRequest('/api/auth/login',login));
    if(epoch!==accountEpoch) return;
    forgetAccount();
    accountUser=user;
    authNotice='';
    authBusy=false;
    accountChannel?.postMessage('account-changed');
    if(location.hash!=='#painel') location.hash='painel';
    await loadAccountTransactions();
  }catch(error){
    if(epoch!==accountEpoch) return;
    authNotice=registered?'Conta criada. Use Entrar para iniciar a sessão.'
      :error.status===409?'Esse e-mail não está disponível.'
      :error.status===401?'E-mail ou senha inválidos.'
      :error.status===400?'Confira o e-mail e a senha.'
      :error.status===429?'Muitas tentativas. Aguarde antes de tentar novamente.'
      :'Não foi possível acessar a API local. Tente novamente.';
    status.textContent=authNotice;
    if(registered) location.hash='login';
    else if(!form.isConnected) render(true);
  }finally{
    if(epoch===accountEpoch){
      authBusy=false;
      submit.disabled=false;
      if(!form.isConnected) render(false);
    }
  }
}

function render(focus){
  const authPreview=appMode==='demo'&&(location.hash==='#login'||location.hash==='#cadastro');
  updateAccountChrome(authPreview);
  const listRoute=location.hash==='#lancamentos' && !authPreview && (appMode==='demo'||accountUser);
  document.body.classList.toggle('transactions-view',!!listRoute);
  if(authPreview||(appMode!=='demo'&&!accountUser)){
    document.body.classList.remove('home-view');
    renderAccountGate(focus,authPreview);
    return;
  }
  if(accountUser&&accountState!=='ready'){
    main.innerHTML='<section class="card state-card"><h1 tabindex="-1">Lançamentos da conta</h1>'
      +(accountState==='error'?'<p role="alert">Não foi possível carregar os lançamentos.</p><button id="account-load-retry">Tentar novamente</button>':'<p role="status">Carregando lançamentos…</p>')+'</section>';
    main.querySelector('#account-load-retry')?.addEventListener('click',loadAccountTransactions);
    if(focus) main.querySelector('h1').focus();
    return;
  }
  const view=['lancamentos','novo'].includes(location.hash.slice(1))?location.hash.slice(1):'painel';
  document.body.classList.toggle('home-view', view === 'painel');
  document.querySelectorAll('nav a').forEach(a=>{
    if(a.hash==='#'+view) a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  const heading = '<h1 tabindex="-1">' + (view==='novo'?'Novo lançamento':'Lançamentos') + '</h1>';
  const demoLoadError=appMode==='demo'&&scenario.value==='load';
  if(view==='painel') mountHome(!demoLoadError);
  else if(view==='novo'||demoLoadError) main.innerHTML='<div class="intro">'+heading+'</div>';
  if(view!=='novo'&&demoLoadError){
    main.insertAdjacentHTML('beforeend','<section class="card state-card"><p class="error" role="alert">Não foi possível carregar os dados.</p><button id="retry">Tentar novamente</button></section>');
    document.querySelector('#retry').onclick=()=>{scenario.value='normal';render(true);};
  }else if(view==='novo'){main.insertAdjacentHTML('beforeend',form());wireForm();}
  else if(view==='lancamentos') mountTransactions();
  main.querySelector('#home-month')?.addEventListener('change',event=>{
    homeMonth=event.currentTarget.value;
    render(false);
    main.querySelector('#home-month').focus({preventScroll:true});
  });
  main.querySelectorAll('[data-list-month]').forEach(link => link.addEventListener('click',()=>{
    search.value='';
    query='';
    resetTransactionFilters(link.dataset.listMonth);
  }));
  if(focus) main.querySelector('h1').focus();
}
document.querySelector('#transaction-search').addEventListener('submit',event=>{
  event.preventDefault();
  setMobileSearch(false);
  query=searchKey(search.value);
  resetTransactionFilters('');
  if(location.hash==='#lancamentos') render(true);
  else location.hash='lancamentos';
});
const mobileSearch = document.querySelector('.mobile-search-toggle');
function setMobileSearch(open){
  document.querySelector('.topbar').classList.toggle('mobile-search-open',open);
  mobileSearch.setAttribute('aria-expanded',String(open));
  mobileSearch.setAttribute('aria-label',open ? 'Fechar busca' : 'Abrir busca');
}
mobileSearch.addEventListener('click',()=>{
  const open = mobileSearch.getAttribute('aria-expanded') !== 'true';
  setMobileSearch(open);
  if(open) search.focus();
});
search.addEventListener('keydown',event=>{
  if(event.key==='Escape' && mobileSearch.getAttribute('aria-expanded')==='true'){
    setMobileSearch(false);
    mobileSearch.focus();
  }
});
let pendingSpending = false;
function showMobileSpending(){
  const heading = main.querySelector('.stitch-spending h2');
  if(heading){
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:'start'});
  }
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-mobile-spending]')){
    if(document.body.classList.contains('home-view')) showMobileSpending();
    else{
      pendingSpending=true;
      location.hash='painel';
    }
  }
  if(event.target.closest('[data-mobile-menu]')){
    const settings=document.querySelector('.toolbar-settings');
    settings.open=true;
    settings.scrollIntoView({block:'start'});
    settings.querySelector('summary').focus({preventScroll:true});
  }
});
document.querySelector('.skip').addEventListener('click',event=>{event.preventDefault();main.focus();});
scenario.addEventListener('change',()=>{
  if(appMode!=='demo') return;
  if(location.hash==='#novo'&&main.querySelector('form')){draft=formDraft(main.querySelector('form'));return;}
  render(false);
});
window.addEventListener('hashchange',()=>{
  render(true);
  if(pendingSpending){
    pendingSpending=false;
    showMobileSpending();
  }
});
document.querySelector('#account-logout').addEventListener('click',logout);
accountChannel?.addEventListener('message',event=>{
  if(event.data==='account-changed'&&appMode==='account'&&!authBusy) restoreAccount();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&accountUser&&!authBusy&&!saveBusy&&accountState==='ready') restoreAccount();
});
if(appMode==='checking') restoreAccount();
else render(false);
