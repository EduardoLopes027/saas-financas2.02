
const entryTypes = {Despesa:'arrow_downward', Receita:'arrow_upward', Transferência:'swap_horiz'};
const entryFrequencies = ['Semanal','Mensal','Anual'];
const receiptLimit = 3 * 1024 * 1024;
const receiptTypes = {'application/pdf':'pdf','image/png':'png','image/jpeg':'jpe?g'};
const entryIconPaths = {
  edit:'m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4',
  arrow_back:'M19 12H5m7 7-7-7 7-7',
  arrow_downward:'M12 5v14m-7-7 7 7 7-7',
  arrow_upward:'M12 19V5m-7 7 7-7 7 7',
  swap_horiz:'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  close:'m6 6 12 12M6 18 18 6',
  tag:'M3 4h8l10 10-7 7L3 10Zm4 4h.01',
  payment:'M3 5h18v14H3Zm0 5h18M7 15h3',
  calendar:'M4 6h16v15H4Zm0 5h16M8 3v5m8-5v5',
  check:'m4 12 5 5L20 6',
  info:'M12 11v5m0-8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  cloud_upload:'M7 18H6a4 4 0 1 1 1.2-7.8 6 6 0 0 1 11.5 1.2A3.5 3.5 0 0 1 18 18h-1m-5 2v-8m-3 3 3-3 3 3',
  auto_awesome:'M10 2l2.2 6.8L19 11l-6.8 2.2L10 20l-2.2-6.8L1 11l6.8-2.2L10 2Zm9 12v8m-4-4h8',
  attach_file:'m8 13 6-6a2 2 0 0 1 3 3l-7 7a4 4 0 0 1-6-6l8-8a6 6 0 0 1 8 8l-8 8'
};
const entryIcon = name => '<svg class="entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+ entryIconPaths[name] +'"/></svg>';
const blankEntry = masked => ({
  amountMasked:masked,
  type:'Despesa', amount:masked ? '0,00' : '', date:localCalendarDate(), category:'', description:'',
  paymentMethod:'', destinationPaymentMethod:'', status:'Pago', notes:'',
  repeat:false, recurrence:'Mensal', split:false, installments:2, receipt:null
});
const entryField = (name, label, control) =>
  '<label class="entry-field" data-field="' + name + '"><span>' + label + '</span><span class="entry-control">' + control + '</span>'
  + '<span class="field-error" id="entry-error-' + name + '"></span></label>';
const entrySelect = (name, values, selected, placeholder = 'Selecione') =>
  '<select name="' + name + '" aria-describedby="entry-error-' + name + '">'
  + (placeholder ? '<option value="">' + placeholder + '</option>' : '') + options(values,selected) + '</select>';

function entrySheetStatus(status,item){
  const statuses = item && !item.status ? ['',...transactionStatuses] : transactionStatuses;
  return '<fieldset class="entry-sheet-status"><legend>Status</legend><div class="entry-segments">' + statuses.map(value =>
    '<label><input type="radio" name="status" value="' + value + '"' + (status === value ? ' checked' : '') + '><span>' + (value || 'Não informado') + '</span></label>'
  ).join('') + '</div></fieldset>';
}

let entryEditor = null;

function mountEntry(item = null, origin = null, asSheet = false){
  const savedDraft = draft && draft.editId === item?.id ? draft : null;
  const masked = savedDraft?.amountMasked ?? (accountUser?.amountMask !== false);
  const baseline = item ? {
    ...blankEntry(masked),
    editId:item.id, type:item.type, category:item.category, description:item.description, date:item.date,
    amount:masked ? formatEntryAmount(item.amount) : formatEntryAmount(item.amount).replace(/\./g,''),
    paymentMethod:item.paymentMethod ?? '', destinationPaymentMethod:item.destinationPaymentMethod ?? '',
    status:item.status ?? '', notes:item.notes ?? '', receipt:item.receipt ?? null
  } : blankEntry(masked);
  const data = savedDraft ?? baseline;
  const sheet = asSheet ? document.createElement('dialog') : null;
  if(sheet){
    sheet.className = 'entry-sheet';
    sheet.setAttribute('aria-labelledby','entry-sheet-title');
    main.append(sheet);
  }
  const root = sheet ?? main;
  const mobileLabel = (label, icon) => sheet ? entryIcon(icon) + label : label;
  const dateShortcuts = `<div class="entry-shortcuts" aria-label="Atalhos de data">
            <button type="button" data-entry-date="today">Hoje</button>
            <button type="button" data-entry-date="yesterday">Ontem</button>
            <button type="button" data-entry-date="other">Outra data</button>
          </div>`;
  const dateField = `<div class="entry-date-field">${entryField('date',mobileLabel('Data do lançamento *','calendar'),'<input name="date" type="date" min="0001-01-01" max="9999-12-31" required aria-describedby="entry-error-date" value="' + escape(data.date) + '">')}${sheet ? '' : dateShortcuts}</div>`;
  const primaryAction = `<button type="submit" value="list" class="entry-primary">${entryIcon('check')} ${item ? 'Salvar alterações' : 'Salvar Lançamento'}</button>`;
  root.innerHTML = `
    <div class="entry-intro">
      <a data-entry-back href="#lancamentos">${entryIcon('arrow_back')} Voltar para Lançamentos</a>
      <h1 tabindex="-1"${sheet ? ' id="entry-sheet-title" autofocus' : ''}>${item ? 'Editar lançamento' : 'Novo Lançamento'}</h1>
      ${sheet ? '<button class="entry-sheet-close" type="button" data-entry-back aria-label="Fechar">' + entryIcon('close') + '</button>' : ''}
      <div class="entry-intro-details"><p>${item ? 'Altere os dados do lançamento selecionado e confira o impacto no saldo.' : 'Registre uma receita, despesa ou transferência e acompanhe o impacto no seu saldo.'}</p>
      <span class="entry-badge">Sincronização bancária indisponível</span></div>
    </div>
    <div class="entry-layout">
      <form class="entry-card entry-form" novalidate>
        <fieldset class="entry-controls">
        <fieldset class="entry-types">
          <legend>Tipo de lançamento</legend>
          <div class="entry-segments">${Object.entries(entryTypes).map(([kind,icon]) =>
             '<label><input type="radio" name="kind" value="' + kind + '"' + (kind === data.type ? ' checked' : '')
             + '><span>' + entryIcon(icon) + kind + '</span></label>').join('')}</div>
        </fieldset>
        <div class="entry-value">
          <div><label for="entry-amount">${sheet ? 'Valor do lançamento' : 'Valor da transação'}</label>
          <div class="entry-amount-line"><span aria-hidden="true">R$</span>
          <input id="entry-amount" name="amount" inputmode="${masked ? 'numeric' : 'decimal'}"
            aria-label="${sheet ? 'Valor do lançamento em reais' : 'Valor da transação em reais'}" aria-describedby="entry-error-amount" required value="${escape(data.amount)}"></div></div>
          <span class="entry-badge">BRL</span>
          <button type="button" data-entry-clear="amount" aria-label="Limpar valor">${entryIcon('close')}</button>
          <span class="field-error" id="entry-error-amount"></span>
        </div>
        <div class="entry-fields">
          ${entryField('description','Descrição *','<input name="description" maxlength="80" required aria-describedby="entry-error-description" placeholder="' + (sheet ? 'Descrição (ex: Supermercado, Salário…)' : 'Ex.: Supermercado') + '" value="' + escape(data.description) + '">')}
          ${entryField('category',mobileLabel('Categoria *','tag'),entrySelect('category',categories[data.type],data.category))}
          ${sheet ? '' : dateField}
          <div class="entry-payment-field">${entryField('paymentMethod',sheet ? mobileLabel('<span data-entry-payment-label></span>','payment') : item && !item.paymentMethod && data.type !== 'Transferência' ? 'Conta / meio de pagamento' : 'Conta / meio de pagamento *',entrySelect('paymentMethod',paymentMethods,data.paymentMethod))}
          <small data-entry-text="payment-help"></small></div>
          ${entryField('destinationPaymentMethod','Conta / meio de destino *',entrySelect('destinationPaymentMethod',paymentMethods,data.destinationPaymentMethod))}
          ${sheet ? dateField : ''}
          ${sheet ? entrySheetStatus(data.status,item) : entryField('status','Status',entrySelect('status',transactionStatuses,data.status,item && !item.status ? 'Não informado' : ''))}
        </div>
        ${sheet ? '<details class="entry-more"><summary>Mais opções</summary>' + dateShortcuts : ''}
        <div class="entry-scheduling"${item ? ' hidden' : ''}>
          <div><label class="entry-toggle"><input type="checkbox" role="switch" name="repeat"${data.repeat ? ' checked' : ''}>
          <span>Lançamento recorrente<small>Repete o lançamento no intervalo escolhido.</small></span></label>
          <label data-entry-recurrence>Frequência ${entrySelect('recurrence',entryFrequencies,data.recurrence,'')}</label></div>
          <div><label class="entry-toggle"><input type="checkbox" role="switch" name="split"${data.split ? ' checked' : ''}>
          <span>Pagamento parcelado<small>Divide o valor total em parcelas mensais.</small></span></label>
          <label data-entry-installments>Parcelas ${entrySelect('installments',Array.from({length:47},(_,i)=>String(i+2)),String(data.installments),'')}</label></div>
          <span class="field-error" id="entry-error-installments"></span>
          <small data-entry-text="installments"></small>
        </div>
        <label class="entry-notes">Observações e hashtags
          <textarea name="notes" maxlength="2000" rows="2" placeholder="Ex.: #essencial">${escape(data.notes)}</textarea>
        </label>
        <div class="entry-receipt"><label for="entry-receipt">Comprovante ou nota fiscal</label>
          <div class="entry-drop"><input id="entry-receipt" name="receipt" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          aria-describedby="entry-receipt-help entry-error-receipt">
          <label for="entry-receipt">${entryIcon('cloud_upload')} Escolha ou arraste um comprovante</label>
          <small id="entry-receipt-help">PDF, PNG ou JPG de até 3 MiB</small></div>
          <div class="entry-receipt-selected" hidden><span data-entry-text="receipt"></span><button type="button" data-entry-clear="receipt">Remover</button></div>
          <span class="field-error" id="entry-error-receipt" role="alert"></span>
        </div>
        ${sheet ? '</details>' : ''}
        </fieldset>
        <div class="entry-feedback" id="form-status" role="alert"></div>
        <div class="entry-actions">
          ${sheet ? primaryAction : ''}
          <a data-entry-back href="#lancamentos" id="cancel">Cancelar</a>
          ${item ? '' : '<button type="submit" value="another">Salvar e Criar Outro</button>'}
          ${sheet ? '' : primaryAction}
        </div>
      </form>
      <aside class="entry-side" aria-label="Prévia e impacto">
        <section class="entry-card">
          <div class="entry-card-title"><h2>Prévia do lançamento</h2><span class="entry-badge">Ao vivo</span></div>
          <div class="entry-preview">
            <div class="entry-preview-line"><span class="entry-preview-icon" data-entry-text="icon"></span>
              <div class="entry-preview-description"><strong data-entry-text="description"></strong><small data-entry-text="category"></small></div>
              <div><strong class="entry-preview-amount" data-entry-text="amount"></strong><span class="entry-badge" data-entry-text="status"></span></div></div>
            <div class="entry-preview-meta"><span data-entry-text="payment"></span><small data-entry-text="tag"></small></div>
            <small data-entry-text="preview-date"></small>
          </div>
          <p class="entry-info">${entryIcon('info')} A prévia acompanha os dados do formulário.</p>
        </section>
        <section class="entry-card">
          <div class="entry-card-title"><h2>Impacto no saldo</h2><span class="entry-badge" data-entry-text="month"></span></div>
          <dl class="entry-impact">
            <div><dt>Saldo disponível hoje</dt><dd data-entry-text="balance"></dd></div>
            <div><dt>Impacto deste lançamento</dt><dd data-entry-text="impact"></dd></div>
            <div><dt>Saldo projetado</dt><dd data-entry-text="projected"></dd></div>
          </dl>
          <p class="entry-impact-note" data-entry-text="impact-note"></p>
          <div class="entry-budget"><h3 data-entry-text="budget-heading"></h3><p>Nenhuma meta cadastrada.</p><strong data-entry-text="category-spending"></strong></div>
          <div class="entry-curve"><div><h3>Curva de despesas</h3><p data-entry-text="trend"></p></div><svg viewBox="0 0 120 40" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="3"/></svg></div>
        </section>
        <section class="entry-card entry-tip">${entryIcon('auto_awesome')}<div><h2>Dica do FinFlow</h2><p>Escolha a categoria que melhor descreve o lançamento para acompanhar seus gastos por categoria.</p></div></section>
      </aside>
    </div>
    <div class="entry-toast" role="status"></div>
    <dialog class="entry-dialog"><form method="dialog"><h2>Descartar alterações?</h2><p>Os dados que você digitou neste lançamento serão perdidos.</p>
      <div class="entry-actions"><button value="keep">Continuar editando</button><button class="entry-primary" value="discard">Descartar</button></div></form></dialog>`;
  const editor = wireEntry(data,baseline,item,root,origin,masked);
  if(origin) entryEditor = {...editor,origin,route:location.hash,state:history.state};
  if(!sheet) return;
  const viewport = window.visualViewport;
  const listeners = new AbortController();
  const syncViewport = () => {
    if(!viewport) return;
    sheet.style.setProperty('--entry-viewport-height', viewport.height + 'px');
    sheet.style.setProperty('--entry-viewport-bottom', Math.max(0,window.innerHeight - viewport.height - viewport.offsetTop) + 'px');
  };
  syncViewport();
  for(const event of ['resize','scroll']) viewport?.addEventListener(event,syncViewport,{signal:listeners.signal});
  window.addEventListener('beforeunload',event=>{
    if(!saveBusy && !editor.hasChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  },{signal:listeners.signal});
  sheet.addEventListener('cancel',event=>{event.preventDefault();editor.requestClose();});
  entryEditor.cleanup = () => {
    listeners.abort();
    sheet.close();
  };
  sheet.showModal();
}

const entryAmountFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits:2, maximumFractionDigits:2
});

function formatEntryAmount(cents){
  // Pass an exact decimal string so large amounts retain their last cent.
  const digits = String(cents).padStart(3,'0');
  return entryAmountFormat.format(digits.slice(0,-2) + '.' + digits.slice(-2));
}

function parseCents(value, masked){
  if(!masked){
    const decimal = /^(\d+)(?:[,.](\d{0,2}))?$/.exec(value.trim());
    if(!decimal) return null;
    const cents = Number(decimal[1]) * 100 + Number((decimal[2] ?? '').padEnd(2,'0'));
    return Number.isSafeInteger(cents) ? cents : null;
  }
  const cents = Number(value.replace(/\D/g,''));
  return Number.isSafeInteger(cents) ? cents : null;
}

function entryDateOffset(date, months = 0, days = 0){
  const target = new Date(date + 'T00:00:00Z');
  if(months){
    const day = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + months);
    const end = new Date(target);
    end.setUTCMonth(end.getUTCMonth() + 1,0);
    target.setUTCDate(Math.min(day,end.getUTCDate()));
  }
  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0,10);
}

function installmentAmount(total, count, index){
  return Math.floor(total/count) + Number(index < total%count);
}

function demoBatch(record,file){
  const count = record.installments || 1;
  const nextId = entries.reduce((max,item)=>Math.max(max,item.id),0) + 1;
  const {receipt, ...fields} = record;
  const batch = Array.from({length:count},(_,index)=>({
    ...fields, id:nextId + index, date:entryDateOffset(record.date,index),
    amount:installmentAmount(record.amount,count,index),
    ...(count > 1 ? {installmentNumber:index+1} : {})
  }));
  if(file) batch[0].receipt = {name:file.name,mimeType:file.type,size:file.size,file};
  if(record.recurrence){
    const today = localCalendarDate();
    for(let index=1;;index++){
      const date = record.recurrence === 'Semanal' ? entryDateOffset(record.date,0,index*7)
        : entryDateOffset(record.date,index*(record.recurrence === 'Anual' ? 12 : 1));
      if(date > today) break;
      batch.push({...fields,id:nextId+index,date});
    }
  }
  return batch;
}

function receiptPayload(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve({name:file.name,mimeType:file.type,dataBase64:reader.result.split(',')[1]});
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}


function updateEntryPreview(element,data,cents,item){
  const text = (name,value) => { main.querySelector('[data-entry-text="' + name + '"]').textContent = value; };
  const today = localCalendarDate();
  const month = today.slice(0,7);
  const transfer = data.type === 'Transferência';
  const sign = transfer ? '' : data.type === 'Receita' ? '+' : '−';
  const available = appMode !== 'demo' || scenario.value !== 'load';
  const items = available ? records() : [];
  const settled = items.filter(item=>item.date <= today);
  const balance = sum(settled.filter(item=>item.type === 'Receita')) - sum(settled.filter(item=>item.type === 'Despesa'));
  const monthlyExpenses = items.filter(item=>item.type === 'Despesa' && item.date.startsWith(month));
  const valid = cents > 0 && data.date && element.elements.date.validity.valid;
  const signed = data.type === 'Despesa' ? -cents : cents;
  const count = data.split ? data.installments : 1;
  let impact = 0;
  if(valid && !transfer){
    for(let index=0;index<count;index++){
      if(entryDateOffset(data.date,index) > today) break;
      impact += installmentAmount(cents,count,index) * Math.sign(signed);
    }
    if(data.repeat && data.date <= today){
      for(let index=1;;index++){
        const date = data.recurrence === 'Semanal' ? entryDateOffset(data.date,0,index*7)
          : entryDateOffset(data.date,index*(data.recurrence === 'Anual' ? 12 : 1));
        if(date > today) break;
        impact += signed;
      }
    }
  }
  if(valid && item?.date <= today){
    if(item.type === 'Receita') impact -= item.amount;
    if(item.type === 'Despesa') impact += item.amount;
  }
  main.querySelector('.entry-layout').dataset.kind = data.type;
  const icon = main.querySelector('[data-entry-text="icon"]');
  const categoryIcon = categoryIcons[data.category];
  icon.innerHTML = categoryIcon ? '<span class="material-symbols-outlined" aria-hidden="true">' + categoryIcon + '</span>' : entryIcon(entryTypes[data.type]);
  text('description',data.description.trim() || data.type);
  const description = main.querySelector('[data-entry-text="description"]');
  description.title = description.textContent;
  text('category',data.category || 'Categoria a definir');
  text('preview-date',data.date && element.elements.date.validity.valid ? transactionDate.format(new Date(data.date + 'T00:00:00Z')) : '');
  text('amount',cents ? signedMoney(cents,sign) : '—');
  text('status',data.status === 'Pago' ? 'Liquidado' : data.status || 'Não informado');
  main.querySelector('[data-entry-text="status"]').dataset.status = data.status;
  text('payment',data.paymentMethod
    ? data.paymentMethod + (transfer && data.destinationPaymentMethod ? ' → ' + data.destinationPaymentMethod : '')
    : 'Meio a definir');
  text('tag',data.notes.match(/#[\p{L}\p{N}_-]+/u)?.[0] ?? '');
  text('month',formatMonth(month));
  text('balance',available ? format(balance) : 'Indisponível');
  text('impact',available && valid ? signedMoney(impact,impact < 0 ? '−' : impact > 0 ? '+' : '') : '—');
  text('projected',available && valid ? format(balance + impact) : '—');
  text('impact-note',!available ? 'Saldo indisponível no momento.' : !valid ? 'Informe um valor e uma data para calcular o impacto.'
    : item ? 'O impacto considera a diferença em relação ao lançamento original.'
    : transfer ? 'Transferências mantêm o saldo consolidado.' : data.date > today ? 'A data futura mantém o saldo de hoje.'
    : data.split ? 'O saldo de hoje considera apenas as parcelas até hoje.' : data.repeat ? 'O saldo inclui as ocorrências até hoje.' : '');
  text('budget-heading',data.type === 'Despesa' && data.category ? 'Meta de ' + data.category : 'Meta de categoria');
  text('category-spending',available && data.type === 'Despesa' && data.category
    ? format(sum(monthlyExpenses.filter(item=>item.category === data.category))) + ' em despesas no mês' : '');
  const days = Number(today.slice(-2));
  const weekTotals = Array.from({length:Math.ceil(days/7)},(_,index)=>sum(monthlyExpenses.filter(item=>
    item.date <= today && Math.ceil(Number(item.date.slice(-2))/7) === index+1)));
  const peak = Math.max(...weekTotals);
  const total = weekTotals.reduce((running,value)=>running+value,0);
  text('trend',!available ? 'Dados indisponíveis.' : peak ? format(total) + ' até hoje' : 'Sem despesas até hoje.');
  const points = peak ? [0,...weekTotals].map((value,index)=>
    (index*120/weekTotals.length) + ',' + (37-value*34/peak)).join(' ') : '';
  main.querySelector('.entry-curve polyline').setAttribute('points',points);
}

function wireEntry(data,baseline,item,root,origin,masked){
  const element = root.querySelector('.entry-form');
  const field = name => element.elements.namedItem(name);
  const status = element.querySelector('#form-status');
  const amountInput = field('amount');
  let maskedAmount = amountInput.value;
  const moveAmountCaret = () => amountInput.setSelectionRange(amountInput.value.length,amountInput.value.length);
  if(masked){
    amountInput.addEventListener('focus',moveAmountCaret);
    amountInput.addEventListener('click',moveAmountCaret);
  }
  let receipt = data.receipt;
  let receiptInvalid = false;
  const read = () => ({
    ...(item ? {editId:item.id} : {}),
    amountMasked:masked,
    type:field('kind').value,amount:field('amount').value,date:field('date').value,category:field('category').value,
    description:field('description').value,paymentMethod:field('paymentMethod').value,
    destinationPaymentMethod:field('destinationPaymentMethod').value,status:field('status').value,notes:field('notes').value,
    repeat:field('repeat').checked,recurrence:field('recurrence').value,
    split:field('split').checked,installments:Number(field('installments').value),receipt
  });
  function error(name,value){
    element.querySelector('#entry-error-' + name).textContent = value;
    if(value) field(name).setAttribute('aria-invalid','true');
    else field(name).removeAttribute('aria-invalid');
  }
  function refresh(){
    draft = read();
    const cents = parseCents(draft.amount,masked);
    const transfer = draft.type === 'Transferência';
    const paymentLabel = element.querySelector('[data-entry-payment-label]');
    if(paymentLabel) paymentLabel.textContent = transfer ? 'Origem' : 'Pagamento';
    const destination = field('destinationPaymentMethod');
    destination.disabled = !transfer;
    destination.required = transfer;
    destination.closest('label').hidden = !transfer;
    field('category').required = true;
    field('paymentMethod').required = !item || transfer || Boolean(item.paymentMethod);
    element.querySelector('[data-entry-text="payment-help"]').textContent = ({
      Pix:'Transferência instantânea via Pix.',
      'Cartão de crédito':'Use a data que deseja registrar no seu fluxo de caixa.',
      'Cartão de débito':'Pagamento direto na conta.',
      'Débito automático':'Use a data prevista para o débito.',
      'Boleto bancário':'Use a data do pagamento ou do vencimento.',
      'Transferência':'Movimentação por transferência bancária.',
      'Crédito em conta':'Crédito recebido diretamente na conta.'
    })[draft.paymentMethod] || 'Selecione como o valor será movimentado.';
    field('recurrence').disabled = !draft.repeat;
    field('installments').disabled = !draft.split;
    element.querySelector('[data-entry-recurrence]').hidden = !draft.repeat;
    element.querySelector('[data-entry-installments]').hidden = !draft.split;
    element.querySelector('[data-entry-text="installments"]').textContent = !draft.split ? ''
      : cents < draft.installments ? 'Informe pelo menos R$ 0,01 por parcela.'
      : Array.from(new Set([installmentAmount(cents,draft.installments,0),installmentAmount(cents,draft.installments,draft.installments-1)]))
        .map((amount,index)=>((cents%draft.installments ? index ? draft.installments-cents%draft.installments : cents%draft.installments : draft.installments)
          + ' × ' + format(amount))).join(' + ');
    element.querySelector('.entry-receipt-selected').hidden = !receipt;
    element.querySelector('[data-entry-text="receipt"]').textContent = receipt?.name ?? '';
    const today = localCalendarDate();
    const activeDate = draft.date === today ? 'today' : draft.date === entryDateOffset(today,0,-1) ? 'yesterday' : 'other';
    element.querySelectorAll('[data-entry-date]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.entryDate === activeDate)));
    updateEntryPreview(element,draft,cents,item);
  }
  function chooseReceipt(files){
    if(!files.length) return;
    const [file] = files;
    const extension = receiptTypes[file.type];
    receiptInvalid = files.length !== 1 || !extension || !new RegExp('\\.' + extension + '$','i').test(file.name)
      || file.size === 0 || file.size > receiptLimit;
    error('receipt',receiptInvalid ? 'Selecione um PDF, PNG ou JPG válido de até 3 MiB.' : '');
    if(!receiptInvalid) receipt = file;
    field('receipt').value = '';
    refresh();
  }
  element.addEventListener('input',event=>{
    const {name} = event.target;
    if(['receipt','kind','repeat','split'].includes(name)) return;
    if(name === 'amount' && masked){
      const cents = parseCents(amountInput.value,masked);
      if(cents !== null) maskedAmount = formatEntryAmount(cents);
      amountInput.value = maskedAmount;
      moveAmountCaret();
    }
    if(element.querySelector('#entry-error-' + name)) error(name,'');
    refresh();
  });
  element.addEventListener('change',event=>{
    const {name} = event.target;
    if(name === 'kind'){
      field('category').innerHTML = '<option value="">Selecione</option>' + options(categories[field('kind').value],'');
      if(field('kind').value === 'Transferência') field('category').value = 'Transferência';
      error('category','');
      error('destinationPaymentMethod','');
    }
    if(name === 'repeat' && field('repeat').checked) field('split').checked = false;
    if(name === 'split' && field('split').checked) field('repeat').checked = false;
    if(!field('split').checked) error('installments','');
    if(name === 'receipt') chooseReceipt(field('receipt').files);
    refresh();
  });
  element.addEventListener('click',event=>{
    const button = event.target.closest('button[type="button"]');
    if(!button) return;
    const date = button.dataset.entryDate;
    const clear = button.dataset.entryClear;
    if(date === 'other'){
      field('date').focus();
      try{field('date').showPicker();}catch{}
    }else if(date){
      field('date').value = entryDateOffset(localCalendarDate(),0,date === 'today' ? 0 : -1);
      error('date','');
    }
    if(clear === 'amount'){
      amountInput.value = maskedAmount = masked ? formatEntryAmount(0) : '';
      amountInput.focus();
      moveAmountCaret();
      error('amount','');
    }
    if(clear === 'receipt'){receipt = null;receiptInvalid = false;error('receipt','');field('receipt').focus();}
    refresh();
  });
  const dropzone = element.querySelector('.entry-drop');
  dropzone.addEventListener('dragover',event=>{event.preventDefault();dropzone.dataset.dragging = 'true';});
  dropzone.addEventListener('dragleave',event=>{if(!dropzone.contains(event.relatedTarget)) delete dropzone.dataset.dragging;});
  dropzone.addEventListener('drop',event=>{
    event.preventDefault();
    delete dropzone.dataset.dragging;
    if(!saveBusy) chooseReceipt(event.dataTransfer.files);
  });
  const dialog = root.querySelector('.entry-dialog');
  const hasChanges = () => Object.entries(read()).some(([key,value]) => value !== baseline[key]);
  const leave = () => {
    draft = null;
    if(origin) finishMobileEntry(origin);
    else location.hash = 'lancamentos';
  };
  const requestClose = () => {
    if(saveBusy || dialog.open) return;
    if(hasChanges()){
      dialog.returnValue = '';
      dialog.showModal();
    }else leave();
  };
  root.querySelectorAll('[data-entry-back]').forEach(control=>control.addEventListener('click',event=>{
    event.preventDefault();
    requestClose();
  }));
  dialog.addEventListener('close',()=>{
    if(dialog.returnValue === 'discard') leave();
  });
  element.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saveBusy) return;
    const keepEditing = event.submitter?.value === 'another';
    const current = read();
    const cents = parseCents(current.amount,masked);
    const transfer = current.type === 'Transferência';
    const errors = {
      amount:cents ? '' : !masked
        ? 'Informe um valor positivo com até duas casas decimais, como 12,50.'
        : 'Informe um valor maior que R$ 0,00.',
      description:current.description.trim() ? '' : 'Informe uma descrição.',
      category:categories[current.type].includes(current.category) ? '' : 'Selecione uma categoria.',
      date:current.date && field('date').validity.valid ? '' : 'Informe uma data válida.',
      paymentMethod:!field('paymentMethod').required || paymentMethods.includes(current.paymentMethod) ? '' : 'Selecione um meio de pagamento.',
      destinationPaymentMethod:!transfer ? '' : !paymentMethods.includes(current.destinationPaymentMethod)
        ? 'Selecione o destino.' : current.destinationPaymentMethod === current.paymentMethod ? 'Escolha um destino diferente da origem.' : '',
      installments:current.split && cents < current.installments ? 'Informe pelo menos R$ 0,01 por parcela.'
        : current.split && field('date').validity.valid && current.date && entryDateOffset(current.date,current.installments-1).startsWith('+')
          ? 'As parcelas ultrapassam o ano 9999.' : '',
      receipt:receiptInvalid ? 'Selecione um PDF, PNG ou JPG válido de até 3 MiB.' : ''
    };
    status.textContent = '';
    Object.entries(errors).forEach(([name,value])=>error(name,value));
    const invalid = Object.keys(errors).find(name=>errors[name]);
    if(invalid){
      const control = field(invalid);
      const options = control.closest('.entry-more');
      if(options) options.open = true;
      control.focus();
      return;
    }
    if(appMode === 'demo' && ['save','load'].includes(scenario.value)){
      status.textContent = 'Não foi possível salvar. Troque o cenário para Dados fictícios e tente novamente.';
      return;
    }
    const record = {
      type:current.type,category:current.category,amount:cents,date:current.date,description:current.description.trim(),
      ...(current.paymentMethod ? {paymentMethod:current.paymentMethod} : {}),
      ...(current.status ? {status:current.status} : {}),
      ...(transfer ? {destinationPaymentMethod:current.destinationPaymentMethod} : {}),
      ...(item || current.notes.trim() ? {notes:current.notes.trim()} : {}),
      ...(current.repeat ? {recurrence:current.recurrence} : {}),
      ...(current.split ? {installments:current.installments} : {})
    };
    const epoch = accountEpoch;
    saveBusy = true;
    element.querySelector('.entry-controls').disabled = true;
    const buttons = element.querySelectorAll('button[type="submit"]');
    buttons.forEach(button=>{button.disabled = true;});
    const submit = event.submitter ?? buttons[buttons.length-1];
    const submitLabel = submit.innerHTML;
    submit.textContent = 'Salvando…';
    let refreshed = true;
    try{
      if(accountUser){
        if(receipt instanceof File) record.receipt = await receiptPayload(receipt);
        else if(item?.receipt && !receipt) record.receipt = null;
        if(epoch !== accountEpoch) return;
        if(item){
          const {item:updated} = await apiRequest('/api/transactions/' + item.id,record,'PATCH');
          if(epoch !== accountEpoch) return;
          const saved = requireTransaction(updated);
          if(saved.id !== item.id) throw Error('Resposta de edição inválida');
          entries = entries.map(entry => entry.id === item.id ? saved : entry);
        }else{
          const payload = await apiRequest('/api/transactions',record);
          if(epoch !== accountEpoch) return;
          draft = null;
          try{
            const list = await apiRequest('/api/transactions');
            if(epoch !== accountEpoch) return;
            entries = list.items.map(requireTransaction).filter(item=>!deletingTransactionIds.has(item.id));
          }catch(error){
            if(epoch !== accountEpoch) return;
            if(error.status === 401){expireAccount();return;}
            refreshed = false;
            try{
              const item = requireTransaction(payload.item);
              if(!entries.some(entry=>entry.id === item.id)) entries.push(item);
            }catch{}
          }
        }
      }else if(item){
        const {destinationPaymentMethod, ...existing} = item;
        const updatedReceipt = receipt instanceof File ? {name:receipt.name,mimeType:receipt.type,size:receipt.size,file:receipt} : receipt;
        entries = entries.map(entry => entry.id === item.id ? {...existing,...record,receipt:updatedReceipt} : entry);
      }else{
        if(scenario.value === 'empty'){entries = [];scenario.value = 'normal';}
        entries.push(...demoBatch(record,receipt));
      }
      if(root.matches('.entry-sheet') && !keepEditing && !matchMedia('(prefers-reduced-motion: reduce)').matches){
        const exit = root.animate(
          [{transform:'translateY(0)'},{transform:'translateY(24px)',opacity:0}],
          {duration:150,easing:'ease-in',fill:'forwards'}
        );
        await exit.finished.catch(() => {});
        if(epoch !== accountEpoch) return;
      }
    }catch(error){
      if(epoch !== accountEpoch) return;
      if(error.status === 401){expireAccount();return;}
      status.textContent = error.status === 413 ? 'O comprovante excede o tamanho permitido.'
        : error.status === 404 && item ? 'Este lançamento não está mais disponível para edição.'
        : error.status === 400 ? 'Confira os dados e o formato do comprovante.'
        : 'Não foi possível confirmar o salvamento. Confira o Extrato antes de reenviar.';
      return;
    }finally{
      if(epoch === accountEpoch){
        saveBusy = false;
        element.querySelector('.entry-controls').disabled = false;
        buttons.forEach(button=>{button.disabled = false;});
        submit.innerHTML = submitLabel;
      }
    }
    draft = null;
    if(!origin && (!item || item.date.slice(0,7) !== record.date.slice(0,7))){
      search.value = '';
      query = '';
      selectedMonth = record.date.slice(0,7);
      resetTransactionFilters();
    }
    const notice = item ? 'Lançamento atualizado.' : refreshed ? 'Lançamento salvo.' : 'Lançamento salvo. Atualize o Extrato para consultar todos os registros.';
    if(location.hash !== (item ? '#editar/'+item.id : '#novo')){message = notice;render(false);return;}
    if(keepEditing){
      render(false);
      main.querySelector('#entry-amount').focus({preventScroll:true});
      requestAnimationFrame(()=>{
        const toast = main.querySelector('.entry-toast');
        if(toast) toast.textContent = notice;
      });
    }else if(origin){
      finishMobileEntry(origin,notice);
    }else{
      message = notice;
      location.hash = 'lancamentos';
    }
  });
  refresh();
  return {hasChanges,requestClose};
}


function receiptLink(item){
  if(!item.receipt) return '';
  const label = 'Baixar comprovante de ' + escape(item.description);
  const icon = entryIcon('attach_file');
  if(item.receipt.file){
    return '<button type="button" class="transactions-receipt" data-receipt-id="' + item.id
      + '" aria-label="' + label + '" title="' + label + '">' + icon + '</button>';
  }
  return '<a class="transactions-receipt" href="/api/transactions/' + item.id
    + '/receipt" aria-label="' + label + '" title="' + label + '">' + icon + '</a>';
}

function downloadDemoReceipt(id){
  const file = entries.find(item=>item.id === id)?.receipt?.file;
  if(!file) return;
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
