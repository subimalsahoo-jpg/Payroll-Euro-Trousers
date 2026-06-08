'use strict';

/**
 * SPA controller: authentication state, app shell, hash router,
 * RBAC-aware navigation, theme (dark mode) and language switching.
 */
window.APP = (function () {
  let user = null;
  const THEME_KEY = 'dm.theme';

  // Route table: route -> { view, label key, icon, permission(s) }
  const ROUTES = {
    dashboard:    { view: 'dashboard',     label: 'dashboard',          icon: '📊' },
    ess:          { view: 'ess',           label: 'self_service',       icon: '🙋' },
    employees:    { view: 'employees',     label: 'employees',          icon: '👥', perm: 'employee.read' },
    attendance:   { view: 'attendance',    label: 'attendance',         icon: '🕒', perm: 'attendance.read' },
    leave:        { view: 'leave',         label: 'leave',              icon: '🌴', perm: 'leave.read' },
    payroll:      { view: 'payroll',       label: 'payroll',            icon: '💰', perm: 'payroll.read' },
    salary:       { view: 'salary',        label: 'salary_processing',  icon: '⚙️', perm: 'payroll.read' },
    payslips:     { view: 'payslips',      label: 'salary_slips',       icon: '🧾', perm: 'payslip.read' },
    finance:      { view: 'finance',       label: 'finance',            icon: '📈', perm: 'finance.read' },
    compliance:   { view: 'compliance',    label: 'compliance',         icon: '🛡️', perm: 'compliance.read' },
    documents:    { view: 'documents',     label: 'documents',          icon: '📁', perm: 'document.read' },
    notifications:{ view: 'notifications', label: 'notifications',      icon: '🔔', perm: 'notification.read' },
    admin:        { view: 'admin',         label: 'administration',     icon: '🛠️', perm: 'admin.manage' },
  };

  function can(perm) {
    if (!user) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    if (!perm) return true;
    return (user.permissions || []).includes(perm);
  }

  function visibleRoutes() {
    return Object.entries(ROUTES).filter(([key, r]) => {
      if (key === 'dashboard') return true;
      if (key === 'ess') return !!user.employeeId;
      return !r.perm || can(r.perm);
    });
  }

  /* ------------------------------ Theme ---------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }
  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  /* ------------------------------ Login ---------------------------------- */
  function renderLogin(message) {
    document.getElementById('app').innerHTML = `
      <div class="auth-wrap">
        <form class="glass auth-card" id="loginForm">
          <div class="brand">
            <div class="logo">ET</div>
            <div><h1>Euro-Trousers HRMS & Payroll</h1><small>Euro-Trousers · UAE</small></div>
          </div>
          <p class="muted" style="margin:8px 0 20px">Sign in to your account</p>
          ${message ? `<div class="badge red" style="display:block;margin-bottom:14px;padding:10px">${UI.esc(message)}</div>` : ''}
          <div class="field"><label>Username</label><input class="input" id="username" autocomplete="username" value="superadmin" /></div>
          <div class="field"><label>Password</label><input class="input" id="password" type="password" autocomplete="current-password" value="Admin@123" /></div>
          <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Sign In</button>
          <p class="muted" style="margin-top:16px;font-size:12px">Demo: superadmin / hr.manager / payroll / arun.kumar — password <b>Admin@123</b></p>
        </form>
      </div>`;
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      try {
        await API.bootstrapCsrf();
        const res = await API.post('/auth/login', { username, password });
        API.setToken(res.data.token);
        if (res.data.csrfToken) API.setCsrf(res.data.csrfToken);
        user = res.data.user;
        await I18N.load();
        renderShell();
        navigate(location.hash || '#/dashboard');
        UI.toast(`${I18N.t('welcome')}, ${user.fullName}`);
      } catch (err) {
        renderLogin(err.message || 'Login failed');
      }
    };
  }

  /* ------------------------------ Shell ---------------------------------- */
  function renderShell() {
    const navItems = visibleRoutes().map(([key, r]) =>
      `<a class="nav-item" href="#/${key}" data-route="${key}"><span class="ic">${r.icon}</span><span>${I18N.t(r.label)}</span></a>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="shell">
        <aside class="sidebar glass" id="sidebar">
          <div class="brand"><div class="logo">ET</div><div><h1 style="font-size:15px">Euro-Trousers</h1><small>HRMS & Payroll</small></div></div>
          <div class="nav-section">Menu</div>
          ${navItems}
        </aside>
        <div class="main">
          <header class="topbar glass">
            <button class="icon-btn menu-toggle" id="menuToggle">☰</button>
            <h2 id="pageTitle">${I18N.t('dashboard')}</h2>
            <span class="spacer"></span>
            <select id="langSel" class="input" style="max-width:120px">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
            <button class="icon-btn" id="themeBtn" title="Toggle theme">🌓</button>
            <div class="row">
              <div class="avatar" title="${UI.esc(user.fullName)}">${UI.initials(user.fullName.split(' ')[0], user.fullName.split(' ')[1] || '')}</div>
              <button class="btn btn-sm btn-ghost" id="logoutBtn">${I18N.t('logout')}</button>
            </div>
          </header>
          <main class="content" id="content"></main>
        </div>
      </div>`;

    document.getElementById('themeBtn').onclick = toggleTheme;
    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
    const lang = document.getElementById('langSel');
    lang.value = I18N.current();
    lang.onchange = async () => { await I18N.load(lang.value); renderShell(); navigate(location.hash); };
  }

  /* ------------------------------ Router --------------------------------- */
  async function navigate(hash) {
    const key = (hash || '#/dashboard').replace('#/', '') || 'dashboard';
    const route = ROUTES[key] || ROUTES.dashboard;

    // Permission gate.
    if (key !== 'dashboard' && key !== 'ess' && route.perm && !can(route.perm)) {
      document.getElementById('content').innerHTML = '<div class="card center muted">You do not have access to this module.</div>';
      return;
    }
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === key));
    const title = document.getElementById('pageTitle');
    if (title) title.textContent = I18N.t(route.label);
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = UI.spinner();
    if (window.VIEWS && VIEWS.destroyCharts) VIEWS.destroyCharts();
    document.getElementById('sidebar').classList.remove('open');
    try {
      const wrap = document.createElement('div');
      wrap.className = 'view';
      content.innerHTML = '';
      content.appendChild(wrap);
      await VIEWS[route.view](wrap, user);
    } catch (err) {
      content.innerHTML = `<div class="card center" style="color:var(--crimson)">${UI.esc(err.message)}</div>`;
    }
  }

  async function logout() {
    try { await API.post('/auth/logout', {}); } catch (_e) { /* ignore */ }
    API.setToken(null); API.setCsrf(null);
    user = null;
    location.hash = '';
    renderLogin();
  }

  /* ------------------------------ Boot ----------------------------------- */
  async function boot() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    await I18N.load();
    // Try to resume an existing session via stored token / cookie.
    try {
      const res = await API.get('/auth/me');
      user = res.data;
      await API.bootstrapCsrf();
      renderShell();
      navigate(location.hash || '#/dashboard');
    } catch (_e) {
      renderLogin();
    }
    window.addEventListener('hashchange', () => { if (user) navigate(location.hash); });
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { can, navigate, logout };
})();
