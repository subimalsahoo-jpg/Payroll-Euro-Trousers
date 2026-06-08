'use strict';

/**
 * UI helpers: toasts, formatting, and small DOM/render utilities used
 * by the view layer. Kept dependency-free.
 */
window.UI = (function () {
  /** Escape untrusted text for safe HTML interpolation. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, type = 'ok', ms = 3200) {
    const wrap = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type === 'err' ? 'err' : 'ok'}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /** Format money with a currency code. */
  function money(amount, currency = 'AED') {
    const n = Number(amount || 0);
    return `${currency} ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return UI.esc(d);
    return date.toISOString().slice(0, 10);
  }

  /** Map a status string to a coloured badge. */
  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    let cls = 'gray';
    if (['active', 'present', 'approved', 'hr_approved', 'disbursed', 'paid', 'locked'].includes(s)) cls = 'green';
    else if (['absent', 'rejected', 'terminated', 'inactive', 'missing', 'defaulted'].includes(s)) cls = 'red';
    else if (['probation', 'pending', 'manager_reviewed', 'late', 'half_day', 'processed', 'draft', 'suspended', 'on_leave'].includes(s)) cls = 'amber';
    return `<span class="badge ${cls}">${esc(String(status || '').replace(/_/g, ' '))}</span>`;
  }

  /** Build a table from columns spec + rows. cols: [{key,label,render?}] */
  function table(cols, rows, emptyMsg = 'No records found') {
    if (!rows || !rows.length) return `<div class="card muted center">${esc(emptyMsg)}</div>`;
    const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
    const body = rows.map((r) => {
      const tds = cols.map((c) => {
        const val = c.render ? c.render(r) : esc(r[c.key]);
        return `<td>${val}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="table-wrap card" style="padding:0"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function spinner() { return '<div class="center"><div class="spinner"></div></div>'; }

  function metricCard(label, value, icon) {
    return `<div class="card metric">
      <div class="ic-badge">${icon || ''}</div>
      <div class="label">${esc(label)}</div>
      <div class="value">${value}</div>
    </div>`;
  }

  /** Initials from a name for avatars. */
  function initials(first, last) {
    return `${(first || '?')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
  }

  return { esc, toast, money, fmtDate, statusBadge, table, spinner, metricCard, initials };
})();
