(() => {
  'use strict';
  const button = document.getElementById('run-issue-scan');
  const status = document.getElementById('issues-status');
  const results = document.getElementById('issues-results');
  const meta = document.getElementById('issues-meta');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

  async function scan() {
    button.disabled = true;
    button.textContent = 'Checking…';
    status.removeAttribute('data-state');
    status.innerHTML = '<span class="issues-spinner" aria-hidden="true"></span><div><strong>Checking WonderNest…</strong><p>Running a database health check.</p></div>';
    results.replaceChildren();
    meta.textContent = '';
    try {
      const response = await fetch('/api/issues', {cache:'no-store'});
      const report = await response.json();
      if (!response.ok) throw new Error(report.error || 'The diagnostic check could not finish.');
      const found = (report.issues || []).filter((issue) => issue.severity !== 'success');
      status.dataset.state = report.ok ? 'ok' : 'error';
      status.innerHTML = `<span class="issues-mark" aria-hidden="true">${report.ok ? '✓' : '!'}</span><div><strong>${report.ok ? 'No issues detected' : `${found.length} ${found.length === 1 ? 'issue' : 'issues'} found`}</strong><p>${report.ok ? 'Your database and saved records passed the available checks.' : 'Review the findings below.'}</p></div>`;
      for (const issue of report.issues || []) {
        const row = document.createElement('li');
        if (issue.severity === 'success') row.className = 'success';
        row.innerHTML = `<strong>${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.detail)}</p>`;
        results.append(row);
      }
      meta.textContent = `${Number(report.checks) || 0} checks completed${report.checkedAt ? ` · ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(report.checkedAt))}` : ''}`;
    } catch (error) {
      status.dataset.state = 'error';
      status.innerHTML = `<span class="issues-mark" aria-hidden="true">!</span><div><strong>Could not complete the check</strong><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Run check again';
    }
  }
  button.addEventListener('click', scan);
  scan();
})();
