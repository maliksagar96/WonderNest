(() => {
  'use strict';
  const compare = (a, b) => a.textContent.trim().localeCompare(b.textContent.trim(), 'en-IN', {
    sensitivity: 'base',
    numeric: true
  });
  const isPlaceholder = (option) => option.value === '' || /^(choose|select)\b/i.test(option.textContent.trim());

  function sort(select) {
    if (!(select instanceof HTMLSelectElement)) return select;
    if (select.matches('#purchase-period, #itc-period')) return select;
    const selected = select.value;
    const options = Array.from(select.options);
    const placeholders = options.filter(isPlaceholder);
    const choices = options.filter((option) => !isPlaceholder(option)).sort(compare);
    const sorted = [...placeholders,...choices];
    if (options.every((option, index) => option === sorted[index])) return select;
    select.replaceChildren(...sorted);
    select.value = selected;
    return select;
  }

  function sortAll(root = document) {
    if (root instanceof HTMLSelectElement) sort(root);
    root.querySelectorAll?.('select').forEach(sort);
  }

  window.WonderNestDropdown = { sort, sortAll };
  sortAll();

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const select = mutation.target instanceof HTMLSelectElement
        ? mutation.target
        : mutation.target.closest?.('select');
      if (select) sort(select);
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType === Node.ELEMENT_NODE) sortAll(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
