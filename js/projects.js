(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const listHeading = byId('projects-list-heading');
  const list = byId('project-list');
  const detail = byId('project-detail');
  const dialog = byId('project-dialog');
  const form = byId('project-form');
  const progressInput = byId('project-progress-input');
  const progressValue = byId('project-progress-value');
  let projects = [];
  let editingId = null;
  let selectedId = null;

  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
  const progress = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  const dateText = (value, includeTime = false) => {
    if (!value) return 'No update saved yet';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? 'No update saved yet' : new Intl.DateTimeFormat('en-IN', includeTime ? { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' } : { day:'numeric', month:'short', year:'numeric' }).format(date);
  };
  const projectUpdates = (project) => {
    if (Array.isArray(project.updates)) return project.updates;
    return project.updateNote ? [{ id:`legacy-${project.id}`, text:project.updateNote, createdAt:project.updateNoteAt || project.updatedAt || project.createdAt || '' }] : [];
  };

  function showList() {
    selectedId = null;
    listHeading.hidden = false;
    list.hidden = false;
    detail.hidden = true;
    detail.innerHTML = '';
    renderList();
  }

  function renderList() {
    const ordered = [...projects].sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    if (!ordered.length) {
      list.innerHTML = '<div class="project-list-empty"><span class="empty-mark" aria-hidden="true">✧</span><strong>No projects in the making yet</strong><p>Add your first project to start tracking its progress.</p></div>';
      return;
    }
    list.innerHTML = ordered.map((project) => {
      const percent = progress(project.progress);
      return `<button class="project-list-item" type="button" data-open-project="${safe(project.id)}"><span class="project-list-mark" aria-hidden="true">✦</span><span class="project-list-copy"><strong>${safe(project.name)}</strong><span>${safe(project.details || project.updateNote || 'Open this project to see its details and latest update.')}</span></span><span class="project-list-progress"><span class="project-list-progress-label"><span>Progress</span><strong>${percent}%</strong></span><span class="project-progress-track" aria-hidden="true"><span style="width:${percent}%"></span></span></span><span class="project-list-arrow" aria-hidden="true">↗</span></button>`;
    }).join('');
  }

  function renderDetail() {
    const project = projects.find((entry) => entry.id === selectedId);
    if (!project) { showList(); return; }
    const percent = progress(project.progress);
    listHeading.hidden = true;
    list.hidden = true;
    detail.hidden = false;
    const updates = projectUpdates(project).slice().sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const updateMarkup = updates.length ? `<ol class="project-update-timeline">${updates.map((update) => `<li class="project-update-entry"><span class="project-update-node" aria-hidden="true"></span><article class="project-update-card"><div class="project-update-meta"><strong>Project update</strong><time datetime="${safe(update.createdAt || '')}">${safe(dateText(update.createdAt,true))}</time></div><p>${safe(update.text)}</p></article></li>`).join('')}</ol>` : '<p class="project-update-empty">No updates yet. Add the first project update below.</p>';
    detail.innerHTML = `<div class="project-detail-top"><button class="project-back" type="button" data-back-to-list>← All projects</button><div class="project-detail-actions"><button class="button button-secondary button-small" type="button" data-edit-project="${safe(project.id)}">Edit details</button><button class="button button-small project-delete-button" type="button" data-delete-project="${safe(project.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 4.5h9m-8 0 .5 9h5l.5-9M6 4.5V3h4v1.5m-3 2v4m2-4v4"/></svg><span>Delete project</span></button></div></div><div class="project-detail-heading"><div><p class="eyebrow">PROJECT OVERVIEW</p><h2>${safe(project.name)}</h2>${project.details ? `<p class="project-detail-copy">${safe(project.details)}</p>` : '<p class="project-detail-copy">Add project details with the Edit details button.</p>'}</div></div><div class="project-detail-progress"><span>Current progress</span><strong>${percent}%</strong><div class="project-progress-track" role="progressbar" aria-label="${safe(project.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div></div><section class="project-note-panel"><h3>Project updates</h3><p>Share progress, decisions, or next steps. Each update is saved with its timestamp.</p>${updateMarkup}<div class="project-update-composer"><label for="project-update-input">Write an update</label><textarea id="project-update-input" data-project-note maxlength="2000" rows="4" aria-label="New project update" placeholder="What changed? Share a progress update…"></textarea><div class="project-note-actions"><span class="project-note-date">Updates are added to the project timeline.</span><button class="button button-primary" type="button" data-save-project-note="${safe(project.id)}">Add update</button></div></div></section>`;
  }

  async function load() {
    try {
      const saved = await window.WonderNestDB.get('projects');
      projects = Array.isArray(saved) ? saved : [];
      byId('projects-page-message').hidden = true;
      if (selectedId && projects.some((project) => project.id === selectedId)) renderDetail();
      else showList();
    } catch (error) {
      const message = byId('projects-page-message');
      message.textContent = `Could not load projects from the local database: ${error.message}`;
      message.hidden = false;
    }
  }

  function openForm(project = null) {
    editingId = project?.id || null;
    form.reset();
    byId('project-form-message').hidden = true;
    byId('project-dialog-title').textContent = project ? 'Edit project details' : 'Add a project';
    form.elements.name.value = project?.name || '';
    form.elements.details.value = project?.details || '';
    progressInput.value = String(progress(project?.progress));
    progressValue.value = `${progressInput.value}%`;
    byId('delete-project-button').hidden = true;
    dialog.showModal();
    form.elements.name.focus();
  }

  function closeForm() { dialog.close(); editingId = null; }

  async function saveCollection(next) {
    await window.WonderNestDB.set('projects', next);
    projects = next;
  }

  byId('today-label').textContent = new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric' }).format(new Date());
  byId('add-project-button').addEventListener('click', () => openForm());
  byId('close-project-dialog').addEventListener('click', closeForm);
  byId('cancel-project-form').addEventListener('click', closeForm);
  progressInput.addEventListener('input', () => { progressValue.value = `${progressInput.value}%`; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = byId('project-form-message'), submit = form.querySelector('[type="submit"]');
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); return; }
    const prior = projects.find((project) => project.id === editingId);
    const timestamp = new Date().toISOString();
    const record = { id:editingId || crypto.randomUUID(), name, details:form.elements.details.value.trim(), progress:progress(progressInput.value), updateNote:prior?.updateNote || '', updateNoteAt:prior?.updateNoteAt || '', createdAt:prior?.createdAt || timestamp, updatedAt:timestamp };
    const next = prior ? projects.map((project) => project.id === editingId ? record : project) : [...projects,record];
    submit.disabled = true; submit.textContent = 'Saving…'; message.hidden = true;
    try {
      await saveCollection(next);
      closeForm();
      selectedId = record.id;
      renderDetail();
    } catch (error) { message.textContent = `Could not save this project: ${error.message}`; message.hidden = false; }
    finally { submit.disabled = false; submit.textContent = 'Save project'; }
  });

  list.addEventListener('click', (event) => {
    const item = event.target.closest('[data-open-project]');
    if (!item) return;
    selectedId = item.dataset.openProject;
    renderDetail();
  });

  detail.addEventListener('click', async (event) => {
    if (event.target.closest('[data-back-to-list]')) { showList(); return; }
    const editButton = event.target.closest('[data-edit-project]');
    if (editButton) { const project = projects.find((entry) => entry.id === editButton.dataset.editProject); if (project) openForm(project); return; }
    const deleteButton = event.target.closest('[data-delete-project]');
    if (deleteButton) {
      const project = projects.find((entry) => entry.id === deleteButton.dataset.deleteProject);
      if (!project || !window.confirm(`Delete “${project.name}” and its saved updates?`)) return;
      deleteButton.disabled = true;
      try { await saveCollection(projects.filter((entry) => entry.id !== project.id)); showList(); }
      catch (error) { deleteButton.disabled = false; window.alert(`Could not delete this project: ${error.message}`); }
      return;
    }
    const saveButton = event.target.closest('[data-save-project-note]');
    if (!saveButton) return;
    const project = projects.find((entry) => entry.id === saveButton.dataset.saveProjectNote);
    const note = detail.querySelector('[data-project-note]')?.value.trim();
    if (!project || note === undefined) return;
    if (!note) { detail.querySelector('[data-project-note]')?.focus(); return; }
    const timestamp = new Date().toISOString();
    const updates = projectUpdates(project);
    const next = projects.map((entry) => entry.id === project.id ? { ...entry, updates:[...updates,{ id:crypto.randomUUID(), text:note, createdAt:timestamp }], updateNote:note, updateNoteAt:timestamp, updatedAt:timestamp } : entry);
    saveButton.disabled = true; saveButton.textContent = 'Adding…';
    try { await saveCollection(next); renderDetail(); }
    catch (error) { saveButton.disabled = false; saveButton.textContent = 'Add update'; window.alert(`Could not save the project update: ${error.message}`); }
  });

  window.WonderNestDB.subscribe(({ store }) => { if (store === 'projects') load(); });
  load();
})();
