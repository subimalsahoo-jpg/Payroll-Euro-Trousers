'use strict';

/**
 * View layer: one renderer per module route. Each renderer receives the
 * content container element and the current app state, fetches its data
 * from the API and paints the UI. Charts use Chart.js when available.
 */
window.VIEWS = (function () {
  const T = (k) => I18N.t(k);
  let chartRefs = [];

  function destroyCharts() {
    chartRefs.forEach((c) => { try { c.destroy(); } catch (_e) { /* noop */ } });
    chartRefs = [];
  }

  function makeChart(canvasId, config) {
    if (!window.Chart) return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    chartRefs.push(new Chart(ctx, config));
  }

  const CRIMSON = '#d6122e';
  const PALETTE = ['#d6122e', '#2b2b2b', '#f08a99', '#8a8f99', '#b50f27', '#c9ccd1', '#ef5d72'];

  /* ------------------------------ Dashboard ------------------------------ */
  async function dashboard(el) {
    el.innerHTML = UI.spinner();
    const [m, c] = await Promise.all([API.get('/dashboard/metrics'), API.get('/dashboard/charts')]);
    const d = m.data; const charts = c.data;
    destroyCharts();
    el.innerHTML = `
      <div class="grid cols-4">
        ${UI.metricCard(T('total_workforce'), d.totalWorkforce, '👥')}
        ${UI.metricCard(T('present_today'), d.presentToday, '✅')}
        ${UI.metricCard(T('absent_today'), d.absentToday, '⛔')}
        ${UI.metricCard(T('on_leave'), d.onLeave, '🌴')}
      </div>
      <div class="grid cols-3" style="margin-top:18px">
        ${UI.metricCard(T('monthly_payroll'), UI.money(d.monthlyPayroll), '💰')}
        ${UI.metricCard(T('overtime_expense'), UI.money(d.overtimeExpense), '⏱️')}
        ${UI.metricCard('Docs Expiring (30d)', Object.values(d.expirySummary).reduce((a, b) => a + Number(b), 0), '📄')}
      </div>
      <div class="grid cols-2" style="margin-top:18px">
        <div class="card"><div class="section-title">Workforce by Department</div><div class="chart-box"><canvas id="ch1"></canvas></div></div>
        <div class="card"><div class="section-title">Payroll Trend</div><div class="chart-box"><canvas id="ch2"></canvas></div></div>
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Department Cost Centers (current month)</div><div class="chart-box"><canvas id="ch3"></canvas></div></div>
    `;
    makeChart('ch1', {
      type: 'doughnut',
      data: { labels: charts.workforceByDept.map((r) => r.label), datasets: [{ data: charts.workforceByDept.map((r) => r.value), backgroundColor: PALETTE }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    makeChart('ch2', {
      type: 'line',
      data: { labels: charts.payrollTrend.map((r) => r.label), datasets: [{ label: 'Net Payroll', data: charts.payrollTrend.map((r) => Number(r.value)), borderColor: CRIMSON, backgroundColor: 'rgba(214,18,46,0.12)', fill: true, tension: 0.35 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    makeChart('ch3', {
      type: 'bar',
      data: { labels: charts.departmentCost.map((r) => r.label), datasets: [{ label: 'Net Cost', data: charts.departmentCost.map((r) => Number(r.value)), backgroundColor: CRIMSON }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  /* ------------------------------ Employees ------------------------------ */
  async function employees(el) {
    el.innerHTML = `
      <div class="toolbar">
        <input id="empSearch" class="input" style="max-width:280px" placeholder="Search name / code / email..." />
        <select id="empStatus" class="input" style="max-width:180px">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span class="spacer"></span>
        <span class="muted" id="empCount"></span>
      </div>
      <div id="empList">${UI.spinner()}</div>`;
    async function refresh() {
      const q = document.getElementById('empSearch').value;
      const status = document.getElementById('empStatus').value;
      const res = await API.get(`/employees?q=${encodeURIComponent(q)}&status=${status}&limit=100`);
      document.getElementById('empCount').textContent = `${res.meta ? res.meta.total : res.data.length} employees`;
      document.getElementById('empList').innerHTML = UI.table([
        { label: '', render: (r) => `<div class="avatar">${UI.initials(r.first_name, r.last_name)}</div>` },
        { label: 'Code', key: 'employee_code' },
        { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
        { label: 'Department', render: (r) => UI.esc(r.department_name || '-') },
        { label: 'Branch', render: (r) => UI.esc(r.branch_name || '-') },
        { label: 'Status', render: (r) => UI.statusBadge(r.employment_status) },
        { label: '', render: (r) => `<button class="btn btn-sm" data-emp="${r.id}">View</button>` },
      ], res.data);
      document.querySelectorAll('[data-emp]').forEach((b) => b.onclick = () => employeeProfile(b.getAttribute('data-emp')));
    }
    document.getElementById('empSearch').oninput = debounce(refresh, 350);
    document.getElementById('empStatus').onchange = refresh;
    refresh();
  }

  async function employeeProfile(id) {
    const res = await API.get(`/employees/${id}`);
    const p = res.data.profile;
    const docs = res.data.identityDocuments;
    const ec = res.data.emergencyContacts;
    UI_drawer(`${UI.esc(p.first_name)} ${UI.esc(p.last_name)} — ${UI.esc(p.employee_code)}`, `
      <div class="grid cols-2">
        <div><div class="muted">Designation</div><b>${UI.esc(p.designation || '-')}</b></div>
        <div><div class="muted">Department</div><b>${UI.esc(p.department_name || '-')}</b></div>
        <div><div class="muted">Status</div>${UI.statusBadge(p.employment_status)}</div>
        <div><div class="muted">Joined</div><b>${UI.fmtDate(p.date_of_joining)}</b></div>
        <div><div class="muted">Email</div><b>${UI.esc(p.work_email || '-')}</b></div>
        <div><div class="muted">Mobile</div><b>${UI.esc(p.mobile || '-')}</b></div>
        <div><div class="muted">IBAN</div><b>${UI.esc(p.iban || '-')}</b></div>
        <div><div class="muted">Nationality</div><b>${UI.esc(p.nationality || '-')}</b></div>
      </div>
      <div class="section-title" style="margin-top:18px">Identity Documents (masked)</div>
      ${UI.table([
        { label: 'Type', render: (r) => UI.esc(r.doc_type.replace(/_/g, ' ')) },
        { label: 'Reference', render: (r) => `<code>${UI.esc(r.reference_masked || '-')}</code>` },
        { label: 'Expiry', render: (r) => UI.fmtDate(r.expiry_date) },
        { label: 'Detail', render: (r) => UI.esc(r.visa_type || r.contract_type || r.issuing_country || '-') },
      ], docs, 'No identity documents')}
      <div class="section-title" style="margin-top:18px">Emergency Contacts</div>
      ${UI.table([
        { label: 'Name', key: 'contact_name' },
        { label: 'Relationship', key: 'relationship' },
        { label: 'Phone', key: 'phone' },
      ], ec, 'No emergency contacts')}
    `);
  }

  /* ------------------------------ Attendance ----------------------------- */
  async function attendance(el) {
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = `
      <div class="toolbar">
        <input id="attDate" type="date" class="input" style="max-width:200px" value="${today}" />
        <button class="btn" id="attAlerts">⚠️ Missing Alerts</button>
        <span class="spacer"></span>
      </div>
      <div id="attGrid">${UI.spinner()}</div>`;
    async function refresh() {
      const date = document.getElementById('attDate').value || today;
      const res = await API.get(`/attendance?date=${date}`);
      document.getElementById('attGrid').innerHTML = UI.table([
        { label: 'Code', key: 'employee_code' },
        { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
        { label: 'Shift', render: (r) => UI.esc(r.shift_name || '-') },
        { label: 'In', render: (r) => r.check_in ? new Date(r.check_in).toTimeString().slice(0, 5) : '-' },
        { label: 'Out', render: (r) => r.check_out ? new Date(r.check_out).toTimeString().slice(0, 5) : '-' },
        { label: 'Late (m)', render: (r) => r.late_minutes || 0 },
        { label: 'OT (m)', render: (r) => r.overtime_minutes || 0 },
        { label: 'Status', render: (r) => UI.statusBadge(r.status || 'absent') },
      ], res.data);
    }
    document.getElementById('attDate').onchange = refresh;
    document.getElementById('attAlerts').onclick = async () => {
      const res = await API.get('/attendance/alerts');
      UI_drawer('Missing Attendance Alerts', UI.table([
        { label: 'Code', key: 'employee_code' },
        { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
        { label: 'Status', render: (r) => UI.statusBadge(r.status || 'missing') },
      ], res.data, 'No missing punches 🎉'));
    };
    refresh();
  }

  /* -------------------------------- Leave -------------------------------- */
  async function leave(el) {
    el.innerHTML = `
      <div class="toolbar">
        <select id="leaveStatus" class="input" style="max-width:200px">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="manager_reviewed">Manager Reviewed</option>
          <option value="hr_approved">HR Approved</option>
          <option value="disbursed">Disbursed</option>
          <option value="rejected">Rejected</option>
        </select>
        <span class="spacer"></span>
      </div>
      <div id="leaveList">${UI.spinner()}</div>`;
    async function refresh() {
      const status = document.getElementById('leaveStatus').value;
      const res = await API.get(`/leave/applications?status=${status}`);
      const canApprove = APP.can('leave.approve');
      document.getElementById('leaveList').innerHTML = UI.table([
        { label: 'Employee', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
        { label: 'Type', key: 'leave_type' },
        { label: 'From', render: (r) => UI.fmtDate(r.start_date) },
        { label: 'To', render: (r) => UI.fmtDate(r.end_date) },
        { label: 'Days', key: 'total_days' },
        { label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { label: '', render: (r) => canApprove ? workflowButtons(r) : '' },
      ], res.data);
      bindWorkflow(refresh);
    }
    document.getElementById('leaveStatus').onchange = refresh;
    refresh();
  }

  function workflowButtons(r) {
    const map = { pending: ['manager_review', 'Review'], manager_reviewed: ['hr_approve', 'Approve'], hr_approved: ['disburse', 'Disburse'] };
    const next = map[r.status];
    let html = '';
    if (next) html += `<button class="btn btn-sm btn-primary" data-wf="${r.id}" data-action="${next[0]}">${next[1]}</button> `;
    if (!['rejected', 'disbursed', 'cancelled'].includes(r.status)) html += `<button class="btn btn-sm" data-wf="${r.id}" data-action="reject">Reject</button>`;
    return html;
  }

  function bindWorkflow(refresh) {
    document.querySelectorAll('[data-wf]').forEach((b) => {
      b.onclick = async () => {
        const id = b.getAttribute('data-wf'); const action = b.getAttribute('data-action');
        let note = null;
        if (action === 'reject') { note = prompt('Rejection reason?') || 'Rejected'; }
        try {
          await API.post(`/leave/applications/${id}/transition`, { action, note });
          UI.toast('Workflow updated');
          refresh();
        } catch (e) { UI.toast(e.message, 'err'); }
      };
    });
  }

  /* ------------------------------- Payroll ------------------------------- */
  async function payroll(el) {
    el.innerHTML = `
      <div class="card">
        <div class="section-title">⏱️ Overtime Calculator</div>
        <div class="grid cols-4">
          <div class="field"><label>Basic Salary</label><input id="otBasic" class="input" type="number" value="5000" /></div>
          <div class="field"><label>Normal OT hrs</label><input id="otNormal" class="input" type="number" value="10" /></div>
          <div class="field"><label>Sunday OT hrs</label><input id="otSunday" class="input" type="number" value="4" /></div>
          <div class="field"><label>Holiday OT hrs</label><input id="otHoliday" class="input" type="number" value="0" /></div>
        </div>
        <button class="btn btn-primary" id="otCalc">Calculate</button>
        <div id="otResult" class="muted" style="margin-top:12px"></div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="section-title">Loans</div>
        <div id="loanList">${UI.spinner()}</div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="section-title">Salary Advances</div>
        <div id="advList">${UI.spinner()}</div>
      </div>`;
    document.getElementById('otCalc').onclick = async () => {
      const basic = document.getElementById('otBasic').value;
      const normal = document.getElementById('otNormal').value;
      const sunday = document.getElementById('otSunday').value;
      const holiday = document.getElementById('otHoliday').value;
      const res = await API.get(`/payroll/overtime-preview?basic=${basic}&normal=${normal}&sunday=${sunday}&holiday=${holiday}`);
      const d = res.data;
      document.getElementById('otResult').innerHTML =
        `Hourly: <b>${UI.money(d.hourlyRate)}</b> | Normal: <b>${UI.money(d.normal)}</b> | Sunday: <b>${UI.money(d.sunday)}</b> | Holiday: <b>${UI.money(d.holiday)}</b> | <span style="color:var(--crimson)">Total OT: <b>${d.formatted}</b></span>`;
    };
    const loans = await API.get('/payroll/loans');
    document.getElementById('loanList').innerHTML = UI.table([
      { label: 'Employee', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
      { label: 'Principal', render: (r) => UI.money(r.principal_amount) },
      { label: 'Installment', render: (r) => UI.money(r.monthly_installment) },
      { label: 'Outstanding', render: (r) => UI.money(r.outstanding_amount) },
      { label: 'Status', render: (r) => UI.statusBadge(r.status) },
    ], loans.data, 'No loans');
    const adv = await API.get('/payroll/advances');
    document.getElementById('advList').innerHTML = UI.table([
      { label: 'Employee', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
      { label: 'Amount', render: (r) => UI.money(r.amount) },
      { label: 'Recovered', render: (r) => UI.money(r.recovered_amount) },
      { label: 'Status', render: (r) => UI.statusBadge(r.status) },
    ], adv.data, 'No advances');
  }

  /* -------------------------- Salary Processing -------------------------- */
  async function salary(el) {
    const now = new Date();
    el.innerHTML = `
      <div class="card">
        <div class="section-title">Run Monthly Payroll</div>
        <div class="row">
          <input id="payYear" class="input" type="number" style="max-width:120px" value="${now.getFullYear()}" />
          <input id="payMonth" class="input" type="number" min="1" max="12" style="max-width:100px" value="${now.getMonth() + 1}" />
          <button class="btn btn-primary" id="runPay">Process Payroll (Bulk)</button>
        </div>
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Payroll Runs</div><div id="runList">${UI.spinner()}</div></div>`;
    document.getElementById('runPay').onclick = async () => {
      try {
        const year = +document.getElementById('payYear').value;
        const month = +document.getElementById('payMonth').value;
        const res = await API.post('/salary/process', { year, month });
        UI.toast(`Processed ${res.data.processed} employees`);
        loadRuns();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    async function loadRuns() {
      const res = await API.get('/salary/runs');
      document.getElementById('runList').innerHTML = UI.table([
        { label: 'Period', render: (r) => `${r.period_year}-${String(r.period_month).padStart(2, '0')}` },
        { label: 'Branch', render: (r) => UI.esc(r.branch_name || 'All') },
        { label: 'Employees', key: 'employee_count' },
        { label: 'Net Total', render: (r) => UI.money(r.total_net) },
        { label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { label: '', render: (r) => runActions(r) },
      ], res.data);
      document.querySelectorAll('[data-reg]').forEach((b) => b.onclick = () => salaryRegister(b.getAttribute('data-reg')));
      document.querySelectorAll('[data-run-action]').forEach((b) => b.onclick = async () => {
        try { await API.post(`/salary/runs/${b.dataset.id}/${b.dataset.runAction}`); UI.toast('Done'); loadRuns(); }
        catch (e) { UI.toast(e.message, 'err'); }
      });
    }
    function runActions(r) {
      let h = `<button class="btn btn-sm" data-reg="${r.id}">Register</button> `;
      if (r.status === 'processed' && APP.can('payroll.process')) h += `<button class="btn btn-sm btn-primary" data-run-action="approve" data-id="${r.id}">Approve</button> `;
      if (['processed', 'approved'].includes(r.status) && APP.can('payroll.lock')) h += `<button class="btn btn-sm" data-run-action="lock" data-id="${r.id}">🔒 Lock</button> `;
      if (APP.can('finance.export')) h += `<button class="btn btn-sm" onclick="VIEWS.dl('/finance/bank-transfer/${r.id}.csv','bank_${r.id}.csv')">Bank CSV</button> <button class="btn btn-sm" onclick="VIEWS.dl('/compliance/wps/${r.id}.sif','wps_${r.id}.sif')">WPS .sif</button>`;
      return h;
    }
    loadRuns();
  }

  async function salaryRegister(id) {
    const res = await API.get(`/salary/runs/${id}/register`);
    UI_drawer(`Salary Register — Run #${id}`, UI.table([
      { label: 'Code', key: 'employee_code' },
      { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
      { label: 'Gross', render: (r) => UI.money(r.gross_salary) },
      { label: 'Deductions', render: (r) => UI.money(r.total_deductions) },
      { label: 'Net', render: (r) => UI.money(r.net_salary) },
    ], res.data.register));
  }

  /* ------------------------------ Payslips ------------------------------- */
  async function payslips(el) {
    el.innerHTML = `<div id="slipList">${UI.spinner()}</div>`;
    const res = await API.get('/payslips');
    document.getElementById('slipList').innerHTML = UI.table([
      { label: 'Period', render: (r) => `${r.period_year}-${String(r.period_month).padStart(2, '0')}` },
      { label: 'Code', key: 'employee_code' },
      { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
      { label: 'Net', render: (r) => UI.money(r.net_salary, r.currency) },
      { label: 'Acknowledged', render: (r) => r.employee_ack_at ? UI.statusBadge('approved') : UI.statusBadge('pending') },
      { label: '', render: (r) => `<button class="btn btn-sm btn-primary" onclick="VIEWS.dl('/payslips/${r.id}/download','payslip_${r.employee_code}.pdf')">PDF</button>` },
    ], res.data, 'No payslips yet — process payroll first');
  }

  /* ------------------------------- Finance ------------------------------- */
  async function finance(el) {
    el.innerHTML = UI.spinner();
    const [sum, dept, ot, adv] = await Promise.all([
      API.get('/finance/payroll-summary'), API.get('/finance/department-cost'),
      API.get('/finance/overtime-cost'), API.get('/finance/outstanding-advances'),
    ]);
    el.innerHTML = `
      <div class="grid cols-4">
        ${UI.metricCard('Gross', UI.money(sum.data.gross), '📊')}
        ${UI.metricCard('Deductions', UI.money(sum.data.deductions), '➖')}
        ${UI.metricCard('Net Payroll', UI.money(sum.data.net), '💵')}
        ${UI.metricCard('Outstanding Advances', UI.money(adv.meta.totalOutstanding), '🧾')}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Department Cost Centers</div>
        ${UI.table([
          { label: 'Department', key: 'department' },
          { label: 'Cost Center', key: 'cost_center' },
          { label: 'Headcount', key: 'headcount' },
          { label: 'Net', render: (r) => UI.money(r.net) },
        ], dept.data)}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Overtime Cost</div>
        ${UI.table([
          { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
          { label: 'OT Hours', key: 'overtime_hours' },
          { label: 'OT Cost', render: (r) => UI.money(r.overtime_cost) },
        ], ot.data, 'No overtime recorded')}
      </div>`;
  }

  /* ------------------------------ Compliance ----------------------------- */
  async function compliance(el) {
    el.innerHTML = UI.spinner();
    const [exp, mol] = await Promise.all([API.get('/compliance/expiries?days=60'), API.get('/compliance/mol-validation')]);
    const s = exp.data.summary;
    el.innerHTML = `
      <div class="grid cols-4">
        ${UI.metricCard('Visa Expiring', s.visa || 0, '🛂')}
        ${UI.metricCard('Emirates ID', s.emirates_id || 0, '🪪')}
        ${UI.metricCard('Passport', s.passport || 0, '📘')}
        ${UI.metricCard('Contract', s.contract || 0, '📜')}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">⚠️ Upcoming Document Expiries (60 days)</div>
        ${UI.table([
          { label: 'Code', key: 'employee_code' },
          { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
          { label: 'Document', render: (r) => UI.esc(r.doc_type.replace(/_/g, ' ')) },
          { label: 'Expiry', render: (r) => UI.fmtDate(r.expiry_date) },
          { label: 'Days Left', render: (r) => `<span class="badge ${r.days_left < 14 ? 'red' : 'amber'}">${r.days_left}</span>` },
        ], exp.data.items, 'No upcoming expiries')}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">MOL / MOHRE Validation Issues</div>
        ${UI.table([
          { label: 'Code', key: 'employee_code' },
          { label: 'Name', render: (r) => `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` },
          { label: 'Missing Labour Card', render: (r) => r.missing_labour_card ? UI.statusBadge('rejected') : UI.statusBadge('approved') },
          { label: 'Missing IBAN', render: (r) => r.missing_iban ? UI.statusBadge('rejected') : UI.statusBadge('approved') },
          { label: 'Expired Visa', render: (r) => r.expired_visa > 0 ? UI.statusBadge('rejected') : '—' },
        ], mol.data, 'All employees compliant ✅')}
      </div>`;
  }

  /* ------------------------------ Documents ------------------------------ */
  async function documents(el) {
    el.innerHTML = `
      <div class="card">
        <div class="section-title">Upload Document</div>
        <div class="row">
          <input id="docFile" type="file" class="input" style="max-width:300px" />
          <select id="docCat" class="input" style="max-width:200px">
            <option value="passport_copy">Passport Copy</option>
            <option value="visa_page">Visa Page</option>
            <option value="emirates_id_scan">Emirates ID Scan</option>
            <option value="contract">Contract</option>
            <option value="certificate">Certificate</option>
            <option value="other">Other</option>
          </select>
          <input id="docEmp" class="input" type="number" placeholder="Employee ID" style="max-width:140px" />
          <button class="btn btn-primary" id="docUpload">Upload</button>
        </div>
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Repository</div><div id="docList">${UI.spinner()}</div></div>`;
    document.getElementById('docUpload').onclick = async () => {
      const f = document.getElementById('docFile').files[0];
      if (!f) return UI.toast('Choose a file', 'err');
      const fd = new FormData();
      fd.append('file', f);
      fd.append('category', document.getElementById('docCat').value);
      if (document.getElementById('docEmp').value) fd.append('employee_id', document.getElementById('docEmp').value);
      try { await API.post('/documents', fd); UI.toast('Uploaded'); loadDocs(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
    async function loadDocs() {
      const res = await API.get('/documents');
      document.getElementById('docList').innerHTML = UI.table([
        { label: 'File', key: 'original_name' },
        { label: 'Category', render: (r) => UI.esc(r.category.replace(/_/g, ' ')) },
        { label: 'Employee', render: (r) => r.employee_code ? `${UI.esc(r.first_name)} ${UI.esc(r.last_name)}` : '-' },
        { label: 'Size', render: (r) => `${(r.size_bytes / 1024).toFixed(0)} KB` },
        { label: '', render: (r) => `<button class="btn btn-sm btn-primary" onclick="VIEWS.dl('/documents/${r.uuid}/download','${UI.esc(r.original_name)}')">Download</button>` },
      ], res.data, 'No documents');
    }
    loadDocs();
  }

  /* ------------------------------- Admin --------------------------------- */
  async function admin(el) {
    el.innerHTML = UI.spinner();
    const [users, roles, logs] = await Promise.all([
      API.get('/admin/users').catch(() => ({ data: [] })),
      API.get('/admin/roles').catch(() => ({ data: [] })),
      API.get('/admin/logs/audit?limit=25').catch(() => ({ data: [] })),
    ]);
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn" id="backupBtn">💾 Run Backup</button>
        <span class="spacer"></span>
      </div>
      <div class="card"><div class="section-title">Users (${users.data.length})</div>
        ${UI.table([
          { label: 'Username', key: 'username' },
          { label: 'Name', key: 'full_name' },
          { label: 'Role', key: 'role_name' },
          { label: 'Active', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('inactive') },
          { label: 'Last Login', render: (r) => UI.fmtDate(r.last_login_at) },
        ], users.data)}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Roles</div>
        ${UI.table([{ label: 'Role', key: 'name' }, { label: 'Description', key: 'description' }], roles.data)}
      </div>
      <div class="card" style="margin-top:18px"><div class="section-title">Audit Trail (latest)</div>
        ${UI.table([
          { label: 'When', render: (r) => UI.fmtDate(r.created_at) },
          { label: 'Actor', render: (r) => UI.esc(r.actor_username || 'system') },
          { label: 'Action', key: 'action' },
          { label: 'Entity', render: (r) => `${UI.esc(r.entity_type)} ${UI.esc(r.entity_id || '')}` },
        ], logs.data)}
      </div>`;
    document.getElementById('backupBtn').onclick = async () => {
      try { const r = await API.post('/admin/backup', {}); UI.toast(`Backup: ${r.data.file}`); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  /* --------------------------- Self Service ------------------------------ */
  async function ess(el) {
    el.innerHTML = UI.spinner();
    try {
      const res = await API.get('/ess/dashboard');
      const d = res.data;
      el.innerHTML = `
        <div class="grid cols-3">
          ${UI.metricCard('Present (this month)', d.attendanceThisMonth.present_days || 0, '✅')}
          ${UI.metricCard('Overtime hrs', Number(d.attendanceThisMonth.overtime_hours || 0).toFixed(1), '⏱️')}
          ${UI.metricCard('Open Leave Requests', d.openLeaveCount, '📨')}
        </div>
        <div class="card" style="margin-top:18px"><div class="section-title">Leave Balances</div>
          ${UI.table([{ label: 'Type', key: 'name' }, { label: 'Available', render: (r) => `<b>${Number(r.available).toFixed(1)}</b> days` }], d.leaveBalances)}
        </div>
        <div class="card" style="margin-top:18px"><div class="section-title">Latest Payslip</div>
          ${d.latestSlip ? `<div class="row"><b>${d.latestSlip.period_year}-${String(d.latestSlip.period_month).padStart(2, '0')}</b> — ${UI.money(d.latestSlip.net_salary, d.latestSlip.currency)}
            <button class="btn btn-sm btn-primary" onclick="VIEWS.dl('/payslips/${d.latestSlip.id}/download','payslip.pdf')">Download</button></div>` : '<div class="muted">No payslip yet</div>'}
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="card muted center">${UI.esc(e.message)}</div>`;
    }
  }

  /* ----------------------------- Notifications --------------------------- */
  async function notifications(el) {
    el.innerHTML = UI.spinner();
    const res = await API.get('/notifications');
    el.innerHTML = `<div class="card"><div class="section-title">Notifications (${res.meta ? res.meta.unread : 0} unread)</div>
      ${UI.table([
        { label: 'When', render: (r) => UI.fmtDate(r.created_at) },
        { label: 'Type', render: (r) => UI.statusBadge(r.type) },
        { label: 'Title', key: 'title' },
        { label: 'Message', render: (r) => UI.esc(r.message || '') },
      ], res.data, 'No notifications')}</div>`;
  }

  /* ------------------------------ helpers -------------------------------- */
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // Lightweight slide-over drawer used for detail panels.
  function UI_drawer(title, html) {
    let d = document.getElementById('drawer');
    if (d) d.remove();
    d = document.createElement('div');
    d.id = 'drawer';
    d.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;justify-content:flex-end;background:rgba(0,0,0,.35)';
    d.innerHTML = `<div class="glass" style="width:min(640px,100%);height:100%;overflow:auto;padding:24px;border-radius:0">
      <div class="row" style="justify-content:space-between"><h2>${title}</h2><button class="icon-btn" id="drawerClose">✕</button></div>
      <div style="margin-top:18px">${html}</div></div>`;
    document.body.appendChild(d);
    d.onclick = (e) => { if (e.target === d) d.remove(); };
    document.getElementById('drawerClose').onclick = () => d.remove();
  }

  // Expose a download proxy for inline onclick handlers.
  function dl(path, name) { API.download(path, name).catch((e) => UI.toast(e.message, 'err')); }

  return {
    dashboard, employees, attendance, leave, payroll, salary, payslips,
    finance, compliance, documents, admin, ess, notifications, dl, destroyCharts,
  };
})();
