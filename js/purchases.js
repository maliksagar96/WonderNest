(() => {
  'use strict';
  const DEFAULT_CATEGORIES = ['Inventory / resale goods','Raw materials','Packaging','Equipment','Office expense','Other'];
  const byId = (id) => document.getElementById(id);
  const form = byId('purchase-form');
  const vendorForm = byId('vendor-form');
  const vendorDialog = byId('vendor-dialog');
  const itemList = byId('item-list');
  const itemTemplate = byId('item-row-template');
  let vendors = [];
  let purchases = [];
  let categories = [];
  let editingPurchaseId = null;
  let summaryPeriodsInitialized = false;

  async function writeStore(key, value) { try { await window.WonderNestDB.set(key, value); return true; } catch (error) { alert(`Could not save to the local database: ${error.message}`); return false; } }
  function money(amount) { return new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' }).format(Number(amount) || 0); }
  function unitPriceText(amount) { const rounded = (Number(amount) || 0).toFixed(6).replace(/0+$/,'').replace(/\.$/,''); return rounded.includes('.') ? rounded : `${rounded}.00`; }
  function safeText(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
  function dateInputValue(value) {
    const formatted = window.WonderNestDate.format(value);
    const match = formatted.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  }
  function safePurchaseLink(value) {
    try { const url = new URL(String(value || '')); return ['http:','https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }
  function getVendor(id) { return vendors.find((vendor) => vendor.id === id); }
  function vendorCategory(vendor) { const label = String(vendor?.label || '').trim(); return !label || label.toLocaleLowerCase() === 'na' ? 'General' : label; }
  function renderVendorPicker() {
    const select = byId('vendor-select'), button = byId('vendor-picker-button'), categoryFilter = byId('vendor-category-filter'), optionList = byId('vendor-option-list');
    const selected = select.value === '__na' ? { id: '__na', name: 'NA / vendor not recorded' } : getVendor(select.value);
    const selectedCategory = categoryFilter.value || 'all';
    const categories = [...new Set(vendors.map(vendorCategory))].sort((a,b) => a.localeCompare(b,'en-IN',{sensitivity:'base',numeric:true}));
    categoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => `<option value="${safeText(category)}">${safeText(category)}</option>`).join('');
    categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : 'all';
    const badge = (vendor) => `<span class="vendor-label-badge">${safeText(vendorCategory(vendor))}</span>`;
    button.innerHTML = `<span class="vendor-option-name">${safeText(selected?.name || 'Choose a vendor')}</span>${selected && selected.id !== '__na' ? badge(selected) : ''}<span aria-hidden="true">⌄</span>`;
    button.setAttribute('aria-label', selected ? `Vendor: ${selected.name}${selected.id === '__na' ? '' : `, category ${vendorCategory(selected)}`}` : 'Choose a vendor');
    const choices = [{ id: '__na', name: 'NA / vendor not recorded' }, ...vendors.filter((vendor) => categoryFilter.value === 'all' || vendorCategory(vendor) === categoryFilter.value)];
    if (!vendors.length) {
      optionList.innerHTML = `<button type="button" class="vendor-option vendor-na-option" role="option" aria-selected="${select.value === '__na'}" data-vendor-id="__na">NA / vendor not recorded</button><p class="vendor-picker-empty">No saved vendors yet.</p>`;
      return;
    }
    const grouped = new Map();
    for (const vendor of choices.filter((entry) => entry.id !== '__na').sort((a,b) => vendorCategory(a).localeCompare(vendorCategory(b),'en-IN',{sensitivity:'base',numeric:true}) || a.name.localeCompare(b.name,'en-IN',{sensitivity:'base',numeric:true}))) {
      const category = vendorCategory(vendor);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(vendor);
    }
    const vendorButton = (vendor) => `<button type="button" class="vendor-option" role="option" aria-selected="${select.value === vendor.id}" data-vendor-id="${safeText(vendor.id)}"><span class="vendor-option-name">${safeText(vendor.name)}${vendor.gstin && vendor.gstin !== 'NA' ? ` · ${safeText(vendor.gstin)}` : ''}</span>${badge(vendor)}</button>`;
    optionList.innerHTML = `<button type="button" class="vendor-option vendor-na-option" role="option" aria-selected="${select.value === '__na'}" data-vendor-id="__na">NA / vendor not recorded</button>${[...grouped.entries()].map(([category,group]) => `<div class="vendor-option-group" role="group" aria-label="${safeText(category)}"><span class="vendor-option-group-label">${safeText(category)}</span>${group.map(vendorButton).join('')}</div>`).join('')}`;
  }
  function renderVendors(selectedId = byId('vendor-select').value) {
    const select = byId('vendor-select');
    select.innerHTML = '<option value="">Choose a vendor</option><option value="__na">NA / vendor not recorded</option>' + vendors.map((vendor) => `<option value="${safeText(vendor.id)}">${safeText(vendor.name)} · ${safeText(vendorCategory(vendor))}${vendor.gstin && vendor.gstin !== 'NA' ? ` · ${safeText(vendor.gstin)}` : ''}</option>`).join('');
    window.WonderNestDropdown.sort(select);
    if (selectedId === '__na' || (selectedId && getVendor(selectedId))) select.value = selectedId;
    byId('edit-vendor-button').disabled = !getVendor(select.value);
    renderVendorPicker();
    renderVendorSnapshot();
  }
  function renderVendorDirectory() {
    const list = byId('vendor-directory-list'), categorySelect = byId('vendor-directory-category'), selectedCategory = categorySelect.value || 'all';
    const directoryCategories = [...new Set(vendors.map(vendorCategory))].sort((a,b) => a.localeCompare(b,'en-IN',{sensitivity:'base',numeric:true}));
    categorySelect.innerHTML = '<option value="all">All categories</option>' + directoryCategories.map((category) => `<option value="${safeText(category)}">${safeText(category)}</option>`).join('');
    categorySelect.value = directoryCategories.includes(selectedCategory) ? selectedCategory : 'all';
    const sorted = vendors.filter((vendor) => categorySelect.value === 'all' || vendorCategory(vendor) === categorySelect.value).sort((a,b) => String(a.name).localeCompare(String(b.name),'en-IN',{sensitivity:'base',numeric:true}));
    if (!sorted.length) {
      list.innerHTML = vendors.length ? '<div class="vendor-directory-empty"><strong>No vendors in this category</strong><span>Choose another category to see more vendors.</span></div>' : '<div class="vendor-directory-empty"><strong>No vendors saved yet</strong><span>Add a vendor from the purchase form to keep their details here.</span></div>';
      return;
    }
    const detail = (label,value) => value && value !== 'NA' ? `<div class="vendor-directory-detail"><span>${label}</span><strong>${safeText(value)}</strong></div>` : '';
    list.innerHTML = sorted.map((vendor) => {
      const address = [vendor.address,vendor.state,vendor.pincode].filter((value) => value && value !== 'NA').join(' · ');
      return `<article class="vendor-directory-card"><div class="vendor-directory-card-heading"><div><h3>${safeText(vendor.name || 'Unnamed vendor')}</h3><span class="vendor-label-badge">${safeText(vendorCategory(vendor))}</span></div><button class="text-button" type="button" data-edit-directory-vendor="${safeText(vendor.id)}">Edit</button></div><div class="vendor-directory-details">${detail('GSTIN',vendor.gstin)}${detail('Phone',vendor.phone)}${detail('Contact',vendor.contactPerson)}${detail('Email',vendor.email)}${detail('Address',address)}${detail('Payment terms',vendor.paymentTerms)}${detail('Notes',vendor.notes)}</div></article>`;
    }).join('');
  }
  function renderVendorSnapshot() {
    const vendor = getVendor(byId('vendor-select').value), box = byId('vendor-snapshot');
    if (!vendor) { box.hidden = true; box.textContent = ''; return; }
    const details = [vendor.gstin && `GSTIN: ${vendor.gstin}`,vendor.phone && `Phone: ${vendor.phone}`,vendor.email,vendor.contactPerson && `Contact: ${vendor.contactPerson}`,vendor.address,[vendor.state,vendor.pincode].filter(Boolean).join(' · ')].filter(Boolean);
    box.innerHTML = `<div class="vendor-snapshot-heading"><strong>${safeText(vendor.name)}</strong><span class="vendor-label-badge">${safeText(vendorCategory(vendor))}</span></div>${details.length ? `<div class="vendor-snapshot-details">${details.map(safeText).join(' · ')}</div>` : ''}`;
    box.hidden = false;
  }
  function renderCategories(selected = byId('purchase-category').value) {
    const select = byId('purchase-category');
    const legacyCategory = selected && selected !== 'NA' && !categories.includes(selected) ? `<option value="${safeText(selected)}">${safeText(selected)} (saved purchase)</option>` : '';
    select.innerHTML = '<option value="NA">NA</option>' + categories.map((category) => `<option value="${safeText(category)}">${safeText(category)}</option>`).join('') + legacyCategory;
    window.WonderNestDropdown.sort(select);
    if (selected && (selected === 'NA' || categories.includes(selected))) select.value = selected;
    const sortedCategories = categories.map((category,index) => ({category,index})).sort((a,b) => a.category.localeCompare(b.category,'en-IN',{sensitivity:'base',numeric:true}));
    byId('category-list').innerHTML = sortedCategories.length ? sortedCategories.map(({category,index}) => `<div class="category-row" data-index="${index}"><span class="category-row-name">${safeText(category)}</span><div class="category-row-actions"><button class="text-button category-edit" type="button" data-index="${index}">Edit</button><button class="text-button category-remove" type="button" data-index="${index}">Remove</button></div></div>`).join('') : '<p class="category-empty">No custom categories yet. Add one above.</p>';
  }
  async function addCategory(event) {
    event.preventDefault();
    const input = byId('category-form').elements.categoryName;
    const name = input.value.trim();
    if (!name || name.toLocaleLowerCase() === 'na') { input.focus(); return; }
    if (categories.some((category) => category.toLocaleLowerCase() === name.toLocaleLowerCase())) { alert('That category already exists.'); input.focus(); return; }
    const next = [...categories,name];
    if (!await writeStore('categories',next)) return;
    categories = next; input.value = ''; renderCategories(name);
  }
  async function removeCategory(index) {
    const category = categories[index];
    if (!category || !confirm(`Remove “${category}” from the category list? Existing purchases will keep their saved category.`)) return;
    const next = categories.filter((_,itemIndex) => itemIndex !== index);
    if (!await writeStore('categories',next)) return;
    categories = next; renderCategories('NA');
  }
  function editCategory(index) {
    const category = categories[index];
    const row = byId('category-list').querySelector(`.category-row[data-index="${index}"]`);
    if (!category || !row) return;
    row.innerHTML = `<input class="category-edit-input" type="text" aria-label="Category name" maxlength="80" value="${safeText(category)}"><div class="category-row-actions"><button class="text-button category-save" type="button" data-index="${index}">Save</button><button class="text-button category-cancel" type="button" data-index="${index}">Cancel</button></div>`;
    const input = row.querySelector('.category-edit-input');
    input.focus(); input.select();
  }
  async function saveCategory(index) {
    const oldName = categories[index];
    const input = byId('category-list').querySelector(`.category-row[data-index="${index}"] .category-edit-input`);
    const newName = input?.value.trim();
    if (!oldName || !newName || newName.toLocaleLowerCase() === 'na') { input?.focus(); return; }
    if (categories.some((category,itemIndex) => itemIndex !== index && category.toLocaleLowerCase() === newName.toLocaleLowerCase())) { alert('That category already exists.'); input.focus(); return; }
    if (newName === oldName) { renderCategories(); return; }
    const nextCategories = categories.map((category,itemIndex) => itemIndex === index ? newName : category);
    const nextPurchases = purchases.map((purchase) => purchase.category === oldName ? {...purchase,category:newName} : purchase);
    if (!await writeStore('categories',nextCategories)) return;
    if (!await writeStore('purchases',nextPurchases)) {
      try { await window.WonderNestDB.set('categories',categories); } catch (error) { console.error('Could not roll back category rename:',error); }
      return;
    }
    const selected = byId('purchase-category').value === oldName ? newName : byId('purchase-category').value;
    categories = nextCategories; purchases = nextPurchases; renderCategories(selected); renderPurchases();
  }
  function addItem(values = {}) {
    const row = itemTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.priceSource = values.priceSource === 'rate' ? 'rate' : 'lineAmount';
    const unitSelect = row.querySelector('[data-field="unit"]');
    const unitValue = String(values.unit ?? '').trim().replace(/^1\s*kg$/i,'kg');
    if (unitValue && !Array.from(unitSelect.options).some((option) => option.value === unitValue)) unitSelect.add(new Option(unitValue,unitValue));
    for (const input of row.querySelectorAll('[data-field]')) {
      if (values[input.dataset.field] != null) input.value = input.dataset.field === 'unit' ? unitValue : values[input.dataset.field];
      const update = () => { if (['rate','lineAmount'].includes(input.dataset.field)) row.dataset.priceSource = input.dataset.field; if (['rate','lineAmount','quantity','gstRate'].includes(input.dataset.field)) syncItemPrice(row); recalculate(); };
      input.addEventListener('input',update); input.addEventListener('change',update);
    }
    window.WonderNestDropdown.sort(unitSelect);
    row.querySelector('.remove-item').addEventListener('click', () => { if (itemList.children.length > 1) row.remove(); else { for (const input of row.querySelectorAll('[data-field]')) input.value = input.dataset.field === 'quantity' ? '1' : input.dataset.field === 'rate' ? '0.00' : ['lineAmount','gstRate'].includes(input.dataset.field) ? '0' : ''; row.dataset.priceSource = 'lineAmount'; } recalculate(); });
    itemList.append(row); recalculate();
  }
  function syncItemPrice(row) {
    const value = (name) => Math.max(0,Number(row.querySelector(`[data-field="${name}"]`).value) || 0);
    const quantity = value('quantity'), gstRate = value('gstRate'), multiplier = 1 + gstRate / 100;
    const rateInput = row.querySelector('[data-field="rate"]'), amountInput = row.querySelector('[data-field="lineAmount"]');
    if (row.dataset.priceSource === 'rate') amountInput.value = (quantity * value('rate') * multiplier).toFixed(2);
    else rateInput.value = unitPriceText(quantity > 0 ? value('lineAmount') / multiplier / quantity : 0);
  }
  function calculate() {
    let subtotal = 0, tax = 0;
    for (const row of itemList.children) {
      const value = (name) => Number(row.querySelector(`[data-field="${name}"]`).value) || 0;
      const quantity = value('quantity'), lineAmount = value('lineAmount'), gstRate = value('gstRate');
      const base = gstRate > 0 ? lineAmount / (1 + gstRate / 100) : lineAmount;
      subtotal += base; tax += lineAmount - base;
      row.querySelector('.item-line-total strong').textContent = money(lineAmount);
    }
    const shipping = Number(form.elements.shipping.value) || 0;
    const shippingGstRate = Number(form.elements.shippingGstRate.value) || 0;
    const shippingBase = shippingGstRate > 0 ? shipping / (1 + shippingGstRate / 100) : shipping;
    const shippingTax = shipping - shippingBase;
    const discount = Number(form.elements.discount.value) || 0;
    return { subtotal, tax:tax + shippingTax, adjustments:shippingBase-discount, total:Math.max(0,subtotal+tax+shipping-discount) };
  }
  function recalculate() {
    const totals = calculate();
    byId('subtotal-value').textContent = money(totals.subtotal); byId('tax-value').textContent = money(totals.tax); byId('adjustments-value').textContent = money(totals.adjustments); byId('grand-total-value').textContent = money(totals.total);
    // Keep the user's amount in place while editing; the total may be incomplete
    // when old or NA item details are being corrected.
  }
  function getPurchaseMonth(purchase) {
    const match = window.WonderNestDate.format(purchase.invoiceDate).match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return match ? `${match[3]}-${match[2]}` : null;
  }
  function getMonthOptions() {
    const purchaseMonths = purchases.map(getPurchaseMonth).filter(Boolean).sort();
    const current = new Date(), currentMonth = new Date(current.getFullYear(),current.getMonth(),1);
    const previousMonth = new Date(current.getFullYear(),current.getMonth()-1,1);
    const earliestPurchaseMonth = purchaseMonths.length ? new Date(Number(purchaseMonths[0].slice(0,4)),Number(purchaseMonths[0].slice(5,7))-1,1) : previousMonth;
    const firstMonth = earliestPurchaseMonth < previousMonth ? earliestPurchaseMonth : previousMonth;
    const months = [];
    for (let month = new Date(firstMonth); month <= currentMonth; month.setMonth(month.getMonth()+1)) {
      months.push(`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`);
    }
    return months.reverse();
  }
  function updateSummary() {
    const purchaseSelector = byId('purchase-period'), itcSelector = byId('itc-period');
    const currentDate = new Date(), currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}`;
    const purchasePeriod = summaryPeriodsInitialized ? purchaseSelector.value || currentMonth : currentMonth;
    const itcPeriod = summaryPeriodsInitialized ? itcSelector.value || currentMonth : currentMonth;
    const months = getMonthOptions();
    for (const [selector,selectedPeriod] of [[purchaseSelector,purchasePeriod],[itcSelector,itcPeriod]]) {
      selector.innerHTML = months.map((month) => {
        const [year,monthNumber] = month.split('-');
        const label = new Intl.DateTimeFormat('en-IN', { month:'long',year:'numeric' }).format(new Date(Number(year),Number(monthNumber)-1,1));
        return `<option value="${month}">${label}</option>`;
      }).join('') + '<option value="total">Total</option>';
      selector.value = selectedPeriod === 'total' || months.includes(selectedPeriod) ? selectedPeriod : currentMonth;
    }
    summaryPeriodsInitialized = true;
    const periodPurchases = purchases.filter((purchase) => purchaseSelector.value === 'total' || getPurchaseMonth(purchase) === purchaseSelector.value);
    byId('summary-count').textContent = periodPurchases.length;
    byId('summary-total').textContent = money(periodPurchases.reduce((sum,purchase) => sum + (Number(purchase.total) || 0),0));
    const itc = purchases.reduce((sum,purchase) => sum + (itcSelector.value === 'total' || getPurchaseMonth(purchase) === itcSelector.value ? (Number(purchase.tax) || 0) : 0),0);
    byId('summary-itc').textContent = money(itc);
  }
  function getPurchaseDateValue(purchase) {
    const formatted = window.WonderNestDate.format(purchase.invoiceDate);
    const match = formatted.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return 0;
    return new Date(Number(match[3]),Number(match[2])-1,Number(match[1])).getTime();
  }  function renderPurchases() {
    updateSummary();
    const query = byId('purchase-search').value.trim().toLocaleLowerCase();
    const period = byId('purchase-period').value || 'total';
    const visible = purchases.filter((purchase) => {
      const matchesPeriod = period === 'total' || getPurchaseMonth(purchase) === period;
      const searchable = `${purchase.vendorName} ${purchase.invoiceNumber} ${purchase.category || ''} ${purchase.items.map((item) => item.name).join(' ')}`.toLocaleLowerCase();
      return matchesPeriod && searchable.includes(query);
    }).slice().sort((a,b) => getPurchaseDateValue(b) - getPurchaseDateValue(a) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const body = byId('purchase-rows');
    if (!visible.length) { body.innerHTML = `<tr class="empty-row"><td colspan="7"><span class="empty-icon">↗</span><strong>${period !== 'total' ? 'No purchases in ' + byId('purchase-period').selectedOptions[0].textContent + '.' : purchases.length ? 'No purchases match your search.' : 'No purchases yet'}</strong><span>${period !== 'total' ? 'Try another month or choose Total.' : purchases.length ? 'Try another vendor or item name.' : 'Start by recording your first purchase.'}</span>${purchases.length ? '' : '<button class="text-button" type="button" id="empty-new-purchase">＋ Add a purchase</button>'}</td></tr>`; byId('empty-new-purchase')?.addEventListener('click',openPurchaseForm); return; }
    const grouped = new Map();
    for (const purchase of visible) {
      const month = getPurchaseMonth(purchase) || 'unknown';
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(purchase);
    }
    body.innerHTML = [...grouped.entries()].map(([month,purchasesInMonth]) => {
      const [year,monthNumber] = month.split('-');
      const heading = month === 'unknown' ? 'Date not specified' : new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(Number(year),Number(monthNumber)-1,1));
      const rows = purchasesInMonth.map((purchase) => {
        const date = window.WonderNestDate.format(purchase.invoiceDate), items = purchase.items.map((item) => item.name || 'NA').join(', ');
        const purchaseLink = safePurchaseLink(purchase.purchaseLink);
        const vendor = getVendor(purchase.vendorId), vendorGstin = purchase.vendorGstin || vendor?.gstin, vendorLabel = purchase.vendorLabel && purchase.vendorLabel !== 'NA' ? purchase.vendorLabel : vendor ? vendorCategory(vendor) : '';
        const vendorTaxDetails = vendorGstin && vendorGstin !== 'NA' ? `<span class="purchase-vendor-tax">GSTIN: ${safeText(vendorGstin)}${vendorLabel ? ` <span class="vendor-label-badge">${safeText(vendorLabel)}</span>` : ''}</span>` : '';
        return `<tr><td>${safeText(date)}</td><td><strong>${safeText(purchase.vendorName)}</strong>${vendorTaxDetails}${purchaseLink ? `<a class="purchase-source-link" href="${safeText(purchaseLink)}" target="_blank" rel="noopener noreferrer">View purchase ↗</a>` : ''}</td><td>${safeText(purchase.category || 'NA')}</td><td title="${safeText(items)}">${safeText(items.length > 45 ? items.slice(0,42)+'…' : items)}</td><td>${safeText(purchase.invoiceNumber || 'NA')}</td><td><strong>${money(purchase.total)}</strong></td><td><button class="text-button edit-purchase-button" type="button" data-id="${safeText(purchase.id)}">Edit</button></td></tr>`;
      }).join('');
      return `<tr class="purchase-month-heading"><td colspan="7">${safeText(heading)}</td></tr>${rows}`;
    }).join('');
  }
  function openPurchaseForm(purchase = null) {
    editingPurchaseId = purchase?.id || null;
    form.reset(); byId('purchase-form-panel').hidden = false;
    byId('purchase-form-panel').querySelector('h2').textContent = purchase ? 'Edit purchase' : 'Record a purchase';
    form.querySelector('button[type="submit"]').textContent = purchase ? 'Update purchase' : 'Save purchase';
    byId('purchase-form-panel').scrollIntoView({ behavior:'smooth',block:'start' });
    itemList.innerHTML = '';
    if (purchase) {
      renderCategories(purchase.category || 'NA');
      renderVendors(purchase.vendorId && getVendor(purchase.vendorId) ? purchase.vendorId : '__na');
      form.elements.invoiceNumber.value = purchase.invoiceNumber || '';
      form.elements.invoiceDate.value = dateInputValue(purchase.invoiceDate);
      form.elements.purchaseLink.value = purchase.purchaseLink || '';
      form.elements.category.value = purchase.category || 'NA';
      form.elements.shipping.value = purchase.shipping ?? 0;
      form.elements.shippingGstRate.value = purchase.shippingGstRate ?? 0;
      form.elements.discount.value = purchase.discount ?? 0;
      form.elements.notes.value = purchase.notes || '';
      form.elements.attachmentReference.value = purchase.attachmentReference || '';
      (purchase.items?.length ? purchase.items : [{}]).forEach((item) => {
        const gstRate = Number(item.gstRate) || 0;
        const lineAmount = item.lineAmount ?? ((Number(item.quantity) || 0) * (Number(item.rate) || 0) * (1 + gstRate / 100));
        addItem({ ...item, lineAmount });
      });
    } else {
      form.elements.invoiceDate.value = dateInputValue(window.WonderNestDate.today());
      renderCategories('NA'); renderVendors(''); addItem();
    }
    recalculate();
  }
  function closePurchaseForm() { byId('purchase-form-panel').hidden = true; form.reset(); editingPurchaseId = null; }
  function openVendorDialog(vendor = null) { vendorForm.reset(); vendorForm.elements.vendorId.value = vendor?.id || ''; byId('vendor-dialog-title').textContent = vendor ? 'Edit vendor' : 'Add a vendor'; for (const [key,value] of Object.entries(vendor || {})) if (vendorForm.elements[key]) vendorForm.elements[key].value = value; vendorDialog.showModal(); }
  async function saveVendor(event) {
    event.preventDefault(); const data = Object.fromEntries(new FormData(vendorForm).entries()), id = data.vendorId || crypto.randomUUID(); delete data.vendorId; data.name = data.name.trim() || 'NA'; data.label = vendorCategory({label:data.label});
    const next = vendors.some((vendor) => vendor.id === id) ? vendors.map((vendor) => vendor.id === id ? {...vendor,...data,id} : vendor) : [...vendors,{...data,id}];
    if (!await writeStore('vendors',next)) return; vendors = next; renderVendors(id); vendorDialog.close();
  }
  async function savePurchase(event) {
    event.preventDefault(); const vendor = getVendor(byId('vendor-select').value) || { id:'',name:'NA',gstin:'NA' }; if (!byId('vendor-select').value) { byId('vendor-select').focus(); return; }
    if (!window.WonderNestDate.isValid(form.elements.invoiceDate.value)) { alert('Choose a valid invoice date.'); form.elements.invoiceDate.focus(); return; }
    const items = [...itemList.children].map((row) => Object.fromEntries([...row.querySelectorAll('[data-field]')].map((input) => [input.dataset.field,['quantity','rate','gstRate','lineAmount','contentQuantity'].includes(input.dataset.field) ? Number(input.value) || 0 : input.value.trim()])));
    const incompleteContents = [...itemList.children].find((row) => Number(row.querySelector('[data-field="contentQuantity"]').value) > 0 && !row.querySelector('[data-field="contentUnit"]').value);
    if (incompleteContents) { alert('Choose the contents unit for each package size, such as ml for a 400 ml bottle.'); incompleteContents.querySelector('[data-field="contentUnit"]').focus(); return; }
    const totals = calculate();
    const prior = editingPurchaseId ? purchases.find((entry) => entry.id === editingPurchaseId) : null;
    const purchase = { id:editingPurchaseId || crypto.randomUUID(),createdAt:prior?.createdAt || new Date().toISOString(),vendorId:vendor.id,vendorName:vendor.name,vendorGstin:vendor.gstin,vendorLabel:vendorCategory(vendor),invoiceNumber:form.elements.invoiceNumber.value.trim(),invoiceDate:window.WonderNestDate.format(form.elements.invoiceDate.value),purchaseLink:safePurchaseLink(form.elements.purchaseLink.value.trim()),category:form.elements.category.value,shipping:Number(form.elements.shipping.value)||0,shippingGstRate:Number(form.elements.shippingGstRate.value)||0,discount:Number(form.elements.discount.value)||0,subtotal:totals.subtotal,tax:totals.tax,total:totals.total,notes:form.elements.notes.value.trim(),attachmentReference:form.elements.attachmentReference.value.trim(),items };
    const next = editingPurchaseId ? purchases.map((entry) => entry.id === editingPurchaseId ? purchase : entry) : [...purchases,purchase]; if (!await writeStore('purchases',next)) return; purchases = next; closePurchaseForm(); renderPurchases();
  }
  async function initialize() {
    try { [vendors,purchases,categories] = await Promise.all([window.WonderNestDB.get('vendors'),window.WonderNestDB.get('purchases'),window.WonderNestDB.get('categories')]); const normalizedVendors = vendors.map((vendor) => ({...vendor,label:vendorCategory(vendor)})); if (normalizedVendors.some((vendor,index) => vendor.label !== vendors[index].label)) { if (await writeStore('vendors',normalizedVendors)) vendors = normalizedVendors; } }
    catch (error) { document.body.insertAdjacentHTML('afterbegin',`<div class="database-error" role="alert">Could not connect to the local WonderNest database. Make sure app.py is running, then refresh this page. ${safeText(error.message)}</div>`); return; }
    byId('today-label').textContent = window.WonderNestDate.today();
    window.WonderNestDropdown.sortAll();
    byId('new-purchase-button').addEventListener('click',openPurchaseForm); byId('close-form-button').addEventListener('click',closePurchaseForm); byId('cancel-purchase-button').addEventListener('click',closePurchaseForm);
    byId('purchase-rows').addEventListener('click',(event) => { const button = event.target.closest('.edit-purchase-button'); if (button) { const purchase = purchases.find((entry) => entry.id === button.dataset.id); if (purchase) openPurchaseForm(purchase); } });
    byId('add-vendor-button').addEventListener('click',() => openVendorDialog()); byId('edit-vendor-button').addEventListener('click',() => openVendorDialog(getVendor(byId('vendor-select').value)));
    const vendorListDialog = byId('vendor-list-dialog');
    byId('view-vendors-button').addEventListener('click',() => { document.querySelector('.purchase-options').open = false; renderVendorDirectory(); vendorListDialog.showModal(); });
    byId('vendor-directory-category').addEventListener('change',renderVendorDirectory);
    byId('close-vendor-list').addEventListener('click',() => vendorListDialog.close()); byId('done-vendor-list').addEventListener('click',() => vendorListDialog.close());
    byId('vendor-directory-list').addEventListener('click',(event) => { const button = event.target.closest('[data-edit-directory-vendor]'); if (!button) return; const vendor = getVendor(button.dataset.editDirectoryVendor); if (!vendor) return; vendorListDialog.close(); openVendorDialog(vendor); });
    byId('close-vendor-dialog').addEventListener('click',() => vendorDialog.close()); byId('cancel-vendor-button').addEventListener('click',() => vendorDialog.close()); vendorForm.addEventListener('submit',saveVendor); form.addEventListener('submit',savePurchase);
    byId('vendor-picker-button').addEventListener('click',() => { const menu = byId('vendor-picker-menu'), open = menu.hidden; menu.hidden = !open; byId('vendor-picker-button').setAttribute('aria-expanded',String(open)); if (open) byId('vendor-category-filter').focus(); });
    byId('vendor-category-filter').addEventListener('change',renderVendorPicker);
    byId('vendor-picker-menu').addEventListener('keydown',(event) => { if (event.key === 'Escape') { byId('vendor-picker-menu').hidden = true; byId('vendor-picker-button').setAttribute('aria-expanded','false'); byId('vendor-picker-button').focus(); } });
    byId('vendor-picker-menu').addEventListener('click',(event) => { const option = event.target.closest('.vendor-option'); if (!option) return; byId('vendor-select').value = option.dataset.vendorId; byId('vendor-picker-menu').hidden = true; byId('vendor-picker-button').setAttribute('aria-expanded','false'); byId('vendor-select').dispatchEvent(new Event('change',{bubbles:true})); byId('vendor-picker-button').focus(); });
    document.addEventListener('click',(event) => { if (!event.target.closest('.vendor-picker')) { byId('vendor-picker-menu').hidden = true; byId('vendor-picker-button').setAttribute('aria-expanded','false'); } if (!event.target.closest('.purchase-options')) document.querySelector('.purchase-options').open = false; });
    document.addEventListener('keydown',(event) => { if (event.key === 'Escape') document.querySelector('.purchase-options').open = false; });
    byId('vendor-select').addEventListener('change',() => { byId('edit-vendor-button').disabled = !getVendor(byId('vendor-select').value); renderVendorPicker(); renderVendorSnapshot(); }); byId('add-item-button').addEventListener('click',() => addItem()); byId('purchase-search').addEventListener('input',renderPurchases); byId('purchase-period').addEventListener('change',renderPurchases); byId('itc-period').addEventListener('change',updateSummary); form.addEventListener('input',recalculate);
    byId('manage-categories-button').addEventListener('click',() => { renderCategories(); byId('category-dialog').showModal(); }); byId('close-category-dialog').addEventListener('click',() => byId('category-dialog').close()); byId('done-category-button').addEventListener('click',() => byId('category-dialog').close()); byId('category-form').addEventListener('submit',addCategory); byId('category-list').addEventListener('click',(event) => { const edit = event.target.closest('.category-edit'); const save = event.target.closest('.category-save'); const cancel = event.target.closest('.category-cancel'); const remove = event.target.closest('.category-remove'); if (edit) editCategory(Number(edit.dataset.index)); else if (save) saveCategory(Number(save.dataset.index)); else if (cancel) renderCategories(); else if (remove) removeCategory(Number(remove.dataset.index)); }); byId('category-list').addEventListener('keydown',(event) => { if (event.key !== 'Enter' || !event.target.matches('.category-edit-input')) return; event.preventDefault(); saveCategory(Number(event.target.closest('.category-row').dataset.index)); });
    renderVendors(''); renderCategories('NA'); renderPurchases();
    window.WonderNestDB.subscribe(async ({store}) => { try { if (store==='purchases') purchases=await window.WonderNestDB.get('purchases'); if (store==='vendors') vendors=await window.WonderNestDB.get('vendors'); if (store==='categories') categories=await window.WonderNestDB.get('categories'); if (['purchases','vendors','categories'].includes(store)) { renderVendors(); renderCategories(); renderPurchases(); } } catch (error) { console.error(error); } });
  }
  initialize();
})();

