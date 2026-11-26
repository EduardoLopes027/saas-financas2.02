const initial = [
  {description:'Salário',date:'2026-11-05',type:'Receita',category:'Salário',amount:420000,paymentMethod:'Crédito em conta',status:'Pago'},
  {description:'Aluguel',date:'2026-11-07',type:'Despesa',category:'Moradia',amount:135000,paymentMethod:'Transferência',status:'Pago'},
  {description:'Supermercado',date:'2026-11-12',type:'Despesa',category:'Alimentação',amount:38640,paymentMethod:'Cartão de crédito',status:'Pendente'},
  {description:'Transporte por aplicativo',date:'2026-11-14',type:'Despesa',category:'Transporte',amount:12850,paymentMethod:'Cartão de débito',status:'Pago'},
  {description:'Cinema',date:'2026-11-15',type:'Despesa',category:'Lazer',amount:8400,paymentMethod:'Pix',status:'Pago'}
];
const categories = {Receita:['Salário','Outras receitas'],Despesa:['Moradia','Alimentação','Transporte','Lazer','Outras despesas'],Transferência:['Transferência']};
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const format = cents => currency.format(cents/100);
const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
const formatMonth = month => monthLabel.format(new Date(month + '-01T00:00:00Z'));
const main = document.querySelector('main');
const scenario = document.querySelector('#scenario');
let selectedMonth = '2026-11';
const filters = {allMonths:false,type:'',category:'',paymentMethod:''};
const paymentMethods = ['Pix','Cartão de crédito','Cartão de débito','Débito automático','Boleto bancário','Transferência','Crédito em conta'];
const transactionStatuses = ['Pago','Pendente'];
let listPage = 1;
let listPageSize = 10;
const deletingTransactionIds = new Set();

function resetTransactionFilters(allMonths = false){
  Object.assign(filters,{allMonths,type:'',category:'',paymentMethod:''});
  listPage = 1;
}
let balanceHidden = false;
const search = document.querySelector('#search-query');
let query = '';
const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
const localPreview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.port === '4173';
const editIdFromRoute = () => Number(/^#editar\/(\d+)$/.exec(location.hash)?.[1]) || null;
const entryRoute = () => location.hash === '#novo' || editIdFromRoute() !== null;
let appMode = localPreview ? 'demo' : 'checking';
let entries = appMode === 'demo' ? initial.map((item,index) => ({...item,id:index+1})) : [];
let accountUser = null;
let accountEpoch = 0;
let accountState = 'idle';
let authBusy = false;
let saveBusy = false;
let sessionProblem = false;
let logoutProblem = false;
let authNotice = '';
const authLocation = new URL(location.href);
const googleError = authLocation.searchParams.get('auth_error');
const googleFailure = 'Não foi possível continuar com o Google. Tente novamente ou entre com seu e-mail.';
let googleNotice = googleError === 'google_link_required'
  ? 'Já existe uma conta com esse e-mail. Entre com sua senha e escolha Vincular conta Google em Configurações.'
  : googleError === 'google_failed' ? googleFailure : '';
if(googleError && googleNotice){
  authLocation.searchParams.delete('auth_error');
  history.replaceState(history.state,'',authLocation);
}
let message = '';
let draft = null;
let suspendedDraft = null;
const escape = value => String(value).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const records = () => appMode === 'demo' && scenario.value === 'empty' ? [] : entries;
const newest = items => [...items].reverse().sort((a,b)=>
  b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0)
);
const add = '<a class="nav primary" href="#novo"><span aria-hidden="true">＋</span>Novo lançamento</a>';
const rows = (items, recent = false) => '<ul>' + items.map(item => {
  const date = item.date.split('-').reverse().join('/');
  const expense = item.type === 'Despesa';
  const transfer = item.type === 'Transferência';
  const tone = transfer ? 'neutral' : expense ? 'debit' : 'credit';
  const iconTone = recent && item.category === 'Transporte' ? ' transport' : recent && item.category === 'Lazer' ? ' fun' : '';
  const icon = recent ? '<span class="material-symbols-outlined">' + ({
    Salário:'account_balance', Moradia:'account_balance_wallet', Alimentação:'shopping_basket',
    Transporte:'local_taxi', Lazer:'subscriptions'
  }[item.category] ?? 'payments') + '</span>' : expense ? '↓' : '↑';
  const metadata = recent
    ? '<small class="recent-meta"><span class="recent-tag ' + tone + '">' + item.category + '</span><span>' + date + '</span></small>'
    : '<small>' + date + ' · ' + item.category + ' · ' + item.type + '</small>';
  const amount = '<strong class="money '+tone+'">'+(transfer?'':expense?'−':'+')+format(item.amount)+'</strong>';
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

function utcDate(year, month, day){
  const date = new Date(0);
  date.setUTCFullYear(year,month,day);
  return date;
}

function fifthWeekday(year, month){
  const date = utcDate(year,month,1);
  for(let weekdays=0;;date.setUTCDate(date.getUTCDate()+1)){
    const weekday = date.getUTCDay();
    if(weekday >= 1 && weekday <= 5 && ++weekdays === 5) return date.toISOString().split('T')[0];
  }
}

function configuredSalaryDate(salaryDay, year, month, rule){
  if(rule === 'fifth_business_day' || (!rule && ['5-business','5'].includes(salaryDay))) return fifthWeekday(year,month-1);
  const lastDay = utcDate(year,month,0).getUTCDate();
  const day = !rule && salaryDay === '30' ? lastDay : Number(salaryDay);
  return utcDate(year,month-1,Math.min(day,lastDay)).toISOString().split('T')[0];
}

function salaryForecast(items, reference, user){
  const rule = user?.paydayRule;
  const salaryDay = rule ? user.paydayDay : user?.salaryDay;
  const fixedDay = Number(salaryDay);
  const salaries = items.filter(item => item.type === 'Receita' && item.category === 'Salário');
  const dates = salaries.map(item => item.date).sort();
  let date = dates.find(value => value >= reference);
  const estimated = !date;
  if(estimated && (rule === 'fifth_business_day' || salaryDay === '5-business' ||
    Number.isInteger(fixedDay) && fixedDay >= 1 && fixedDay <= 31)){
    const [year, monthNumber] = reference.split('-').map(Number);
    date = configuredSalaryDate(salaryDay,year,monthNumber,rule);
    if(date < reference) date = configuredSalaryDate(salaryDay,year,monthNumber+1,rule);
  }else if(estimated){
    const last = dates.at(-1);
    if(!last) return null;
    const [year, month, day] = last.split('-').map(Number);
    // Preserve the original day across short months and skip elapsed estimates.
    const [referenceYear, referenceMonth] = reference.split('-').map(Number);
    const earliest = Math.max(year * 12 + month, referenceYear * 12 + referenceMonth - 1);
    const estimate = offset => {
      const targetYear = Math.floor(offset / 12);
      const targetMonth = offset % 12 + 1;
      const end = utcDate(targetYear,targetMonth,0).getUTCDate();
      return utcDate(targetYear,targetMonth-1,Math.min(day,end)).toISOString().split('T')[0];
    };
    date = estimate(earliest);
    if(date < reference) date = estimate(earliest + 1);
  }
  if(date.startsWith('+')) return null;
  const openingDate = user?.carryOver === false ? reference.slice(0,7) + '-01' : '';
  const before = items.filter(item => item.date >= openingDate && item.date < date);
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
  if(accountUser){
    const name = [accountUser.displayName, accountUser.full_name, accountUser.name].find(value => typeof value === 'string' && value.trim());
    const firstName = name?.trim().split(/\s+/, 1)[0];
    home.querySelector('h1').textContent = firstName ? 'Olá, ' + firstName : 'Olá';
  }
  const today = localCalendarDate();
  const monthKey = today.slice(0,7);
  const monthText = formatMonth(monthKey);
  home.firstElementChild.dataset.homeDate = today;
  stitchSlot(home,'intro').textContent = 'Aqui está o resumo financeiro do seu mês de ' + monthText + '.';
  if(!showDashboard){
    home.querySelectorAll('.stitch-metrics,.mobile-quick,.stitch-spending,.home-recent').forEach(node=>node.remove());
    main.replaceChildren(home);
    return;
  }

  const items = records();
  const month = items.filter(item => item.date.startsWith(monthKey));
  const [year, monthNumber] = monthKey.split('-').map(Number);
  const days = utcDate(year,monthNumber,0).getUTCDate();
  const throughToday = items.filter(item => item.date <= today && (accountUser?.carryOver !== false || item.date.startsWith(monthKey)));
  const expenses = month.filter(item => item.type === 'Despesa');
  const spent = sum(expenses);
  const monthIncome = sum(month.filter(item => item.type === 'Receita'));
  const balance = sum(throughToday.filter(item => item.type === 'Receita'))
    - sum(throughToday.filter(item => item.type === 'Despesa'));
  const salary = salaryForecast(items, today, accountUser);
  const salaryDate = salary ? salaryDateLabel.format(new Date(salary.date)) : '';
  const salaryPeriod = salary ? (salary.days === 0 ? 'Hoje' : salary.days === 1 ? 'Falta 1 dia' : 'Faltam ' + salary.days + ' dias') + ' · ' + salaryDate : 'Sem data de salário';
  const recent = newest(month).slice(0,5);
  const moneyNumber = cents => currency.formatToParts(cents / 100).filter(part => part.type !== 'currency' && part.type !== 'literal').map(part => part.value).join('');
  const categoriesUsed = new Set(expenses.map(item=>item.category)).size;
  const values = {
    balance:moneyNumber(balance), 'balance-badge':'Até hoje',
    income:'+' + format(monthIncome), 'spent-summary':'−' + format(spent),
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
  home.querySelectorAll('[data-list-month]').forEach(link => link.addEventListener('click',()=>{
    search.value='';
    query='';
    selectedMonth=localCalendarDate().slice(0,7);
    resetTransactionFilters();
  }));
  main.replaceChildren(home);
}

const transactionDate = new Intl.DateTimeFormat('pt-BR', {timeZone:'UTC'});
const categoryIcons = {
  Salário:'account_balance', Moradia:'account_balance_wallet', Alimentação:'shopping_basket',
  Transporte:'local_taxi', Lazer:'subscriptions'
};
const signedMoney = (amount, sign) => (amount && sign ? sign + ' ' : '') + format(Math.abs(amount));

function adjacentMonth(month, step){
  if((month === '0001-01' && step < 0) || (month === '9999-12' && step > 0)) return '';
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.toISOString().slice(0,7);
}

function mountMonthPicker(root, allMonths, onChange){
  const slot = root.querySelector('[data-month-picker]');
  slot.replaceChildren(stitchTemplate('month-picker'));
  const label = slot.querySelector('[data-month-label]');
  const buttons = [...slot.querySelectorAll('[data-month-step]')];
  const update = () => {
    label.textContent = allMonths ? 'Todos os meses' : formatMonth(selectedMonth);
    buttons.forEach(button => {
      button.disabled = allMonths || !adjacentMonth(selectedMonth, Number(button.dataset.monthStep));
    });
  };
  update();
  buttons.forEach(button => button.addEventListener('click', () => {
    const step = Number(button.dataset.monthStep);
    selectedMonth = adjacentMonth(selectedMonth, step);
    update();
    onChange();
    const picker = main.querySelector('[data-month-picker]');
    const target = picker.querySelector('[data-month-step="' + step + '"]:enabled')
      ?? picker.querySelector('[data-month-step]:enabled');
    target?.focus({preventScroll:true});
  }));
}

function transactionsInPeriod(){
  return records().filter(item => filters.allMonths || item.date.startsWith(selectedMonth));
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
  const transfer = item.type === 'Transferência';
  const tone = transfer ? 'transfer' : income ? 'income' : 'expense';
  const date = transactionDate.format(new Date(item.date + 'T00:00:00Z'));
  const status = transactionStatuses.includes(item.status) ? item.status : '';
  const icon = categoryIcons[item.category] ?? (transfer ? 'sync_alt' : 'payments');
  const dateElement = '<time datetime="' + item.date + '">' + date + '</time>';
  const category = escape(item.category);
  const payment = escape(item.paymentMethod || 'Não informada') + (item.destinationPaymentMethod ? ' → ' + escape(item.destinationPaymentMethod) : '');
  return '<tr role="row" data-tone="' + tone + '">'
    + '<td role="cell">' + dateElement + '</td>'
    + '<td role="cell"><div class="transactions-description"><span class="transactions-category-icon material-symbols-outlined" aria-hidden="true">' + icon + '</span><div><strong>' + escape(item.description) + '</strong>'
    + '<small class="transactions-mobile-only transactions-row-meta">' + category + ' · ' + payment + ' · ' + dateElement + '</small></div></div></td>'
    + '<td role="cell"><span class="transactions-category">' + category + '</span></td>'
    + '<td role="cell"><span class="transactions-payment">' + payment + '</span></td>'
    + '<td role="cell"><span class="transactions-status" data-status="' + (status ? status.toLowerCase() : 'unknown') + '">'
    + (status ? '<span aria-hidden="true">' + (status === 'Pago' ? '✓' : '◷') + '</span> ' : '') + (status || 'Não informado') + '</span></td>'
    + '<td role="cell" class="transactions-amount" data-tone="' + tone + '">' + signedMoney(item.amount, transfer ? '' : income ? '+' : '−') + '</td>'
    + '<td role="cell" class="transactions-action"><div class="transactions-row-actions">' + receiptLink(item)
    + '<a class="transactions-edit" href="#editar/' + item.id + '" aria-label="Editar lançamento ' + escape(item.description) + ' de ' + date + '" title="Editar lançamento">' + entryIcon('edit') + '</a>'
    + '<button type="button" class="transactions-delete" data-delete-id="' + item.id + '" aria-label="Excluir lançamento ' + escape(item.description) + ' de ' + date + '" title="Excluir lançamento"' + (deletingTransactionIds.has(item.id) ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/></svg></button></div></td>'
    + '</tr>';
}

function updateTransactionSummary(inPeriod){
  const incomes = inPeriod.filter(item => item.type === 'Receita');
  const expenses = inPeriod.filter(item => item.type === 'Despesa');
  const income = sum(incomes);
  const expense = sum(expenses);
  const monthly = monthlyBalance(records(), filters.allMonths ? '' : selectedMonth);
  if(accountUser?.carryOver === false){
    monthly.total -= monthly.carryOver;
    monthly.carryOver = 0;
  }
  const periodNet = income - expense;
  stitchSlot(main,'period-net').textContent = signedMoney(periodNet, periodNet < 0 ? '−' : '+');
  main.querySelector('[data-total=income]').textContent = signedMoney(income, '+');
  main.querySelector('[data-total=expense]').textContent = signedMoney(expense, '−');
  const balance = main.querySelector('[data-total=balance]');
  const carryOver = main.querySelector('[data-detail=carry-over]');
  balance.textContent = signedMoney(monthly.total, monthly.total < 0 ? '−' : '+');
  balance.classList.toggle('negative', monthly.total < 0);
  carryOver.textContent = signedMoney(monthly.carryOver, monthly.carryOver < 0 ? '−' : '+');
  carryOver.classList.toggle('negative', monthly.carryOver < 0);
  const monthlyExpenses = main.querySelector('[data-detail=monthly-expenses]');
  monthlyExpenses.textContent = signedMoney(monthly.expenses, '−');
  monthlyExpenses.classList.toggle('negative', monthly.expenses > 0);
  main.querySelector('[data-expenses-label]').textContent = filters.allMonths ? 'Despesas do período:' : 'Despesas do mês:';
  main.querySelector('[data-detail=income]').textContent = incomes.length + (incomes.length === 1 ? ' receita registrada' : ' receitas registradas');
  main.querySelector('[data-detail=expense]').textContent = expenses.length + (expenses.length === 1 ? ' despesa registrada' : ' despesas registradas');

}

function updateTransactionPeriod(){
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
  stitchSlot(main,'mobile-count').textContent = items.length + (items.length === 1 ? ' lançamento' : ' lançamentos');
  main.querySelector('.transactions-filter-toggle').classList.toggle('has-filters', Boolean(filters.category || filters.paymentMethod));
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
  link.download = 'finflow-lancamentos' + (filters.allMonths ? '' : '-' + selectedMonth) + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(file),1000);
}

function transactionDeleteNotice(text, error = false){
  const notice = main.querySelector('.transactions-notice');
  if(!notice){message = text;return;}
  notice.setAttribute('role',error ? 'alert' : 'status');
  notice.hidden = false;
  notice.textContent = text;
}

async function deleteTransaction(dialog, button){
  const id = Number(button.dataset.deleteId);
  if(!entries.some(item => item.id === id) || deletingTransactionIds.has(id)) return;
  const epoch = accountEpoch;
  const row = button.closest('tr');
  const nextButton = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector('.transactions-delete');
  const confirmation = dialog.querySelector('[data-delete-confirm]');
  const confirmationLabel = confirmation.querySelector('span');
  const cancel = dialog.querySelector('[data-delete-cancel]');
  const alert = dialog.querySelector('.transactions-delete-error');
  deletingTransactionIds.add(id);
  confirmation.disabled = true;
  cancel.disabled = true;
  dialog.setAttribute('aria-busy','true');
  confirmationLabel.textContent = 'Excluindo…';
  alert.textContent = '';

  let alreadyUnavailable = false;
  try{
    if(appMode !== 'demo') await apiRequest('/api/transactions/' + id, undefined, 'DELETE');
  }catch(error){
    if(epoch !== accountEpoch) return;
    if(error.status === 401){expireAccount();return;}
    if(error.status !== 404){
      dialog.removeAttribute('aria-busy');
      alert.textContent = 'Não foi possível excluir o lançamento. Tente novamente.';
      confirmation.disabled = false;
      cancel.disabled = false;
      confirmationLabel.textContent = 'Sim, excluir';
      confirmation.focus();
      return;
    }
    alreadyUnavailable = true;
  }finally{
    deletingTransactionIds.delete(id);
  }
  if(epoch !== accountEpoch) return;
  entries = entries.filter(entry => entry.id !== id);
  if(!dialog.isConnected) return;

  dialog.close();
  const focusTarget = nextButton ?? main.querySelector('#transactions-query');
  focusTarget?.focus({preventScroll:true});
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    await row.animate(
      [{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-8px)'}],
      {duration:160,easing:'ease-out',fill:'forwards'}
    ).finished;
  }
  if(!dialog.isConnected || epoch !== accountEpoch) return;
  dialog.removeAttribute('aria-busy');
  const focusedId = document.activeElement?.dataset.deleteId;
  updateTransactionPeriod();
  listResults();
  if(focusedId){
    const target = main.querySelector('.transactions-delete[data-delete-id="' + focusedId + '"]')
      ?? main.querySelector('.transactions-delete')
      ?? main.querySelector('#transactions-query');
    target?.focus({preventScroll:true});
  }
  transactionDeleteNotice(alreadyUnavailable ? 'O lançamento já estava indisponível.' : 'Lançamento excluído.');
}

function confirmTransactionDeletion(button, dialog){
  const id = Number(button.dataset.deleteId);
  const item = entries.find(entry => entry.id === id);
  if(!item || deletingTransactionIds.has(id) || dialog.open) return;
  const date = transactionDate.format(new Date(item.date + 'T00:00:00Z'));
  const transfer = item.type === 'Transferência';
  const income = item.type === 'Receita';
  const amount = dialog.querySelector('[data-delete-amount]');
  amount.dataset.tone = transfer ? 'transfer' : income ? 'income' : 'expense';
  amount.textContent = signedMoney(item.amount, transfer ? '' : income ? '+' : '−');
  dialog.querySelector('#transactions-delete-description').textContent =
    'Tem certeza que deseja excluir o lançamento “' + item.description + '” de ' + date + '? Essa ação não poderá ser desfeita.';
  dialog.querySelector('[data-delete-details]').textContent = item.description + ' • ' + date;
  dialog.querySelector('.transactions-delete-error').textContent = '';
  const confirmation = dialog.querySelector('[data-delete-confirm]');
  confirmation.disabled = false;
  confirmation.querySelector('span').textContent = 'Sim, excluir';
  dialog.querySelector('[data-delete-cancel]').disabled = false;
  dialog.showModal();
}

const transactionsMobile = matchMedia('(width < 768px)');
function syncTransactionsSummary(summary){
  const balance = summary.querySelector('[data-tone=balance]');
  if(transactionsMobile.matches){
    summary.prepend(balance);
    summary.tabIndex = 0;
    summary.scrollLeft = 0;
  }else{
    summary.append(balance);
    summary.removeAttribute('tabindex');
  }
}
transactionsMobile.addEventListener('change', () => {
  const summary = main.querySelector('.transactions-summary');
  if(summary) syncTransactionsSummary(summary);
});

function mountTransactions(){
  main.replaceChildren(stitchTemplate('transactions'));
  const summary = main.querySelector('.transactions-summary');
  syncTransactionsSummary(summary);
  summary.addEventListener('keydown', event => {
    if(!transactionsMobile.matches || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const [first, second] = summary.children;
    const stride = second.offsetLeft - first.offsetLeft;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    summary.scrollLeft = (Math.round(summary.scrollLeft / stride) + direction) * stride;
  });
  const filterToggle = main.querySelector('.transactions-filter-toggle');
  filterToggle.addEventListener('click', () => {
    filterToggle.setAttribute('aria-expanded', String(filterToggle.getAttribute('aria-expanded') !== 'true'));
  });
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

  mountMonthPicker(main, filters.allMonths, () => {
    updateTransactionPeriod();
    listResults(true);
  });
  listSearch.addEventListener('input', () => {
    search.value = listSearch.value;
    query = searchKey(listSearch.value);
    listResults(true);
  });
  const typeFilters = main.querySelector('.transactions-types');
  typeFilters.addEventListener('focusin', event => {
    if(!transactionsMobile.matches || typeFilters.scrollWidth <= typeFilters.clientWidth) return;
    const chip = event.target.getBoundingClientRect();
    const track = typeFilters.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(typeFilters).scrollPaddingInlineStart) || 0;
    const start = chip.left - track.left - inset;
    const end = chip.right - track.right + inset;
    if(start < 0) typeFilters.scrollLeft += start;
    else if(end > 0) typeFilters.scrollLeft += end;
  });
  typeFilters.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
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
  const deleteDialog = main.querySelector('.transactions-delete-dialog');
  let deleteTrigger;
  let backdropPress = false;
  const dismissDeletion = () => {
    if(deleteDialog.hasAttribute('aria-busy')) return;
    deleteDialog.close();
    deleteTrigger?.focus({preventScroll:true});
  };
  deleteDialog.querySelector('[data-delete-cancel]').addEventListener('click',dismissDeletion);
  deleteDialog.addEventListener('cancel',event => {
    event.preventDefault();
    dismissDeletion();
  });
  deleteDialog.addEventListener('pointerdown',event => {
    backdropPress = event.target === deleteDialog;
  });
  deleteDialog.addEventListener('click',event => {
    if(backdropPress && event.target === deleteDialog) dismissDeletion();
    backdropPress = false;
  });
  deleteDialog.querySelector('form').addEventListener('submit',event => {
    event.preventDefault();
    if(deleteTrigger && deleteDialog.open) deleteTransaction(deleteDialog,deleteTrigger);
  });
  main.querySelector('.transactions-table tbody').addEventListener('click', event => {
    const button = event.target.closest('button[data-delete-id]');
    if(button){
      if(!deleteDialog.open && !deleteDialog.hasAttribute('aria-busy')){
        deleteTrigger = button;
        confirmTransactionDeletion(button,deleteDialog);
      }
      return;
    }
    const receipt = event.target.closest('[data-receipt-id]');
    if(receipt) downloadDemoReceipt(Number(receipt.dataset.receiptId));
  });
  updateTransactionPeriod();
  updateTransactionTypes();
  listResults();
}

const accountTools = document.querySelector('.account-tools');
const googleLink = document.querySelector('#account-google-link');
const googleLinkStatus = document.querySelector('#account-google-status');
const accountChannel = appMode === 'checking' && typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('finflow-account-local') : null;

async function apiRequest(path, body, method){
  const request = {cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)};
  if(method) request.method=method;
  if(body !== undefined){
    request.method=method ?? 'POST';
    request.headers={'Content-Type':'application/json'};
    request.body=JSON.stringify(body);
  }
  const response = await fetch(path,request);
  if(!response.ok) throw Object.assign(new Error('API request failed'),{status:response.status});
  return response.status === 204 ? null : response.json();
}

async function linkGoogleAccount(googleLink, googleLinkStatus){
  if(!accountUser || googleLink.disabled) return;
  const epoch=accountEpoch;
  googleLink.disabled=true;
  googleLinkStatus.textContent='Abrindo o Google…';
  try{
    const result=await apiRequest('/api/auth/google/link',{});
    if(accountEpoch!==epoch){
      googleLink.disabled=false;
      return;
    }
    const destination=new URL(result.url);
    if(destination.protocol!=='https:' || destination.username || destination.password
      || destination.pathname!=='/auth/v1/authorize' || destination.searchParams.get('provider')!=='google'
      || destination.searchParams.get('redirect_to')!==location.origin+'/api/auth/google/callback'){
      throw new Error('Invalid Google authorization URL');
    }
    location.assign(destination.href);
  }catch(error){
    googleLink.disabled=false;
    if(accountEpoch!==epoch) return;
    if(error.status===401){expireAccount();return;}
    googleLinkStatus.textContent=error.status===503 || error.status===404
      ? 'Vinculação com o Google indisponível no momento.'
      : 'Não foi possível vincular a conta Google. Tente novamente.';
  }
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
  preferenceState=null;
  accountUser=null;
  accountState='idle';
  entries=[];
  draft=null;
  message='';
  saveBusy=false;
  balanceHidden=false;
  query='';
  search.value='';
  selectedMonth=localCalendarDate().slice(0,7);
  resetTransactionFilters();
  listPageSize=10;
}

function suspendEntryDraft(user, entryDraft){
  if(user && entryDraft && entryRoute()){
    suspendedDraft={ownerId:user.id,entryDraft};
  }
}

function resumeEntryDraft(user){
  const entryDraft=suspendedDraft?.ownerId===user.id ? suspendedDraft.entryDraft : null;
  suspendedDraft=null;
  return entryDraft;
}

function expireAccount(){
  suspendEntryDraft(accountUser,draft);
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
  const previousUser=accountUser;
  const previousDraft=draft;
  const previousView={month:selectedMonth,filters:{...filters},query,search:search.value,balanceHidden,listPage,listPageSize};
  suspendEntryDraft(previousUser,previousDraft);
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
    if(googleNotice){
      googleLinkStatus.textContent='Não foi possível vincular a conta Google. Tente novamente.';
      accountTools.closest('details').open=true;
      googleNotice='';
      if(location.hash==='#login') history.replaceState(history.state,'','#painel');
    }
    draft=resumeEntryDraft(user);
    if(user.id===previousUser?.id){
      draft=previousDraft ?? draft;
      selectedMonth=previousView.month;
      Object.assign(filters,previousView.filters);
      ({listPage,listPageSize}=previousView);
      query=previousView.query;
      search.value=previousView.search;
      balanceHidden=previousView.balanceHidden;
    }
  }catch(error){
    if(epoch!==accountEpoch) return;
    appMode='account';
    sessionProblem=error.status!==401;
    if(!sessionProblem && previousUser) authNotice='Sua sessão expirou. Entre novamente para continuar.';
  }finally{
    if(epoch===accountEpoch) authBusy=false;
  }
  if(accountUser) await loadAccountTransactions();
  else render(false);
}

async function logout(){
  if(authBusy || settingsWriting) return;
  const owner = accountUser?.id || logoutProblem;
  const startingEpoch = accountEpoch;
  if(!owner) return;
  const state = preferenceState;
  if(state){
    await (state.saving ?? drainPreferences(state));
    if(preferenceState !== state) return;
  }
  if(authBusy || settingsWriting || accountEpoch !== startingEpoch) return;
  suspendedDraft=null;
  forgetAccount();
  const epoch=accountEpoch;
  authBusy=true;
  logoutProblem=false;
  authNotice='';
  document.querySelector('.toolbar-settings').open=false;
  render(true);
  let sessionChanged = false;
  try{
    await apiRequest('/api/auth/logout',{expectedUserId:owner});
  }catch(error){
    if(epoch!==accountEpoch) return;
    sessionChanged = error.status === 409;
    if(!sessionChanged && error.status !== 401) logoutProblem=owner;
  }finally{
    if(epoch===accountEpoch) authBusy=false;
  }
  if(epoch!==accountEpoch) return;
  if(sessionChanged){
    await restoreAccount();
    showSettingsToast('A sessão mudou. Confira qual conta está aberta.');
    return;
  }
  if(!logoutProblem){
    accountChannel?.postMessage('account-changed');
    if(location.hash!=='#login') location.hash='login';
  }
  render(true);
}

let settingsWriting = false;
let preferenceState = null;
let settingsToastTimer;

function settingsPreferenceState(){
  if(!accountUser) return null;
  if(!preferenceState){
    preferenceState = {owner:accountUser.id, epoch:accountEpoch, pending:{}, inFlight:{}, saving:null, failed:false};
  }
  return preferenceState;
}

function showSettingsToast(text){
  const toast = main.querySelector('.settings-toast');
  if(!toast) return;
  clearTimeout(settingsToastTimer);
  toast.textContent=text;
  settingsToastTimer=setTimeout(()=>{toast.textContent='';},2800);
}

function showPreferenceStatus(state){
  const form = main.querySelector('#settings-preferences-form');
  if(!form || preferenceState !== state) return;
  const retry = form.querySelector('[data-preference-retry]');
  const feedback = form.querySelector('.settings-feedback');
  const wasRetryFocused = document.activeElement === retry;
  retry.hidden = !state.failed;
  const error = state.failed ? 'Não foi possível salvar as preferências. Suas alterações foram mantidas para tentar novamente.' : '';
  if(feedback.textContent !== error) feedback.textContent=error;
  form.setAttribute('aria-busy',String(Boolean(state.saving && !state.failed)));
  if(wasRetryFocused && retry.hidden) form.querySelector('input:checked, select')?.focus({preventScroll:true});
}

function applySettingsProfile(updated){
  accountUser = updated;
  if(!Object.hasOwn(preferenceState?.pending ?? {},'theme')) updateAccountChrome(false);
  const stamp = main.querySelector('[data-settings-sync]');
  if(stamp){
    stamp.textContent=accountDate(updated.updatedAt,{dateStyle:'short',timeStyle:'short'});
    stamp.parentElement.hidden=!stamp.textContent;
  }
}

async function handleSettingsSessionError(error){
  if(error.status === 401){expireAccount();return true;}
  if(error.status === 409){
    await restoreAccount();
    showSettingsToast('A sessão mudou. Confira qual conta está aberta.');
    return true;
  }
  return false;
}

function drainPreferences(state){
  if(!state || preferenceState !== state) return;
  if(settingsWriting || state.failed || state.saving || !Object.keys(state.pending).length) return state.saving;
  state.saving = (async()=>{
    while(preferenceState === state && !settingsWriting && Object.keys(state.pending).length){
      const patch = state.pending;
      state.pending = {};
      state.inFlight = patch;
      try{
        const updated = requireAccountUser(await apiRequest('/api/auth/profile',{...patch,expectedUserId:state.owner},'PATCH'));
        if(accountEpoch !== state.epoch) return;
        if(updated.id !== state.owner) throw new Error('Invalid account response');
        applySettingsProfile(updated);
        if(!Object.keys(state.pending).length) showSettingsToast('Preferências salvas.');
      }catch(error){
        if(accountEpoch !== state.epoch || await handleSettingsSessionError(error)) return;
        state.pending = {...patch,...state.pending};
        state.failed = true;
        updateAccountChrome(false);
        return;
      }finally{
        state.inFlight = {};
      }
    }
  })().finally(()=>{
    state.saving = null;
    showPreferenceStatus(state);
  });
  showPreferenceStatus(state);
  return state.saving;
}


function accountName(){
  return accountUser?.displayName || accountUser?.full_name || accountUser?.name
    || (accountUser ? 'Minha conta' : 'Beatriz');
}

function accountInitials(name){
  return name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase('pt-BR');
}

function accountDate(value, options){
  const date = new Date(value);
  return value && Number.isFinite(date.valueOf()) ? date.toLocaleString('pt-BR',options) : '';
}

function formatAccountPhone(value){
  const digits = value.replace(/\D/g,'');
  const national = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  const match = /^(\d{2})(\d{4,5})(\d{4})$/.exec(national);
  return match ? '+55 (' + match[1] + ') ' + match[2] + '-' + match[3] : value.trim();
}

function mountSettings(focus){
  const user = accountUser;
  const state = settingsPreferenceState();
  const preferences = {...user,...state?.inFlight,...state?.pending};
  const name = accountName();
  const locked = user ? '' : 'disabled';
  const checked = value => value ? ' checked' : '';
  const fifth = user?.paydayRule === 'fifth_business_day'
    || !user?.paydayRule && ['5','5-business'].includes(user?.salaryDay);
  const avatar = /^https:\/\/lh[0-9]+\.googleusercontent\.com\//i.test(user?.googleAvatarUrl ?? '') ? user.googleAvatarUrl : '';
  const joined = accountDate(user?.createdAt,{month:'long',year:'numeric',timeZone:'UTC'});
  const synced = accountDate(user?.updatedAt,{dateStyle:'short',timeStyle:'short'});
  const paths = {
    "badge": "M8 7V4h8v3 M5 7h14a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a2 2 0 0 1 2-2Z M7 15h4m3-3h3m-3 4h3 M9 12h.01",
    "check": "m5 12 4 4L19 6",
    "link": "M10 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2m3 5a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2",
    "account_balance": "m3 9 9-5 9 5H3Zm2 11h14M7 12v5m5-5v5m5-5v5",
    "tune": "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
    "warning": "M12 4 3 20h18L12 4Zm0 6v4m0 3h.01"
  };
  const icon = name => '<svg class="settings-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[name]+'"/></svg>';
  main.innerHTML = `
    <div class="settings-content">
      <p class="settings-breadcrumb"><a href="#painel">Finanças pessoais</a> / Configurações</p>
      <div class="settings-heading">
        <div><h1 tabindex="-1">Configurações da Conta</h1>
          <p>Gerencie suas informações pessoais, preferências financeiras e segurança.</p></div>
        <span class="settings-sync" ${synced ? '' : 'hidden'}>Última atualização do perfil: <span data-settings-sync>${escape(synced)}</span></span>
      </div>
      <nav class="settings-pills" aria-label="Seções de configurações">
        <button type="button" data-settings-target="settings-profile" aria-current="location">Perfil</button>
        <button type="button" data-settings-target="settings-preferences">Preferências Financeiras</button>
        <button type="button" data-settings-target="settings-security">Segurança &amp; Login</button>
      </nav>
      ${user ? '' : '<p class="settings-demo">Demonstração com dados fictícios. Entre em uma conta para alterar configurações.</p>'}
      <section class="settings-card" aria-labelledby="settings-profile">
        <h2 id="settings-profile" tabindex="-1">${icon('badge')} Informações Pessoais</h2>
        <p>Atualize os dados exibidos no seu painel.</p>
        <div class="settings-identity">
          <span class="settings-avatar" aria-hidden="true" data-settings-initials>${escape(accountInitials(name))}${avatar ? '<img src="'+escape(avatar)+'" alt="" referrerpolicy="no-referrer" hidden>' : ''}</span>
          <div><strong data-settings-name>${escape(name)}</strong> ${user ? '<span class="settings-status">Conta ativa</span>' : ''}
            ${user ? '<small>'+escape(user.email)+'</small>' : ''}
            ${joined ? '<small>Membro desde '+escape(joined)+'</small>' : ''}</div>
        </div>
        <form id="settings-profile-form">
          <fieldset ${locked}>
            <div class="settings-fields">
              <label>Nome completo<input name="displayName" autocomplete="name" required maxlength="100" value="${escape(name)}"></label>
              <label><span class="settings-email-label">E-mail ${user?.emailVerified === true ? '<span class="settings-verified">'+icon('check')+' Verificado</span>' : ''} </span>
                <input name="email" type="email" autocomplete="email" readonly value="${escape(user?.email ?? '')}"></label>
              <label>Telefone / WhatsApp (opcional)<input name="phone" type="tel" autocomplete="tel" maxlength="32" value="${escape(formatAccountPhone(user?.phone ?? ''))}"></label>
              <div><label for="settings-payday-rule">Recebimento do salário</label>
                <select name="payday" id="settings-payday-rule">
                  ${Array.from({length:31},(_,index)=>{
                    const day = index + 1;
                    return '<option value="'+day+'"'+(!fifth && day === (Number(user?.paydayDay ?? user?.salaryDay) || 1) ? ' selected' : '')+'>Dia '+String(day).padStart(2,'0')+'</option>';
                  }).join('')}
                  <option value="fifth_business_day"${fifth ? ' selected' : ''}>5º dia útil</option>
                </select>
              </div>
            </div>
            <div class="settings-actions"><button class="settings-primary" type="submit">${icon('check')} Salvar alterações</button></div>
          </fieldset>
          <p class="settings-feedback" role="alert"></p>
        </form>
      </section>
      <section class="settings-card" aria-labelledby="settings-security">
        <h2 id="settings-security" tabindex="-1">${icon('link')} Contas Conectadas</h2>
        <p>Serviços vinculados para acesso à sua conta.</p>
        <div class="settings-service"><span class="settings-service-logo"><img width="22" height="22" alt="" src="data:image/png;base64,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"></span>
          <div class="settings-service-copy"><strong>Conta Google</strong><small>${user?.googleLinked ? escape(user.googleEmail || 'Conectada') : user?.googleAvailable ? 'Disponível para vincular' : 'Indisponível no momento'}</small></div>
          ${user?.googleLinked ? '<div class="settings-service-actions"><span class="settings-status">'+icon('check')+' Conectado</span><a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Gerenciar</a></div>'
            : '<button type="button" data-settings-google '+(user?.googleAvailable ? '' : 'disabled')+'>Vincular</button>'}
        </div>
        <p data-settings-google-status role="status"></p>
        <div class="settings-service">${icon('account_balance')}
          <div><strong>Open Finance Brasil</strong><small>Indisponível no momento</small></div>
          <button type="button" data-settings-open="settings-open-finance">Saiba mais</button>
        </div>
        ${user ? '<div class="settings-actions"><button type="button" data-settings-logout>Sair da conta</button></div>' : ''}
      </section>
      <section class="settings-card" aria-labelledby="settings-preferences">
        <h2 id="settings-preferences" tabindex="-1">${icon('tune')} Preferências do Sistema</h2>
        <p>Configure a aparência e os cálculos financeiros do FinFlow.</p>
        <form id="settings-preferences-form">
          <fieldset ${locked}>
            <div class="settings-option">
              <div><span id="settings-theme-label">Tema da interface</span><small>Escolha a aparência do painel.</small></div>
              <div class="settings-theme" role="group" aria-labelledby="settings-theme-label">
                <label><input type="radio" name="theme" value="light"${checked(preferences.theme !== 'dark')}><span>Claro</span></label>
                <label><input type="radio" name="theme" value="dark"${checked(preferences.theme === 'dark')}><span>Escuro</span></label>
              </div>
            </div>
            <label class="settings-option">
              <span>Transportar saldo do mês anterior<small>Inclui o saldo anterior no total do mês.</small></span>
              <input type="checkbox" role="switch" name="carryOver"${checked(preferences.carryOver !== false)}>
            </label>
            <label class="settings-option">
              <span>Formatação automática de valores<small>Preenche as casas decimais ao digitar lançamentos.</small></span>
              <input type="checkbox" role="switch" name="amountMask"${checked(preferences.amountMask !== false)}>
            </label>
            <div class="settings-option">
              <div><label for="settings-currency">Moeda principal</label><small>Moeda dos lançamentos e extratos.</small></div>
              <select name="currency" id="settings-currency"><option value="BRL">BRL (R$) – Real Brasileiro</option></select>
            </div>
          </fieldset>
          <p class="settings-feedback" role="alert"></p>
          <button type="button" data-preference-retry hidden>Tentar novamente</button>
        </form>
      </section>
      <section class="settings-card settings-danger" aria-labelledby="settings-danger-title">
        <div><h2 id="settings-danger-title"><span class="settings-warning">${icon('warning')}</span> Excluir conta e todos os dados</h2>
          <p>Remove permanentemente seus lançamentos e configurações. Essa ação não pode ser desfeita.</p></div>
        <button type="button" data-settings-open="settings-delete" ${locked}>Excluir minha conta</button>
      </section>
      <dialog id="settings-open-finance" aria-labelledby="settings-finance-title">
        <h2 id="settings-finance-title">Open Finance Brasil</h2>
        <p>A conexão automática com instituições financeiras ainda está indisponível.</p>
        <form method="dialog" class="settings-actions"><button autofocus>Fechar</button></form>
      </dialog>
      <dialog id="settings-delete" aria-labelledby="settings-delete-title" aria-describedby="settings-delete-description">
        <h2 id="settings-delete-title">Excluir minha conta?</h2>
        <p id="settings-delete-description">Sua conta FinFlow, seus lançamentos e suas configurações serão excluídos permanentemente. ${user?.googleLinked === true ? 'A conta Google vinculada continuará existindo no Google.' : ''}</p>
        <form id="settings-delete-form">
          <label class="settings-confirm"><input type="checkbox" required> Confirmo a exclusão permanente da minha conta e dos meus dados.</label>
          <p class="settings-feedback" role="alert"></p>
          <div class="settings-actions"><button type="button" data-settings-cancel autofocus>Cancelar</button><button type="submit">Excluir permanentemente</button></div>
        </form>
      </dialog>
      <p class="settings-toast" role="status"></p>
    </div>`;
  wireSettings();
  if(focus) main.querySelector('h1').focus();
}

function wireSettings(){
  const expectedUserId = accountUser?.id;
  const root = main.querySelector('.settings-content');
  const avatar = root.querySelector('.settings-identity img');
  if(avatar){
    const reveal = () => {avatar.hidden = false;};
    if(avatar.complete && avatar.naturalWidth) reveal();
    else avatar.addEventListener('load',reveal,{once:true});
  }
  const profile = root.querySelector('#settings-profile-form');
  const preferences = root.querySelector('#settings-preferences-form');
  const deletion = root.querySelector('#settings-delete-form');
  const dialog = deletion.closest('dialog');
  const payday = profile.elements.payday;
  const phone = profile.elements.phone;
  const state = settingsPreferenceState();
  if(state){
    preferences.addEventListener('submit',event=>event.preventDefault());
    preferences.addEventListener('change',event=>{
      if(preferenceState !== state) return;
      const control = event.target;
      if(!['theme','carryOver','amountMask','currency'].includes(control.name)) return;
      state.pending[control.name] = control.type === 'checkbox' ? control.checked : control.value;
      state.failed = false;
      clearTimeout(settingsToastTimer);
      root.querySelector('.settings-toast').textContent='';
      drainPreferences(state);
    });
    preferences.querySelector('[data-preference-retry]').addEventListener('click',()=>{
      if(preferenceState !== state) return;
      state.failed = false;
      drainPreferences(state);
    });
    showPreferenceStatus(state);
  }

  root.querySelectorAll('[data-settings-target]').forEach(button=>button.addEventListener('click',()=>{
    root.querySelector('[aria-current="location"]')?.removeAttribute('aria-current');
    button.setAttribute('aria-current','location');
    button.scrollIntoView({block:'nearest',inline:'nearest'});
    const target = document.getElementById(button.dataset.settingsTarget);
    target.focus({preventScroll:true});
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({block:'start',behavior:reducedMotion ? 'instant' : 'smooth'});
  }));
  root.querySelectorAll('[data-settings-open]').forEach(button=>button.addEventListener('click',()=>{
    document.getElementById(button.dataset.settingsOpen).showModal();
  }));
  root.querySelector('[data-settings-cancel]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{
    if(settingsWriting) event.preventDefault();
  });
  dialog.addEventListener('close',()=>{
    deletion.reset();
    deletion.querySelector('.settings-feedback').textContent='';
  });
  root.querySelector('[data-settings-logout]')?.addEventListener('click',()=>{
    if(!settingsWriting) logout();
  });
  root.querySelectorAll('[data-settings-target]').forEach(button=>button.addEventListener('focus',()=>{
    button.scrollIntoView({block:'nearest',inline:'nearest'});
  }));
  const google = root.querySelector('[data-settings-google]');
  google?.addEventListener('click',()=>{
    if(!settingsWriting) linkGoogleAccount(google,root.querySelector('[data-settings-google-status]'));
  });
  phone.addEventListener('blur',()=>{phone.value = formatAccountPhone(phone.value);});

  const submit = (form, save, busyText, errorText) => form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!expectedUserId || accountUser?.id !== expectedUserId || settingsWriting) return;
    const epoch = accountEpoch;
    const owner = accountUser.id;
    const feedback = form.querySelector('.settings-feedback');
    const button = event.submitter ?? form.querySelector('[type="submit"]');
    const originalLabel = button.innerHTML;
    feedback.textContent='';
    settingsWriting = true;
    const fields = [...form.elements].filter(field=>!field.disabled);
    fields.forEach(field=>{field.disabled=true;});
    button.textContent=busyText;
    form.setAttribute('aria-busy','true');
    try{
      await state?.saving;
      if(epoch !== accountEpoch) return;
      const finish = await save();
      if(epoch === accountEpoch && accountUser?.id === owner) finish();
    }catch(error){
      if(epoch !== accountEpoch) return;
      if(await handleSettingsSessionError(error)) return;
      feedback.textContent = error.status === 400 || error.status === 422
        ? 'Confira os dados informados e tente novamente.' : errorText;
    }finally{
      settingsWriting = false;
      drainPreferences(preferenceState);
      fields.forEach(field=>{field.disabled=false;});
      button.innerHTML=originalLabel;
      form.removeAttribute('aria-busy');
      if(form.isConnected && document.activeElement === document.body) button.focus();
    }
  });
  const saveProfile = (values, notice) => async () => {
    const updated = requireAccountUser(await apiRequest('/api/auth/profile',{...values(),expectedUserId},'PATCH'));
    return () => {
      if(updated.id !== accountUser.id) throw new Error('Invalid account response');
      applySettingsProfile(updated);
      if(!root.isConnected) return;
      const title = accountName();
      root.querySelector('[data-settings-name]').textContent=title;
      const initials = root.querySelector('[data-settings-initials]');
      initials.firstChild.nodeValue=accountInitials(title);
      showSettingsToast(notice);
    };
  };
  submit(profile,saveProfile(()=>({
    displayName:profile.elements.displayName.value.trim(),
    phone:phone.value.trim(),
    paydayRule:payday.value === 'fifth_business_day' ? payday.value : 'fixed',
    ...(payday.value === 'fifth_business_day' ? {} : {paydayDay:Number(payday.value)})
  }),'Perfil atualizado.'),'Salvando…','Não foi possível salvar o perfil. Tente novamente.');
  submit(deletion,async()=>{
    const result = await apiRequest('/api/user/account',{confirm:true,expectedUserId},'DELETE');
    if(result !== null) throw new Error('Invalid deletion response');
    return ()=>{
      suspendedDraft=null;
      forgetAccount();
      accountChannel?.postMessage('account-changed');
      authNotice='Conta excluída.';
      location.hash='login';
      render(true);
    };
  },'Excluindo…','Não foi possível excluir a conta. Tente novamente.');
}

function updateAccountChrome(authPreview){
  const theme = accountUser?.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    if(accountUser) localStorage.setItem('finflow-theme',theme);
    else localStorage.removeItem('finflow-theme');
  } catch {
    // The session preference still applies when browser storage is disabled.
  }
  document.querySelector('[data-mobile-menu]').setAttribute('aria-label', appMode==='demo' ? 'Configurações do protótipo' : 'Configurações da conta');
  document.querySelector('[data-account-name]').textContent = accountName();
  document.querySelector('[data-account-initials]').textContent = accountInitials(accountName());
  document.body.classList.toggle('account-mode',appMode!=='demo');
  document.body.classList.toggle('account-gated',authPreview||(appMode!=='demo'&&!accountUser));
  accountTools.hidden=!accountUser;
  googleLink.hidden = !accountUser?.googleAvailable || accountUser?.googleLinked === true;
  const email=accountTools.querySelector('.account-email');
  email.textContent=accountUser?.email ?? '';
  email.title=email.textContent;
  if(!accountUser && !authBusy) googleLinkStatus.textContent='';
}

function renderAccountGate(focus,authPreview){
  const register=location.hash==='#cadastro';
  const pending=appMode==='checking'||authBusy;
  const problem=sessionProblem||logoutProblem;
  if(pending||problem){
    const title=pending?'Verificando sessão…':logoutProblem?'Não foi possível encerrar a sessão':'Não foi possível verificar a sessão';
    main.innerHTML='<section class="card form account-card"><h1 tabindex="-1">'+title+'</h1>'
      +(pending?'<p role="status">Aguarde um momento.</p>':'<p role="alert">O serviço está indisponível no momento. Tente novamente.</p><button id="account-retry">Tentar novamente</button>')+'</section>';
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
    const googleButton=main.querySelector('.auth-google');
    googleButton.disabled=authPreview;
    main.querySelector('#auth-google-unavailable').hidden=!authPreview;
    if(!authPreview){
      googleButton.removeAttribute('aria-describedby');
      googleButton.addEventListener('click',()=>{
        if(!authBusy) location.assign('/api/auth/google');
      });
    }
    main.querySelector('#auth-status').textContent=authNotice || googleNotice;
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
    if(googleError==='google_link_required' && googleNotice){
      accountTools.closest('details').open=true;
    }
    googleNotice='';
    authBusy=false;
    accountChannel?.postMessage('account-changed');
    draft=resumeEntryDraft(user);
    const destination=draft?.editId ? '#editar/'+draft.editId : draft ? '#novo' : '#painel';
    if(location.hash!==destination) location.hash=destination;
    await loadAccountTransactions();
  }catch(error){
    if(epoch!==accountEpoch) return;
    authNotice=registered?'Conta criada. Use Entrar para iniciar a sessão.'
      :error.status===409?'Esse e-mail não está disponível.'
      :error.status===401?'E-mail ou senha inválidos.'
      :error.status===400?'Confira o e-mail e a senha.'
      :error.status===429?'Muitas tentativas. Aguarde antes de tentar novamente.'
      :'Não foi possível conectar ao serviço. Tente novamente.';
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

let pendingEntryReturn = null;

function entryLinks(route){
  return [...main.querySelectorAll('a[href="' + route + '"]')];
}

function restoreEntryOrigin(){
  const {origin,notice} = pendingEntryReturn;
  pendingEntryReturn = null;
  render(false);
  const filterToggle = main.querySelector('.transactions-filter-toggle');
  if(filterToggle && origin.filtersExpanded) filterToggle.setAttribute('aria-expanded','true');
  if(notice && origin.hash === '#painel'){
    const toast = document.createElement('p');
    toast.className = 'entry-toast';
    toast.setAttribute('role','status');
    main.append(toast);
    requestAnimationFrame(() => {toast.textContent = notice;});
    setTimeout(() => toast.remove(),4000);
  }
  requestAnimationFrame(() => {
    if((location.hash || '#painel') !== origin.hash) return;
    window.scrollTo(0,origin.scroll ?? 0);
    const target = entryLinks(origin.route)[origin.trigger] ?? main.querySelector('.transactions-add, .stitch-add, h1');
    target?.focus({preventScroll:true});
  });
}

function finishMobileEntry(origin, notice = ''){
  pendingEntryReturn = {origin,notice};
  if(origin.hash === '#lancamentos') message = notice;
  if(history.state?.finflowEntry?.route === location.hash){
    history.back();
  }else{
    history.replaceState(history.state,'',origin.hash);
    restoreEntryOrigin();
  }
}

main.addEventListener('click',event=>{
  const trigger = event.target.closest('a[href]');
  if(!trigger || !transactionsMobile.matches || entryRoute() || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || trigger.target || trigger.hasAttribute('download')) return;
  const route = trigger.hash;
  if(route !== '#novo' && !/^#editar\/\d+$/.test(route)) return;
  event.preventDefault();
  const hash = document.body.classList.contains('transactions-view') ? '#lancamentos' : '#painel';
  const origin = {hash,route,trigger:entryLinks(route).indexOf(trigger),scroll:window.scrollY,
    filtersExpanded:main.querySelector('.transactions-filter-toggle')?.getAttribute('aria-expanded') === 'true'};
  history.pushState({...history.state,finflowEntry:origin},'',route);
  render(true);
});

function render(focus){
  entryEditor?.cleanup?.();
  entryEditor = null;
  const authPreview=appMode==='demo'&&(location.hash==='#login'||location.hash==='#cadastro');
  updateAccountChrome(authPreview);
  const savedOrigin = entryRoute() && history.state?.finflowEntry?.route === location.hash ? history.state.finflowEntry : null;
  const editId = editIdFromRoute();
  const item = editId === null ? null : records().find(record=>record.id === editId);
  const ready = appMode === 'demo' || accountUser && accountState === 'ready';
  const showSheet = Boolean(ready && !authPreview && entryRoute() && transactionsMobile.matches && (editId === null || item));
  const origin = savedOrigin ?? (showSheet ? {hash:'#lancamentos', route:location.hash} : null);
  const visibleRoute = showSheet ? origin.hash : location.hash;
  const listRoute = visibleRoute === '#lancamentos' && !authPreview && (appMode === 'demo' || accountUser);
  document.body.classList.toggle('transactions-view',!!listRoute);
  document.body.classList.toggle('entry-view',Boolean(entryRoute() && ready && !showSheet));
  document.body.classList.toggle('settings-view',visibleRoute==='#configuracoes' && (appMode==='demo'||Boolean(accountUser)));
  if(authPreview||(appMode!=='demo'&&!accountUser)){
    document.body.classList.remove('home-view');
    renderAccountGate(focus,authPreview);
    return;
  }
  if(accountUser&&accountState!=='ready'&&visibleRoute!=='#configuracoes'){
    main.innerHTML='<section class="card state-card"><h1 tabindex="-1">Lançamentos da conta</h1>'
      +(accountState==='error'?'<p role="alert">Não foi possível carregar os lançamentos.</p><button id="account-load-retry">Tentar novamente</button>':'<p role="status">Carregando lançamentos…</p>')+'</section>';
    main.querySelector('#account-load-retry')?.addEventListener('click',loadAccountTransactions);
    if(focus) main.querySelector('h1').focus();
    return;
  }
  if(visibleRoute==='#configuracoes'){
    document.body.classList.remove('home-view');
    document.querySelectorAll('nav [aria-current]').forEach(link=>link.removeAttribute('aria-current'));
    mountSettings(focus);
    return;
  }
  const view = entryRoute() && !showSheet ? 'novo' : visibleRoute === '#lancamentos' ? 'lancamentos' : 'painel';
  document.body.classList.toggle('home-view', view === 'painel');
  document.querySelectorAll('nav a').forEach(a=>{
    if(a.hash==='#'+(view==='novo'?'lancamentos':view)) a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  const heading = '<h1 tabindex="-1">' + (view==='novo'?'Novo lançamento':'Lançamentos') + '</h1>';
  const demoLoadError=appMode==='demo'&&scenario.value==='load';
  if(view==='painel') mountHome(!demoLoadError);
  else if(demoLoadError && view!=='novo') main.innerHTML='<div class="intro">'+heading+'</div>';
  if(view!=='novo'&&demoLoadError){
    main.insertAdjacentHTML('beforeend','<section class="card state-card"><p class="error" role="alert">Não foi possível carregar os dados.</p><button id="retry">Tentar novamente</button></section>');
    document.querySelector('#retry').onclick=()=>{scenario.value='normal';render(true);};
  }else if(view==='novo'){
    if(editId !== null && !item){
      main.innerHTML='<section class="card state-card"><h1 tabindex="-1">Lançamento indisponível</h1><p>Este lançamento não está disponível para edição.</p><a href="#lancamentos">Voltar para Lançamentos</a></section>';
    }else mountEntry(item,origin);
  }
  else if(view==='lancamentos') mountTransactions();
  if(showSheet){
    const filterToggle = main.querySelector('.transactions-filter-toggle');
    if(filterToggle && origin.filtersExpanded) filterToggle.setAttribute('aria-expanded','true');
    window.scrollTo(0,origin.scroll ?? 0);
    mountEntry(item,origin,true);
  }else if(focus) main.querySelector('h1').focus();
}
document.querySelector('#transaction-search').addEventListener('submit',event=>{
  event.preventDefault();
  setMobileSearch(false);
  query=searchKey(search.value);
  resetTransactionFilters(true);
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
  if(event.target.closest('a[href="#configuracoes"]')) document.querySelector('.toolbar-settings').open=false;
  if(event.target.closest('[data-mobile-menu]') && appMode!=='demo'){
    location.hash='configuracoes';
    return;
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
  if(entryRoute() && saveBusy) return;
  render(false);
});
transactionsMobile.addEventListener('change',()=>{
  if(entryRoute() && !saveBusy) render(true);
});
window.addEventListener('hashchange',()=>{
  if(entryEditor && entryEditor.route !== location.hash && !pendingEntryReturn){
    if(saveBusy || entryEditor.hasChanges()){
      history.pushState(entryEditor.state,'',entryEditor.route);
      entryEditor.requestClose();
      return;
    }
    draft = null;
    if((location.hash || '#painel') === entryEditor.origin.hash) pendingEntryReturn = {origin:entryEditor.origin};
  }
  if(pendingEntryReturn) restoreEntryOrigin();
  else render(true);
  if(pendingSpending){
    pendingSpending=false;
    showMobileSpending();
  }
});
document.querySelector('#account-logout').addEventListener('click',logout);
accountTools.closest('details').addEventListener('keydown',event=>{
  const settings=event.currentTarget;
  if(event.key!=='Escape' || !settings.open || accountTools.hidden) return;
  event.preventDefault();
  settings.open=false;
  settings.querySelector('summary').focus();
});
googleLink.addEventListener('click',()=>linkGoogleAccount(googleLink,googleLinkStatus));
function refreshHomeDate(){
  const home = main.querySelector('[data-home-date]');
  if(home && home.dataset.homeDate !== localCalendarDate()) render(false);
}

function scheduleHomeDateRefresh(){
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(()=>{
    refreshHomeDate();
    scheduleHomeDateRefresh();
  }, midnight - now);
}
scheduleHomeDateRefresh();

window.addEventListener('pageshow',event=>{
  if(!event.persisted) return;
  refreshHomeDate();
  googleLink.disabled=false;
  googleLinkStatus.textContent='';
});
accountChannel?.addEventListener('message',event=>{
  if(event.data==='account-changed'&&appMode==='account'&&!authBusy) restoreAccount();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible') return;
  if(accountUser&&!authBusy&&!saveBusy&&!settingsWriting&&!entryEditor&&!deletingTransactionIds.size&&accountState==='ready'&&location.hash!=='#configuracoes'
    &&!preferenceState?.saving&&!preferenceState?.failed) restoreAccount();
  else refreshHomeDate();
});
if(appMode==='checking') restoreAccount();
else render(false);
