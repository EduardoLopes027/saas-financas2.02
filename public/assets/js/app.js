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
const demoDate = '2026-11-17';
const demoMonth = demoDate.slice(0,7);
const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
const formatMonth = month => monthLabel.format(new Date(month + '-01T00:00:00Z'));
const main = document.querySelector('main');
const scenario = document.querySelector('#scenario');
let selectedMonth = demoMonth;
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

function configuredSalaryDate(salaryDay, year, month){
  if(salaryDay === '5-business' || salaryDay === '5') return fifthWeekday(year,month-1);
  const lastDay = utcDate(year,month,0).getUTCDate();
  const day = salaryDay === '30' ? lastDay : Number(salaryDay);
  return utcDate(year,month-1,Math.min(day,lastDay)).toISOString().split('T')[0];
}

function salaryForecast(items, reference, salaryDay, monthOnly = false){
  const salaries = items.filter(item => item.type === 'Receita' && item.category === 'Salário');
  const dates = salaries.map(item => item.date).sort();
  const month = reference.slice(0,7);
  let date = dates.find(value => value >= reference && (!monthOnly || value.startsWith(month)));
  const estimated = !date;
  if(estimated && ['1','5','5-business','10','15','20','25','30'].includes(salaryDay)){
    const [year, monthNumber] = reference.split('-').map(Number);
    date = configuredSalaryDate(salaryDay,year,monthNumber);
    if(date < reference && !monthOnly) date = configuredSalaryDate(salaryDay,year,monthNumber+1);
  }else if(estimated){
    if(monthOnly) return null;
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

function mountHome(showDashboard, spendingCategory = ''){
  const home = stitchTemplate('home');
  if(accountUser){
    const name = [accountUser.full_name, accountUser.name].find(value => typeof value === 'string' && value.trim());
    const firstName = name?.trim().split(/\s+/, 1)[0];
    home.querySelector('h1').textContent = firstName ? 'Olá, ' + firstName : 'Olá';
  }
  const monthText = formatMonth(selectedMonth);
  mountMonthPicker(home, false, () => {
    filters.allMonths = false;
    const category = main.querySelector('[data-spend-category][aria-pressed="true"]');
    if(showDashboard) mountHome(true, category?.dataset.spendCategory);
    else render(false);
  });
  stitchSlot(home,'intro').textContent = 'Aqui está o resumo financeiro do seu mês de ' + monthText + '.';
  if(!showDashboard){
    home.querySelectorAll('.stitch-metrics,.mobile-quick,.stitch-spending,.home-recent').forEach(node=>node.remove());
    main.replaceChildren(home);
    return;
  }

  const items = records();
  const today = localCalendarDate();
  const month = items.filter(item => item.date.startsWith(selectedMonth));
  const monthStart = selectedMonth + '-01';
  const monthEnd = new Date(monthStart + 'T00:00:00Z');
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const days = monthEnd.getUTCDate();
  const isCurrentMonth = today.startsWith(selectedMonth);
  const isFutureMonth = monthStart > today;
  const cutoff = isCurrentMonth ? today : monthEnd.toISOString().slice(0,10);
  const throughCutoff = items.filter(item => item.date <= cutoff);
  const expenses = month.filter(item => item.type === 'Despesa');
  const spent = sum(expenses);
  const monthIncome = sum(month.filter(item => item.type === 'Receita'));
  const balance = sum(throughCutoff.filter(item => item.type === 'Receita'))
    - sum(throughCutoff.filter(item => item.type === 'Despesa'));
  const salary = salaryForecast(items, isCurrentMonth ? today : monthStart, accountUser?.salaryDay, isFutureMonth);
  const balanceBadge = isFutureMonth
    ? 'A partir de ' + (salary?.date ?? monthStart).split('-').reverse().join('/')
    : isCurrentMonth ? 'Até hoje' : 'Até ' + transactionDate.format(monthEnd);
  stitchSlot(home,'balance-badge').classList.toggle('future-balance-badge', isFutureMonth);
  const salaryDate = salary ? salaryDateLabel.format(new Date(salary.date)) : '';
  const salaryPeriod = salary ? (salary.days === 0 ? 'Hoje' : salary.days === 1 ? 'Falta 1 dia' : 'Faltam ' + salary.days + ' dias') + ' · ' + salaryDate : 'Sem data de salário';
  const recent = newest(month).slice(0,5);
  const moneyNumber = cents => currency.formatToParts(cents / 100).filter(part => part.type !== 'currency' && part.type !== 'literal').map(part => part.value).join('');
  const categoriesUsed = new Set(expenses.map(item=>item.category)).size;
  const values = {
    balance:moneyNumber(balance), 'balance-badge':balanceBadge,
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
    'mobile-spent':format(spendingCategory ? sum(expenses.filter(item => item.category === spendingCategory)) : spent),
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
  chart.replaceChildren(homeSpending(expenses,spendingCategory,days));
  const buttons = [...home.querySelectorAll('[data-spend-category]')];
  buttons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.spendCategory === spendingCategory)));
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
    resetTransactionFilters();
  }));
  main.replaceChildren(home);
}

const transactionDate = new Intl.DateTimeFormat('pt-BR', {timeZone:'UTC'});
const savingsRate = new Intl.NumberFormat('pt-BR', {style:'percent', maximumFractionDigits:1});
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
  return '<tr role="row" data-tone="' + tone + '">'
    + '<td role="cell"><time datetime="' + item.date + '">' + date + '</time></td>'
    + '<td role="cell"><div class="transactions-description"><span class="transactions-category-icon material-symbols-outlined" aria-hidden="true">' + icon + '</span><strong>' + escape(item.description) + '</strong></div></td>'
    + '<td role="cell"><span class="transactions-category">' + escape(item.category) + '</span></td>'
    + '<td role="cell"><span class="transactions-payment">' + escape(item.paymentMethod || 'Não informada') + (item.destinationPaymentMethod ? ' → ' + escape(item.destinationPaymentMethod) : '') + '</span></td>'
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

  mountMonthPicker(main, filters.allMonths, () => {
    updateTransactionPeriod();
    listResults(true);
  });
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

async function linkGoogleAccount(){
  if(!accountUser || googleLink.disabled) return;
  const userId=accountUser.id;
  googleLink.disabled=true;
  googleLinkStatus.textContent='Abrindo o Google…';
  try{
    const result=await apiRequest('/api/auth/google/link',{});
    if(accountUser?.id!==userId){
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
    if(accountUser?.id!==userId) return;
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
  if(authBusy) return;
  suspendedDraft=null;
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

function render(focus){
  const authPreview=appMode==='demo'&&(location.hash==='#login'||location.hash==='#cadastro');
  updateAccountChrome(authPreview);
  const listRoute=location.hash==='#lancamentos' && !authPreview && (appMode==='demo'||accountUser);
  document.body.classList.toggle('transactions-view',!!listRoute);
  document.body.classList.toggle('entry-view',entryRoute() && (appMode==='demo' || accountUser && accountState==='ready'));
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
  const view=entryRoute() ? 'novo' : location.hash==='#lancamentos' ? 'lancamentos' : 'painel';
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
    const editId = editIdFromRoute();
    const item = editId === null ? null : records().find(record=>record.id === editId);
    if(editId !== null && !item){
      main.innerHTML='<section class="card state-card"><h1 tabindex="-1">Lançamento indisponível</h1><p>Este lançamento não está disponível para edição.</p><a href="#lancamentos">Voltar para Lançamentos</a></section>';
    }else mountEntry(item);
  }
  else if(view==='lancamentos') mountTransactions();
  if(focus) main.querySelector('h1').focus();
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
window.addEventListener('hashchange',()=>{
  render(true);
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
googleLink.addEventListener('click',linkGoogleAccount);
window.addEventListener('pageshow',event=>{
  if(!event.persisted) return;
  googleLink.disabled=false;
  googleLinkStatus.textContent='';
});
accountChannel?.addEventListener('message',event=>{
  if(event.data==='account-changed'&&appMode==='account'&&!authBusy) restoreAccount();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&accountUser&&!authBusy&&!saveBusy&&!deletingTransactionIds.size&&accountState==='ready') restoreAccount();
});
if(appMode==='checking') restoreAccount();
else render(false);
