(() => {
  'use strict';
  function pad(value) { return String(value).padStart(2, '0'); }
  function today() {
    const date = new Date();
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
  }
  function format(value) {
    const text = String(value ?? '').trim();
    if (!text || text.toUpperCase() === 'NA') return 'NA';
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!dmy) return text;
    return `${pad(dmy[1])}-${pad(dmy[2])}-${dmy[3]}`;
  }
  function isValid(value) {
    const text = String(value ?? '').trim();
    if (!text || text.toUpperCase() === 'NA') return true;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!iso && !dmy) return false;
    const year = Number(iso ? iso[1] : dmy[3]);
    const month = Number(iso ? iso[2] : dmy[2]);
    const day = Number(iso ? iso[3] : dmy[1]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }
  window.WonderNestDate = { today, format, isValid };
})();
