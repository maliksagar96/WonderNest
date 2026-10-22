(() => {
  const fieldSelector = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="file"]):not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[contenteditable="true"]'
  ].join(',');

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.target.closest('button,[type="submit"],[type="button"],[type="reset"],[type="file"]')) return;
    // Project updates are paragraphs; keep Enter available for inserting line breaks.
    if (event.target.closest('[data-project-note]')) return;
    const current = event.target.closest(fieldSelector);
    if (!current) return;

    // Enter always advances fields, including from a textarea, and never submits.
    event.preventDefault();
    const scope = current.closest('form') || current.closest('dialog') || document;
    const fields = [...scope.querySelectorAll(fieldSelector)].filter((field) =>
      !field.closest('[hidden]') && field.getClientRects().length > 0
    );
    const index = fields.indexOf(current);
    if (index >= 0 && index + 1 < fields.length) fields[index + 1].focus();
  }, true);
})();
