(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const itemDialog = byId('item-dialog'), itemForm = byId('item-form');
  const movementDialog = byId('movement-dialog'), movementForm = byId('movement-form');
  const currency = new Intl.NumberFormat('en-IN', { style:'currency',currency:'INR' });
  const quantityFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits:3 });
  let state = {items:[],movements:[],importedPurchaseIds:[],purchaseSnapshots:{}};
  let items = state.items, movements = state.movements, importedPurchaseIds = state.importedPurchaseIds;
  let purchaseSnapshots = state.purchaseSnapshots;
  let categories = [];
  let purchases = [];
  let selectedCategories = new Set();

  async function saveState() {
    try { await window.WonderNestDB.set('stock',state); return true; }
    catch (error) { alert(`Could not save to the local database: ${error.message}`); return false; }
  }
  function money(value) { return currency.format(Number(value) || 0); }
  function safe(value) { return String(value ?? '').replace(/[&<>"']/g,(char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function unitName(value) { return String(value || 'pcs').trim() || 'pcs'; }
  function itemKey(name,unit) { return `${String(name).trim().toLocaleLowerCase()}|${unitName(unit).toLocaleLowerCase()}`; }
  function parseDate(value) {
    const formatted = window.WonderNestDate.format(value);
    const match = formatted.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return match ? new Date(Number(match[3]),Number(match[2])-1,Number(match[1])) : new Date();
  }
  function todayIso() { return new Date().toISOString(); }
  function recordMovement(item,type,change,balance,reason,source='Manual') {
    movements.unshift({ id:crypto.randomUUID(),itemId:item.id,itemName:item.name,type,change,balance,unit:item.unit,reason:reason || '',source,date:todayIso() });
  }
  function getPurchaseLines(purchase) {
    const lines={};
    const entries=(Array.isArray(purchase.items) ? purchase.items : []).map((item)=>{
      const purchaseQuantity=number(item.quantity),lineAmount=Number(item.lineAmount),hasLineAmount=item.lineAmount!==null&&item.lineAmount!==undefined&&Number.isFinite(lineAmount);
      const lineWeight=hasLineAmount?Math.max(0,lineAmount):Math.max(0,purchaseQuantity*number(item.rate)*(1+number(item.gstRate)/100));
      return{item,purchaseQuantity,lineWeight};
    });
    const totalWeight=entries.reduce((sum,entry)=>sum+entry.lineWeight,0);
    const totalValue=Number(purchase.total),hasPurchaseTotal=purchase.total!==null&&purchase.total!==undefined&&Number.isFinite(totalValue);
    const purchaseValue=hasPurchaseTotal?Math.max(0,totalValue):totalWeight;
    for(const {item,purchaseQuantity,lineWeight} of entries) {
      const name=String(item.name || '').trim(), packageQuantity=number(item.contentQuantity), packageUnit=String(item.contentUnit || '').trim();
      const quantity=packageQuantity > 0 && packageUnit ? purchaseQuantity * packageQuantity : purchaseQuantity;
      const unit=unitName(packageQuantity > 0 && packageUnit ? packageUnit : item.unit);
      if(!name || name.toUpperCase()==='NA' || quantity<=0) continue;
      const key=itemKey(name,unit),allocatedCost=totalWeight>0?purchaseValue*lineWeight/totalWeight:purchaseValue/Math.max(entries.length,1);
      const line=lines[key] || { name,unit,quantity:0,totalCost:0,unitCost:0,category:categories.includes(purchase.category) ? purchase.category : (categories[0] || '') };
      line.quantity+=quantity; line.totalCost+=allocatedCost;
      lines[key]=line;
    }
    for(const line of Object.values(lines)){line.unitCost=line.quantity>0?line.totalCost/line.quantity:0;delete line.totalCost;}
    return lines;
  }
  function getLegacyPurchaseLines(purchase,nextLines,claimedMovementIds) {
    const reason=`Purchase ${purchase.invoiceNumber || ''}`.trim();
    const matches=movements.filter((move)=>move.source==='Purchase' && move.type==='in' && move.reason===reason && !claimedMovementIds.has(move.id));
    if(!matches.length)return null;
    const lines={};
    for(const move of matches) {
      claimedMovementIds.add(move.id);
      const name=String(move.itemName || '').trim(), unit=unitName(move.unit), key=itemKey(name,unit);
      const line=lines[key] || {name,unit,quantity:0,unitCost:number(nextLines[key]?.unitCost),category:nextLines[key]?.category || categories[0] || ''};
      line.quantity+=number(move.change); lines[key]=line;
    }
    return lines;
  }
  function importPurchases(purchases) {
    let changed=false;
    const claimedLegacyMovementIds=new Set();
    for(const purchase of purchases) {
      if(!purchase?.id) continue;
      const nextLines=getPurchaseLines(purchase), previous=purchaseSnapshots[purchase.id];
      const legacyLines=!previous && importedPurchaseIds.includes(purchase.id) ? getLegacyPurchaseLines(purchase,nextLines,claimedLegacyMovementIds) : null;
      const oldLines=previous || legacyLines || (importedPurchaseIds.includes(purchase.id) ? nextLines : {});
      const keys=new Set([...Object.keys(oldLines),...Object.keys(nextLines)]);
      for(const key of keys) {
        const oldLine=oldLines[key], nextLine=nextLines[key], delta=number(nextLine?.quantity)-number(oldLine?.quantity);
        let item=items.find((entry)=>itemKey(entry.name,entry.unit)===key);
        if(!item && nextLine && delta>0) {
          item={id:crypto.randomUUID(),name:nextLine.name,category:nextLine.category || (categories[0] || ''),unit:nextLine.unit,quantity:0,maxStock:0,thresholdPercent:25,unitCost:nextLine.unitCost,createdAt:todayIso(),updatedAt:todayIso()};
          items.push(item);
        }
        if(!item) continue;
        const priorQuantity=number(item.quantity), updatedQuantity=Math.max(0,priorQuantity+delta);
        const nextCategory=nextLine?.category && categories.includes(nextLine.category) ? nextLine.category : item.category;
        const nextCost=number(nextLine?.unitCost) || number(item.unitCost);
        if(delta!==0 || nextCategory!==item.category || nextCost!==number(item.unitCost)) {
          item.quantity=updatedQuantity; item.maxStock=Math.max(getMaxStock(item),updatedQuantity); item.thresholdPercent=getThresholdPercent(item); item.category=nextCategory; item.unitCost=nextCost; item.updatedAt=todayIso();
          const appliedChange=updatedQuantity-priorQuantity;
          if(appliedChange!==0) recordMovement(item,appliedChange>0?'in':'adjustment',appliedChange,updatedQuantity,`Purchase ${purchase.invoiceNumber || ''} synced`,'Purchase');
          changed=true;
        }
      }
      if(JSON.stringify(previous || {})!==JSON.stringify(nextLines)) changed=true;
      purchaseSnapshots[purchase.id]=nextLines;
      if(!importedPurchaseIds.includes(purchase.id))importedPurchaseIds.push(purchase.id);
    }
    if(changed) { state.items=items; state.movements=movements; state.importedPurchaseIds=importedPurchaseIds; state.purchaseSnapshots=purchaseSnapshots; }
    return changed;
  }
  function getThresholdPercent(item) {
    const value=item.thresholdPercent == null ? 25 : number(item.thresholdPercent);
    return Math.min(100,Math.max(0,value));
  }
  function getMaxStock(item) {
    const movementMax=movements.filter((move)=>move.itemId===item.id).reduce((max,move)=>Math.max(max,number(move.balance)),0);
    return Math.max(number(item.maxStock),number(item.quantity),movementMax);
  }
  function getStatus(item) {
    const quantity=number(item.quantity), maxStock=getMaxStock(item), thresholdQuantity=maxStock*getThresholdPercent(item)/100;
    if(quantity<=0)return {key:'out',label:'Out of stock'};
    if(maxStock>0 && quantity<=thresholdQuantity)return {key:'low',label:'Low stock'};
    return {key:'in',label:'In stock'};
  }
  function visibleItems() {
    const query = byId('stock-search').value.trim().toLocaleLowerCase();
    const status = byId('status-filter').value;
    return items.filter((item) => {
      const matchesQuery = `${item.name} ${item.category}`.toLocaleLowerCase().includes(query);
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(item.category);
      const matchesStatus = status === 'all' || getStatus(item).key === status;
      return matchesQuery && matchesCategory && matchesStatus;
    }).slice().sort((a,b) => a.name.localeCompare(b.name));
  }
  function renderSummary() {
    byId('summary-items').textContent = items.length;
    byId('summary-units').textContent = new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(items.reduce((sum,item) => sum + number(item.quantity),0));
    byId('summary-low').textContent = items.filter((item) => getStatus(item).key !== 'in').length;
    byId('summary-value').textContent = money(items.reduce((sum,item) => sum + number(item.quantity) * number(item.unitCost),0));
  }
  function renderItemCategories(selected='') {
    const select=itemForm.elements.category;
    const sortedCategories=categories.slice().sort((a,b)=>a.localeCompare(b,'en-IN',{sensitivity:'base'}));
    select.innerHTML='<option value="">Choose a Purchases category</option>' + sortedCategories.map((category)=>`<option value="${safe(category)}">${safe(category)}</option>`).join('');
    select.value=categories.includes(selected) ? selected : (categories[0] || '');
    select.disabled=false;
  }
  function renderCategories() {
    selectedCategories=new Set([...selectedCategories].filter((category)=>categories.includes(category)));
    const menu=byId('category-filter-menu');
    const sortedCategories=categories.slice().sort((a,b)=>a.localeCompare(b,'en-IN',{sensitivity:'base'}));
    menu.innerHTML=sortedCategories.map((category)=>`<label class="category-option"><input type="checkbox" value="${safe(category)}" ${selectedCategories.has(category)?'checked':''}><span>${safe(category)}</span></label>`).join('') + '<button class="category-clear" type="button">Clear selection · show all</button>';
    const selected=[...selectedCategories];
    const label=selected.length===0?'All categories':selected.length<=2?selected.join(', '):`${selected.length} categories selected`;
    byId('category-filter-button').innerHTML=`${safe(label)} <span aria-hidden="true">⌄</span>`;
  }
  function reconcileItemCategories() {
    let changed=false;
    for(const item of items) if(!categories.includes(item.category)) { item.category=categories[0] || ''; changed=true; }
    if(changed) { state.items=items; }
    return changed;
  }
  function renderItems() {
    renderSummary(); renderCategories();
    const rows = visibleItems(), body = byId('stock-rows');
    byId('inventory-count').textContent = `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`;
    if (!rows.length) {
      const emptyMessage = items.length ? 'No items match these filters.' : 'No stock items yet.';
      body.innerHTML = `<tr class="empty-row"><td colspan="8"><div class="empty-state"><strong>${emptyMessage}</strong><span>${items.length ? 'Try another search or filter.' : 'Record a purchase to get started.'}</span></div></td></tr>`;
      renderMovements(); return;
    }
    body.innerHTML = rows.map((item) => {
      const status = getStatus(item), quantity = number(item.quantity), cost = number(item.unitCost);
      return `<tr><td><span class="item-name">${safe(item.name)}</span><span class="item-subtitle">Updated ${safe(window.WonderNestDate.format(new Date(item.updatedAt || todayIso()).toLocaleDateString('en-GB').split('/').reverse().join('-')))}</span></td><td>${getThresholdPercent(item)}%</td><td>${safe(item.category || '—')}</td><td class="quantity-cell">${quantity.toLocaleString('en-IN',{maximumFractionDigits:3})} ${safe(item.unit)}</td><td>${money(cost)}</td><td>${money(quantity * cost)}</td><td><span class="status-pill status-${status.key}">${status.label}</span></td><td><div class="action-group"><button class="text-button" type="button" data-action="movement" data-id="${safe(item.id)}">Adjust</button><button class="text-button" type="button" data-action="edit" data-id="${safe(item.id)}">Edit</button><button class="text-button danger" type="button" data-action="delete" data-id="${safe(item.id)}">Delete</button></div></td></tr>`;
    }).join('');
    renderMovements();
  }
  function formatMovementDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(date);
  }
  function renderMovements() {
    const body = byId('movement-rows'), recent = movements.slice(0,10);
    if (!recent.length) { body.innerHTML = '<tr><td colspan="6" class="history-empty">Stock movements will appear here.</td></tr>'; return; }
    body.innerHTML = recent.map((move) => {
      const movementType = move.type === 'in' ? 'Stock in' : move.type === 'out' ? 'Stock out' : 'Adjustment';
      const change = number(move.change), formattedChange = quantityFormat.format(Math.abs(change));
      const signedChange = move.type === 'in' ? `+${formattedChange}` : move.type === 'out' ? `−${formattedChange}` : `${change > 0 ? '+' : change < 0 ? '−' : ''}${formattedChange}`;
      return `<tr><td>${formatMovementDate(move.date)}</td><td><strong>${safe(move.itemName)}</strong><span class="item-subtitle">${safe(move.source || 'Manual')}</span></td><td>${movementType}</td><td>${signedChange} ${safe(move.unit || '')}</td><td>${quantityFormat.format(number(move.balance))} ${safe(move.unit || '')}</td><td>${safe(move.reason || '—')}</td></tr>`;
    }).join('');
  }
  function openItemForm(item=null) {
    itemForm.reset(); byId('item-form-error').hidden = true;
    byId('item-dialog-title').textContent = item ? 'Edit item' : 'Add an item';
    itemForm.elements.id.value = item?.id || '';
    itemForm.elements.name.value = item?.name || '';
    renderItemCategories(item?.category || '');
    itemForm.elements.category.value = categories.includes(item?.category) ? item.category : (categories[0] || '');
    itemForm.elements.unit.value = item?.unit || 'pcs';
    itemForm.elements.quantity.value = item ? number(item.quantity) : 0;
    itemForm.elements.thresholdPercent.value = item ? getThresholdPercent(item) : 25;
    itemForm.elements.unitCost.value = item ? number(item.unitCost) : 0;
    itemDialog.showModal(); itemForm.elements.name.focus();
  }
  async function saveItem(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(itemForm).entries()), id = data.id || crypto.randomUUID();
    const name = data.name.trim(), unit = unitName(data.unit), quantity = Math.max(0,number(data.quantity)), category=data.category.trim();
    if (!name) return;
    if (!categories.includes(category)) { const error=byId('item-form-error'); error.textContent='Choose a category managed from the Purchases page.'; error.hidden=false; renderItemCategories(category); return; }
    const duplicate = items.find((item) => item.id !== id && itemKey(item.name,item.unit) === itemKey(name,unit));
    if (duplicate) { const error=byId('item-form-error'); error.textContent='An item with the same name and unit already exists. Edit that item instead.'; error.hidden=false; return; }
    const prior = items.find((item) => item.id === id), item = { id,name,category,unit,quantity,maxStock:Math.max(prior ? getMaxStock(prior) : quantity,quantity),thresholdPercent:Math.min(100,Math.max(0,number(data.thresholdPercent))),unitCost:Math.max(0,number(data.unitCost)),createdAt:prior?.createdAt || todayIso(),updatedAt:todayIso() };
    if (prior) {
      const change = quantity - number(prior.quantity);
      items = items.map((entry) => entry.id === id ? item : entry);
      if (change !== 0) recordMovement(item,'adjustment',change,quantity,'Quantity changed while editing');
    } else {
      items.push(item);
      if (quantity > 0) recordMovement(item,'in',quantity,quantity,'Opening stock');
    }
    state.items=items; state.movements=movements;
    if (!await saveState()) return;
    itemDialog.close(); renderItems();
  }
  function openMovementForm(item) {
    movementForm.reset(); byId('movement-form-error').hidden=true;
    movementForm.elements.itemId.value=item.id; movementForm.elements.type.value='in'; movementForm.elements.quantity.value='1';
    byId('movement-item-name').textContent=`${item.name} · currently ${number(item.quantity)} ${item.unit}`;
    updateMovementHelp(); movementDialog.showModal(); movementForm.elements.quantity.focus();
  }
  function updateMovementHelp() {
    const type=movementForm.elements.type.value;
    byId('movement-quantity-help').textContent=type==='in'?'Enter the quantity received.':type==='out'?'Enter the quantity used, sold, or removed.':'Enter the actual quantity currently on hand.';
    movementForm.elements.quantity.min=type==='adjustment'?'0':'0.001';
  }
  async function saveMovement(event) {
    event.preventDefault();
    const item=items.find((entry)=>entry.id===movementForm.elements.itemId.value), type=movementForm.elements.type.value, quantity=number(movementForm.elements.quantity.value);
    if (!item) return;
    const error=byId('movement-form-error');
    if (type !== 'adjustment' && quantity <= 0) { error.textContent='Enter a quantity greater than zero.'; error.hidden=false; return; }
    const current=number(item.quantity), next=type==='in'?current+quantity:type==='out'?current-quantity:quantity;
    if (next < 0) { error.textContent=`Only ${current} ${item.unit} are available. Stock cannot go below zero.`; error.hidden=false; return; }
    const change=next-current;
    item.quantity=next; item.maxStock=Math.max(getMaxStock(item),next); item.updatedAt=todayIso();
    recordMovement(item,type,type==='adjustment'?change:quantity,next,movementForm.elements.reason.value.trim());
    state.items=items; state.movements=movements;
    if (!await saveState()) return;
    movementDialog.close(); renderItems();
  }
  async function deleteItem(id) {
    const item=items.find((entry)=>entry.id===id);
    if (!item || !confirm(`Delete “${item.name}” from stock? Its movement history will remain.`)) return;
    items=items.filter((entry)=>entry.id!==id); state.items=items;
    if (await saveState()) renderItems();
  }
  function exportCsv() {
    const rows=[['Item','Category','Quantity on hand','Threshold percent','Unit','Unit cost INR','Stock value INR','Status']];
    for (const item of visibleItems()) rows.push([item.name,item.category,item.quantity,getThresholdPercent(item),item.unit,item.unitCost,number(item.quantity)*number(item.unitCost),getStatus(item).label]);
    const csv=rows.map((row)=>row.map((value)=>`"${String(value ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const link=document.createElement('a'), url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    link.href=url; link.download=`wonderNest-stock-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  async function renderAll() { const reconciled=reconcileItemCategories(); state.items=items; state.movements=movements; state.importedPurchaseIds=importedPurchaseIds; state.purchaseSnapshots=purchaseSnapshots; renderItems(); if(reconciled) await saveState(); }

  async function initialize() {
  try {
    [state,categories,purchases] = await Promise.all([window.WonderNestDB.get('stock'),window.WonderNestDB.get('categories'),window.WonderNestDB.get('purchases')]);
    state={items:Array.isArray(state.items)?state.items:[],movements:Array.isArray(state.movements)?state.movements:[],importedPurchaseIds:Array.isArray(state.importedPurchaseIds)?state.importedPurchaseIds:[],purchaseSnapshots:state.purchaseSnapshots||{}};
    items=state.items; movements=state.movements; importedPurchaseIds=state.importedPurchaseIds; purchaseSnapshots=state.purchaseSnapshots;
    const changed=importPurchases(purchases); if(changed) await saveState();
    await renderAll();
  } catch(error) {
    document.body.insertAdjacentHTML('afterbegin',`<div class="database-error" role="alert">Could not connect to the local WonderNest database. Make sure app.py is running, then refresh this page. ${safe(error.message)}</div>`); return;
  }
  byId('today-label').textContent=window.WonderNestDate.today();
  byId('export-stock').addEventListener('click',exportCsv);
  byId('stock-search').addEventListener('input',renderItems);
  byId('category-filter-menu').addEventListener('change',(event)=>{if(event.target.matches('input[type=checkbox]')){if(event.target.checked)selectedCategories.add(event.target.value);else selectedCategories.delete(event.target.value);renderItems();byId('category-filter-menu').hidden=false;byId('category-filter-button').setAttribute('aria-expanded','true');}});
  byId('category-filter-menu').addEventListener('click',(event)=>{if(event.target.closest('.category-clear')){selectedCategories.clear();renderItems();byId('category-filter-menu').hidden=false;byId('category-filter-button').setAttribute('aria-expanded','true');}});
  byId('category-filter-button').addEventListener('click',()=>{const menu=byId('category-filter-menu');menu.hidden=!menu.hidden;byId('category-filter-button').setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('click',(event)=>{if(!byId('category-filter').contains(event.target)){byId('category-filter-menu').hidden=true;byId('category-filter-button').setAttribute('aria-expanded','false');}});
  byId('category-filter').addEventListener('keydown',(event)=>{if(event.key==='Escape'){byId('category-filter-menu').hidden=true;byId('category-filter-button').setAttribute('aria-expanded','false');byId('category-filter-button').focus();}});
  byId('status-filter').addEventListener('change',renderItems);
  byId('stock-rows').addEventListener('click',(event)=>{
    const button=event.target.closest('[data-action]'); if(!button)return;
    const item=items.find((entry)=>entry.id===button.dataset.id); if(!item)return;
    if(button.dataset.action==='edit')openItemForm(item);
    if(button.dataset.action==='movement')openMovementForm(item);
    if(button.dataset.action==='delete')deleteItem(item.id);
  });
  byId('close-item-dialog').addEventListener('click',()=>itemDialog.close());
  byId('cancel-item').addEventListener('click',()=>itemDialog.close());
  itemForm.addEventListener('submit',saveItem);
  byId('close-movement-dialog').addEventListener('click',()=>movementDialog.close());
  byId('cancel-movement').addEventListener('click',()=>movementDialog.close());
  movementForm.elements.type.addEventListener('change',updateMovementHelp);
  movementForm.addEventListener('submit',saveMovement);
  async function refreshStockFromDatabase() {
    if (itemDialog.open || movementDialog.open) return;
    state=await window.WonderNestDB.get('stock');
    items=Array.isArray(state.items)?state.items:[];
    movements=Array.isArray(state.movements)?state.movements:[];
    importedPurchaseIds=Array.isArray(state.importedPurchaseIds)?state.importedPurchaseIds:[];
    purchaseSnapshots=state.purchaseSnapshots||{};
    await renderAll();
  }
  window.WonderNestDB.subscribe(async ({store})=>{try{if(store==='purchases'||store==='categories'){[purchases,categories]=await Promise.all([window.WonderNestDB.get('purchases'),window.WonderNestDB.get('categories')]);if(importPurchases(purchases))await saveState();await renderAll();}else if(store==='stock'){await refreshStockFromDatabase();}}catch(error){console.error(error);}});
  window.addEventListener('focus',()=>refreshStockFromDatabase().catch((error)=>console.error(error)));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshStockFromDatabase().catch((error)=>console.error(error));});
  }
  initialize();
})();
