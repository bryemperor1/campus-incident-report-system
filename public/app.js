const API = {
  login: '/api/login',
  logout: '/api/logout',
  signup: '/api/signup',
  signupVerify: '/api/signup/verify',
  forgotRequest: '/api/password/forgot/request',
  forgotReset: '/api/password/forgot/reset',
  me: '/api/me',
  reports: '/api/reports',
  users: '/api/users',
  stats: '/api/stats',
  logs: '/api/activity-logs',
  support: '/api/support',
  notifications: '/api/notifications'
};

let currentUser = null;
let reportsCache = [];
let usersCache = [];
let logsCache = [];
let supportCache = [];
let notificationsCache = [];
let chartInstance = null;
let activeTab = 'dashboard';
let currentLoginRole = 'student';

// ---------------- Utilities ----------------

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    console[type === 'danger' ? 'error' : 'log'](message);
    return;
  }

  const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const icon =
    type === 'success'
      ? 'bi-check-circle-fill'
      : type === 'danger'
      ? 'bi-exclamation-triangle-fill'
      : 'bi-info-circle-fill';

  container.insertAdjacentHTML(
    'beforeend',
    `
      <div id="${toastId}" class="toast align-items-center text-bg-${type} border-0 shadow-lg fade show mb-2 rounded-4" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex p-1">
          <div class="toast-body fw-medium fs-6 d-flex align-items-center gap-2">
            <i class="bi ${icon}"></i> ${escapeHtml(message)}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" aria-label="Close" onclick="document.getElementById('${toastId}')?.remove()"></button>
        </div>
      </div>
    `
  );

  setTimeout(() => {
    const el = document.getElementById(toastId);
    if (!el) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  if (btn) btn.textContent = isPassword ? 'Hide' : 'Show';
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    let msg = 'Request failed';
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusClass(status) {
  const key = String(status || '').toLowerCase().replace(/\s+/g, '-');
  return `status-${key}`;
}

function sevClass(sev) {
  return `sev-${String(sev || '').toLowerCase()}`;
}

function toLocalDatetimeValue(date = new Date()) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function setCurrentReportDateTime() {
  const input = document.getElementById('reportDateTime');
  if (input) input.value = toLocalDatetimeValue();
}


function getLoginRoleFromPath() {
  return 'student';
}

function syncLoginUrl() {
  if (window.location.pathname !== '/login') {
    history.replaceState({}, '', '/login');
  }
}

function switchLoginRole(role = 'student') {
  currentLoginRole = role || 'student';

  const title = document.getElementById('loginRoleTitle');
  const subtitle = document.getElementById('loginRoleSubtitle');
  const usernameLabel = document.getElementById('loginUsernameLabel');
  const helpText = document.getElementById('loginHelpText');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const signupBtn = document.getElementById('studentSignupBtn');
  const username = document.getElementById('username');
  const hint = document.getElementById('loginHint');

  syncLoginUrl();

  if (title) title.innerText = 'Sign In';
  if (subtitle) subtitle.innerText = 'Use your account to access the portal';
  if (usernameLabel) usernameLabel.innerText = 'Username';
  if (helpText) helpText.innerText = 'Need help logging in? Contact Administration:';
  if (submitBtn) submitBtn.innerHTML = 'Sign In <i class="bi bi-arrow-right ms-2"></i>';
  if (signupBtn) {
    signupBtn.classList.remove('d-none');
    signupBtn.innerHTML = 'Create Account <i class="bi bi-person-plus ms-2"></i>';
  }
  if (username) username.placeholder = 'Enter your username';
  if (hint) {
    hint.classList.add('d-none');
    hint.textContent = '';
  }
}

// ---------------- View Management ----------------

function showSignedOutView() {
  document.getElementById('publicView')?.classList.remove('d-none');
  document.getElementById('adminPage')?.classList.add('d-none');
  document.getElementById('loginSection')?.classList.remove('d-none');
  document.getElementById('studentPortal')?.classList.add('d-none');

  switchLoginRole();
  setCurrentReportDateTime();

  const reportedBy = document.getElementById('reportedByDisplay');
  if (reportedBy) reportedBy.value = '';
  const username = document.getElementById('username');
  if (username) username.value = '';
  const password = document.getElementById('password');
  if (password) password.value = '';
}

function showSignedInView() {
  document.getElementById('loginSection')?.classList.add('d-none');
  document.getElementById('publicView')?.classList.remove('d-none');

  if (!currentUser) return;

  const isStudent = currentUser.role === 'student';
  const isStaff = currentUser.role === 'staff';

  if (!isStudent) {
    document.getElementById('studentPortal')?.classList.add('d-none');
    document.getElementById('adminPage')?.classList.remove('d-none');

    const adminDisplay = document.getElementById('adminDisplayName');
    if (adminDisplay) adminDisplay.innerText = currentUser.displayName;

    const usersNav = document.getElementById('nav-users');
    if (usersNav) usersNav.classList.toggle('d-none', isStaff);

    const usersView = document.getElementById('adminUsersView');
    if (usersView) usersView.classList.toggle('d-none', isStaff);

    const shortcut = document.getElementById('adminUsersShortcut');
    if (shortcut) shortcut.classList.toggle('d-none', isStaff);
  } else {
    document.getElementById('adminPage')?.classList.add('d-none');
    document.getElementById('studentPortal')?.classList.remove('d-none');

    const studentName = document.getElementById('studentNameDisplay');
    if (studentName) studentName.innerText = currentUser.displayName;

    const reportedBy = document.getElementById('reportedByDisplay');
    if (reportedBy) reportedBy.value = currentUser.displayName;

    setCurrentReportDateTime();
  }
}

function switchAdminTab(tab) {
  activeTab = tab;
  const views = {
    dashboard: 'adminDashboardView',
    incidents: 'adminIncidentsView',
    users: 'adminUsersView',
    support: 'adminSupportView',
    activity: 'adminActivityView',
    notifications: 'adminNotificationsView'
  };

  Object.values(views).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('d-none');
  });

  const viewId = views[tab] || views.dashboard;
  const view = document.getElementById(viewId);
  if (view) view.classList.remove('d-none');

  document.querySelectorAll('.sidebar .nav-link').forEach(el => el.classList.remove('active'));
  const nav = document.getElementById(getNavIdForTab(tab));
  if (nav) nav.classList.add('active');
}

// ---------------- Auth ----------------

async function boot() {
  try {
    currentUser = await request(API.me);
    showSignedInView();
    await loadSignedInData();
  } catch {
    showSignedOutView();
  }
}


async function login() {
  const username = document.getElementById('username')?.value.trim();
  const password = document.getElementById('password')?.value;
  const hint = document.getElementById('loginHint');

  syncLoginUrl();

  if (hint) {
    hint.classList.add('d-none');
    hint.textContent = '';
  }

  if (!username || !password) {
    const message = 'Username and password are required.';
    if (hint) {
      hint.textContent = message;
      hint.classList.remove('d-none');
    } else {
      showToast(message, 'danger');
    }
    return;
  }

  const btn = document.getElementById('loginSubmitBtn');
  let originalText = '';
  if (btn) {
    originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Authenticating...`;
    btn.disabled = true;
  }

  try {
    currentUser = await request(API.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    showSignedInView();
    await loadSignedInData();
    showToast(`Welcome back, ${currentUser.displayName}!`, 'success');

    const passwordInput = document.getElementById('password');
    if (passwordInput) passwordInput.value = '';
  } catch (err) {
    const message = err.message || 'Login failed';
    if (hint) {
      hint.textContent = message;
      hint.classList.remove('d-none');
    } else {
      showToast(message, 'danger');
    }
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

async function logout() {
  try {
    await request(API.logout, { method: 'POST' });
  } catch {}
  location.reload();
}

// ---------------- Signup / Password Reset ----------------

function openSignupModal() {
  const modal = document.getElementById('signupModal');
  if (!modal) return;
  ['signupUsername', 'signupDisplayName', 'signupEmail', 'signupPassword', 'signupConfirmPassword', 'signupCode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  new bootstrap.Modal(modal).show();
}

async function requestSignupCode() {
  const username = document.getElementById('signupUsername')?.value.trim();
  const displayName = document.getElementById('signupDisplayName')?.value.trim();
  const email = document.getElementById('signupEmail')?.value.trim();
  const password = document.getElementById('signupPassword')?.value;
  const confirmPassword = document.getElementById('signupConfirmPassword')?.value;

  if (!username || !displayName || !email || !password) {
    showToast('All signup fields are required.', 'danger');
    return;
  }
  if (password !== confirmPassword) {
    showToast('Passwords do not match.', 'danger');
    return;
  }

  try {
    await request(API.signup, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, email, password })
    });
    showToast('Verification code sent to your email.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to send verification code', 'danger');
  }
}

async function verifySignupCode() {
  const email = document.getElementById('signupEmail')?.value.trim();
  const code = document.getElementById('signupCode')?.value.trim();

  if (!email || !code) {
    showToast('Enter the email and verification code.', 'danger');
    return;
  }

  try {
    currentUser = await request(API.signupVerify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });

    const modalEl = document.getElementById('signupModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    showSignedInView();
    await loadSignedInData();
    showToast(`Account created for ${currentUser.displayName}.`, 'success');
    switchLoginRole();
  } catch (err) {
    showToast(err.message || 'Signup verification failed', 'danger');
  }
}

function openForgotPasswordModal() {
  const modal = document.getElementById('forgotPasswordModal');
  if (!modal) return;
  ['forgotEmail', 'forgotCode', 'forgotNewPassword', 'forgotConfirmPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  new bootstrap.Modal(modal).show();
}

async function requestPasswordResetCode() {
  const email = document.getElementById('forgotEmail')?.value.trim();
  if (!email) {
    showToast('Email is required.', 'danger');
    return;
  }

  try {
    await request(API.forgotRequest, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    showToast('Password reset code sent to your email.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to send reset code', 'danger');
  }
}

async function resetPassword() {
  const email = document.getElementById('forgotEmail')?.value.trim();
  const code = document.getElementById('forgotCode')?.value.trim();
  const newPassword = document.getElementById('forgotNewPassword')?.value;
  const confirmPassword = document.getElementById('forgotConfirmPassword')?.value;

  if (!email || !code || !newPassword) {
    showToast('Email, code, and new password are required.', 'danger');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match.', 'danger');
    return;
  }

  try {
    await request(API.forgotReset, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });
    const modalEl = document.getElementById('forgotPasswordModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    showToast('Password updated successfully.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to reset password', 'danger');
  }
}

// ---------------- Data Loading ----------------

async function loadSignedInData() {
  if (!currentUser) return;
  if (currentUser.role === 'student') {
    await loadStudentData();
  } else {
    await loadAdminData();
  }
}

async function loadStudentData() {
  const [reports, notifications, support] = await Promise.all([
    request(API.reports),
    request(API.notifications),
    request(API.support)
  ]);

  reportsCache = reports || [];
  notificationsCache = notifications || [];
  supportCache = support || [];

  renderStudentTable();
  renderStudentNotifications();
  renderStudentSupport();
}

async function loadAdminData() {
  const results = await Promise.allSettled([
    request(API.reports),
    request(API.users),
    request(API.stats),
    request(API.logs),
    request(API.support),
    request(API.notifications)
  ]);

  if (results[0].status === 'fulfilled') reportsCache = results[0].value || [];
  if (results[1].status === 'fulfilled') usersCache = results[1].value || [];
  if (results[3].status === 'fulfilled') logsCache = results[3].value || [];
  if (results[4].status === 'fulfilled') supportCache = results[4].value || [];
  if (results[5].status === 'fulfilled') notificationsCache = results[5].value || [];

  if (results[2].status === 'fulfilled') {
    renderDashboard(results[2].value);
  } else {
    renderDashboard(fallbackStatsFromReports());
  }

  renderAdminTable();
  renderUsersTable();
  renderLogsTable();
  renderSupportTable();
  renderAdminNotifications();
  updateAdminNotifBadge();
}

function fallbackStatsFromReports() {
  return {
    total: reportsCache.length,
    pending: reportsCache.filter(r => r.status === 'Pending').length,
    investigating: reportsCache.filter(r => r.status === 'Investigating').length,
    resolved: reportsCache.filter(r => r.status === 'Resolved').length,
    severity: [
      { severity: 'Critical', c: reportsCache.filter(r => r.severity === 'Critical').length },
      { severity: 'High', c: reportsCache.filter(r => r.severity === 'High').length },
      { severity: 'Medium', c: reportsCache.filter(r => r.severity === 'Medium').length },
      { severity: 'Low', c: reportsCache.filter(r => r.severity === 'Low').length }
    ]
  };
}

// ---------------- Rendering ----------------

function renderDashboard(stats) {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value ?? 0;
  };

  setText('stat-total', stats.total);
  setText('stat-pending', stats.pending);
  setText('stat-investigating', stats.investigating);
  setText('stat-resolved', stats.resolved);

  const map = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  (stats.severity || []).forEach(s => {
    if (s && s.severity in map) map[s.severity] = Number(s.c || 0);
  });

  const chartCanvas = document.getElementById('severityChart');
  if (chartCanvas && window.Chart) {
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(chartCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          data: [map.Critical, map.High, map.Medium, map.Low],
          backgroundColor: ['#dc2626', '#ea580c', '#eab308', '#22c55e'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              font: {
                family: "'Plus Jakarta Sans', sans-serif",
                weight: 600
              }
            }
          }
        }
      }
    });
  }

  const rows = reportsCache
    .filter(r => r.status !== 'Resolved')
    .slice(0, 5)
    .map(r => `
      <tr>
        <td>
          <div class="fw-bold text-dark">${escapeHtml(r.title)}</div>
          <div class="small text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(r.building)} / ${escapeHtml(r.area)}</div>
        </td>
        <td><span class="pill ${sevClass(r.severity)}">${escapeHtml(r.severity)}</span></td>
        <td class="text-end pe-4"><button class="btn btn-sm btn-light border rounded-pill px-3 fw-bold shadow-sm" onclick="openDetails(${r.id})">Review</button></td>
      </tr>
    `).join('');

  const tbody = document.getElementById('recentTableBody');
  if (tbody) {
    tbody.innerHTML = rows || '<tr><td colspan="3" class="text-center text-muted py-5"><i class="bi bi-check-circle fs-3 text-success d-block mb-2"></i> All clear. No action required.</td></tr>';
  }
}

function renderStudentTable() {
  const rows = reportsCache.map(r => `
    <tr>
      <td class="text-muted fw-semibold">#INC-${r.id}</td>
      <td>
        <div class="fw-bold text-dark">${escapeHtml(r.title)}</div>
        <div class="small text-muted">${escapeHtml(new Date(r.createdAt).toLocaleDateString())}</div>
      </td>
      <td><span class="pill ${sevClass(r.severity)}">${escapeHtml(r.severity)}</span></td>
      <td><span class="pill ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td>
      <td class="text-end pe-4"><button class="btn btn-sm btn-light border rounded-pill px-3 shadow-sm fw-bold" onclick="openDetails(${r.id})">View</button></td>
    </tr>
  `).join('');

  const tbody = document.getElementById('studentReportsList');
  if (tbody) {
    tbody.innerHTML = rows || '<tr><td colspan="5" class="text-center text-muted py-5">You haven\'t filed any reports yet.</td></tr>';
  }
}

function renderStudentNotifications() {
  const wrap = document.getElementById('studentNotificationsList');
  if (!wrap) return;

  if (!notificationsCache.length) {
    wrap.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-bell-slash fs-2 d-block mb-2 text-light"></i> All caught up.</div>';
    return;
  }

  wrap.innerHTML = notificationsCache.map(n => `
    <div class="border rounded-4 p-3 d-flex justify-content-between gap-3 shadow-sm transition ${n.isRead ? 'bg-white opacity-75' : 'bg-primary bg-opacity-10 border-primary'}">
      <div>
        <div class="fw-bold text-dark mb-1 ${!n.isRead ? 'text-primary' : ''}">${n.isRead ? '' : '<span class="position-absolute translate-middle p-1 bg-danger border border-light rounded-circle" style="margin-top: 8px; margin-left: -8px;"></span>'}${escapeHtml(n.title)}</div>
        <div class="small text-muted lh-sm">${escapeHtml(n.message)}</div>
        <div class="small text-muted mt-2 fw-medium"><i class="bi bi-clock"></i> ${new Date(n.createdAt).toLocaleDateString()}</div>
      </div>
      ${n.isRead ? '' : `<button class="btn btn-sm btn-outline-primary rounded-pill align-self-start fw-bold" onclick="markNotificationRead(${n.id})">Mark Read</button>`}
    </div>
  `).join('');
}

function renderStudentSupport() {
  const rows = supportCache.map(t => `
    <tr>
      <td class="text-muted fw-semibold">#SUP-${t.id}</td>
      <td>
        <a href="#" class="fw-bold text-primary text-decoration-none" onclick="openSupportDetails(${t.id}); return false;">${escapeHtml(t.subject)}</a>
        <div class="small text-muted">${escapeHtml(new Date(t.createdAt).toLocaleDateString())}</div>
      </td>
      <td class="text-end pe-4"><span class="pill ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
    </tr>
  `).join('');

  const tbody = document.getElementById('studentSupportList');
  if (tbody) {
    tbody.innerHTML = rows || '<tr><td colspan="3" class="text-center text-muted py-5">No open tickets.</td></tr>';
  }
}

function filterAdminReports() {
  const searchVal = document.getElementById('adminSearch')?.value.toLowerCase() || '';
  const statusVal = document.getElementById('adminStatusFilter')?.value || '';
  renderAdminTable(searchVal, statusVal);
}

function renderAdminTable(searchQuery = '', statusFilter = '') {
  const filtered = reportsCache.filter(r => {
    const reporter = r.reporterName || r.user || '';
    const matchSearch =
      String(r.title || '').toLowerCase().includes(searchQuery) ||
      String(reporter).toLowerCase().includes(searchQuery) ||
      String(r.building || '').toLowerCase().includes(searchQuery) ||
      String(r.id || '').includes(searchQuery);
    const matchStatus = statusFilter === '' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const rows = filtered.map(r => `
    <tr>
      <td class="fw-semibold text-muted">#${r.id}</td>
      <td>
        <div class="fw-bold text-primary">${escapeHtml(r.reporterName || r.user || 'Unknown')}</div>
      </td>
      <td>
        <div class="fw-bold text-dark">${escapeHtml(r.title)}</div>
        <div class="small text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(r.building)} / ${escapeHtml(r.area)}</div>
      </td>
      <td><span class="pill ${sevClass(r.severity)}">${escapeHtml(r.severity)}</span></td>
      <td><span class="pill ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td>
      <td class="fw-medium">${escapeHtml(r.assignedTo || '—')}</td>
      <td class="text-end pe-4">
        <div class="d-flex gap-2 justify-content-end align-items-center">
          <select class="form-select form-select-sm w-auto rounded-pill fw-medium border shadow-sm" onchange="updateStatus(${r.id}, this.value)">
            <option value="Pending" ${r.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Investigating" ${r.status === 'Investigating' ? 'selected' : ''}>Investigate</option>
            <option value="Resolved" ${r.status === 'Resolved' ? 'selected' : ''}>Resolve</option>
          </select>
          <button class="btn btn-sm btn-primary rounded-pill px-3 shadow-sm fw-bold" onclick="assignReport(${r.id})">Assign</button>
          <button class="btn btn-sm btn-light border rounded-pill px-3 shadow-sm fw-bold" onclick="openDetails(${r.id})">Details</button>
        </div>
      </td>
    </tr>
  `).join('');

  const tbody = document.getElementById('adminFullTable');
  if (tbody) {
    tbody.innerHTML = rows || '<tr><td colspan="7" class="text-center text-muted py-5">No reports found matching criteria.</td></tr>';
  }
}

function renderUsersTable() {
  const rows = usersCache.map(u => `
    <tr>
      <td class="fw-semibold text-muted">#${u.id}</td>
      <td class="fw-bold text-dark">@${escapeHtml(u.username)}</td>
      <td class="fw-medium">${escapeHtml(u.displayName)}</td>
      <td><span class="pill ${u.role === 'admin' ? 'bg-dark text-white' : 'bg-light text-dark border'}">${escapeHtml(u.role)}</span></td>
      <td class="text-end pe-4 d-flex gap-2 flex-wrap justify-content-end">
        <button class="btn btn-sm btn-light border rounded-pill px-3 fw-bold shadow-sm" onclick="openEditUserModal(${u.id})"><i class="bi bi-pencil-square"></i></button>
        <button class="btn btn-sm btn-outline-danger rounded-pill px-3 fw-bold shadow-sm" onclick="deleteUser(${u.id})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  const tbody = document.getElementById('adminUsersTable');
  if (tbody) tbody.innerHTML = rows || '<tr><td colspan="5" class="text-center text-muted py-4">No users.</td></tr>';
}

function renderLogsTable() {
  const rows = logsCache.map(l => `
    <tr>
      <td class="small text-muted fw-medium ps-4" style="white-space: nowrap;">${new Date(l.createdAt).toLocaleString()}</td>
      <td><span class="badge bg-light text-dark border fw-bold px-2 py-1"><i class="bi bi-person me-1"></i>${escapeHtml(l.actor)}</span></td>
      <td class="fw-bold text-primary">${escapeHtml(l.action)}</td>
      <td class="fw-medium text-dark">${escapeHtml(l.reportTitle || `Report #${l.reportId}`)}</td>
      <td class="text-muted small">${escapeHtml(l.details || '—')}</td>
    </tr>
  `).join('');

  const tbody = document.getElementById('adminLogsTable');
  if (tbody) tbody.innerHTML = rows || '<tr><td colspan="5" class="text-center text-muted py-5">No activity recorded yet.</td></tr>';
}

function renderSupportTable() {
  const rows = supportCache.map(t => `
    <tr>
      <td class="fw-semibold text-muted">#${t.id}</td>
      <td>
        <div class="fw-bold text-dark">${escapeHtml(t.displayName || t.username || 'System User')}</div>
        <div class="small text-muted">${new Date(t.createdAt).toLocaleDateString()}</div>
      </td>
      <td class="fw-bold"><a href="#" class="text-primary text-decoration-none" onclick="openSupportDetails(${t.id}); return false;">${escapeHtml(t.subject)}</a></td>
      <td><span class="pill ${t.priority === 'High' ? 'sev-critical' : t.priority === 'Medium' ? 'sev-medium' : 'sev-low'}">${escapeHtml(t.priority)}</span></td>
      <td><span class="pill ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
      <td class="fw-medium">${escapeHtml(t.assignedTo || '—')}</td>
      <td class="text-end pe-4">
        <div class="d-flex gap-2 justify-content-end align-items-center">
          <select class="form-select form-select-sm w-auto rounded-pill fw-medium border shadow-sm" onchange="updateSupportStatus(${t.id}, this.value)">
            <option value="Open" ${t.status === 'Open' ? 'selected' : ''}>Open</option>
            <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>Working</option>
            <option value="Resolved" ${t.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
          </select>
          <button class="btn btn-sm btn-light border rounded-pill px-3 shadow-sm fw-bold" onclick="assignSupport(${t.id})">Assign</button>
        </div>
      </td>
    </tr>
  `).join('');

  const tbody = document.getElementById('adminSupportTable');
  if (tbody) tbody.innerHTML = rows || '<tr><td colspan="7" class="text-center text-muted py-5">No support tickets.</td></tr>';
}

function renderAdminNotifications() {
  const wrap = document.getElementById('adminNotificationsList');
  if (!wrap) return;

  if (!notificationsCache.length) {
    wrap.innerHTML = '<div class="text-center text-muted py-5"><i class="bi bi-bell-slash fs-1 d-block mb-3 text-light"></i> All caught up.</div>';
    return;
  }

  wrap.innerHTML = notificationsCache.map(n => `
    <div class="border rounded-4 p-4 d-flex justify-content-between gap-3 shadow-sm transition ${n.isRead ? 'bg-white' : 'bg-primary bg-opacity-10 border-primary'}">
      <div>
        <div class="fw-bold text-dark fs-6 mb-1 ${!n.isRead ? 'text-primary' : ''}">${n.isRead ? '' : '<span class="position-absolute translate-middle p-1 bg-danger border border-light rounded-circle" style="margin-top: 10px; margin-left: -12px;"></span>'}${escapeHtml(n.title)}</div>
        <div class="text-muted lh-base mb-2">${escapeHtml(n.message)}</div>
        <div class="small text-muted fw-medium"><i class="bi bi-clock"></i> ${new Date(n.createdAt).toLocaleString()}</div>
      </div>
      ${n.isRead ? '<span class="badge bg-light text-muted border align-self-start py-2 px-3 rounded-pill">Read</span>' : `<button class="btn btn-sm btn-primary rounded-pill align-self-start fw-bold shadow-sm" onclick="markNotificationRead(${n.id})">Acknowledge</button>`}
    </div>
  `).join('');
}

function updateAdminNotifBadge() {
  const unread = notificationsCache.filter(n => !n.isRead).length;
  const badge = document.getElementById('adminNotifBadge');
  if (!badge) return;
  badge.innerText = unread;
  if (unread > 0) {
    badge.classList.remove('bg-secondary');
    badge.classList.add('bg-danger');
  } else {
    badge.classList.remove('bg-danger');
    badge.classList.add('bg-secondary');
  }
}

// ---------------- Feature Logic ----------------

function updateSeverityHint() {
  const text = `${document.getElementById('reportTitle')?.value || ''} ${document.getElementById('reportDesc')?.value || ''}`;
  const t = text.toLowerCase();
  let sev = 'Low';
  if (/(weapon|fight|assault|threat|intruder|fire|smoke|tamper|tampering|theft|stolen|gas leak|chemical)/.test(t)) {
    sev = /(weapon|assault|intruder|fire|gas leak|chemical)/.test(t) ? 'Critical' : 'High';
  } else if (/(damage|leak|injury|broken|vandal|blocked|spill|power outage|suspicious)/.test(t)) {
    sev = 'Medium';
  }

  const sevSelect = document.getElementById('reportSev');
  if (sevSelect) sevSelect.value = sev;

  const hint = document.getElementById('severityHint');
  if (hint) {
    hint.innerHTML = `<i class="bi bi-robot"></i> Smart Detect: Severity automatically set to <strong>${sev}</strong> based on description.`;
  }
}

function resetReportForm() {
  ['reportTitle', 'reportBuilding', 'reportArea', 'reportDateTime', 'reportSev', 'reportDesc', 'reportEvidence'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
      el.value = id === 'reportSev' ? 'Medium' : '';
    } else if (el.type === 'file') {
      el.value = '';
    } else if (id === 'reportSev') {
      el.value = 'Medium';
    } else {
      el.value = '';
    }
  });

  const hint = document.getElementById('severityHint');
  if (hint) hint.innerHTML = '<i class="bi bi-info-circle"></i> Type description to auto-detect severity.';

  setCurrentReportDateTime();
  if (currentUser) {
    const reportedBy = document.getElementById('reportedByDisplay');
    if (reportedBy) reportedBy.value = currentUser.displayName;
  }
}

async function submitReport() {
  const title = document.getElementById('reportTitle')?.value.trim();
  const building = document.getElementById('reportBuilding')?.value;
  const area = document.getElementById('reportArea')?.value;
  const datetime = document.getElementById('reportDateTime')?.value || toLocalDatetimeValue();

  if (!title || !building || !area) {
    showToast('Please fill out all required fields marked with an asterisk.', 'danger');
    return;
  }

  const fd = new FormData();
  fd.append('title', title);
  fd.append('building', building);
  fd.append('area', area);
  fd.append('description', document.getElementById('reportDesc')?.value.trim() || '');
  fd.append('severity', document.getElementById('reportSev')?.value || 'Medium');
  fd.append('datetime', new Date(datetime).toLocaleString());

  const file = document.getElementById('reportEvidence')?.files?.[0];
  if (file) fd.append('evidence', file);

  try {
    const res = await fetch(API.reports, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to submit report');
    }
    showToast('Incident report submitted successfully.', 'success');
    resetReportForm();
    await loadStudentData();
  } catch (err) {
    showToast(err.message || 'Failed to submit report', 'danger');
  }
}

async function submitSupport() {
  try {
    await request(API.support, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: document.getElementById('supportSubject')?.value.trim(),
        category: document.getElementById('supportCategory')?.value,
        priority: document.getElementById('supportPriority')?.value,
        message: document.getElementById('supportMessage')?.value.trim()
      })
    });

    const modal = document.getElementById('supportModal');
    bootstrap.Modal.getInstance(modal)?.hide();
    const subj = document.getElementById('supportSubject');
    const msg = document.getElementById('supportMessage');
    if (subj) subj.value = '';
    if (msg) msg.value = '';
    showToast('Support ticket sent. The admin team will review it shortly.', 'success');
    await loadSignedInData();
  } catch (err) {
    showToast(err.message || 'Failed to submit support ticket', 'danger');
  }
}

async function openDetails(id) {
  try {
    const data = await request(`${API.reports}/${id}`);
    const r = data.report;

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.innerText = value;
    };

    set('modalTitle', r.title);
    set('modalId', `#INC-${String(r.id).padStart(3, '0')}`);
    set('modalUser', r.reporterName);
    set('modalLocTime', `${r.building} • ${r.area} | ${r.datetime}`);
    set('modalDesc', r.description || 'No additional details provided.');

    const assigned = document.getElementById('modalAssigned');
    if (assigned) assigned.innerHTML = `<i class="bi bi-person me-1"></i> Assigned: ${escapeHtml(r.assignedTo || 'Unassigned')}`;

    const st = document.getElementById('modalStatus');
    if (st) {
      st.className = `pill ${statusClass(r.status)}`;
      st.innerText = r.status;
    }

    const se = document.getElementById('modalSev');
    if (se) {
      se.className = `pill ${sevClass(r.severity)}`;
      se.innerText = r.severity;
    }

    const evidence = document.getElementById('modalEvidence');
    if (evidence) {
      evidence.innerHTML = data.evidence.length
        ? data.evidence.map(e => `<a href="${e.filePath}" target="_blank" rel="noopener" class="btn btn-sm btn-light border text-start shadow-sm d-flex align-items-center gap-2"><i class="bi bi-file-earmark-image text-primary fs-5"></i> ${escapeHtml(e.originalName)}</a>`).join('')
        : '<div class="text-muted small">No files attached.</div>';
    }

    const logs = document.getElementById('modalLogs');
    if (logs) {
      logs.innerHTML = data.logs.length
        ? data.logs.map(l => `
            <div class="border-start border-2 border-primary ps-3 position-relative pb-2">
              <div class="position-absolute top-0 start-0 translate-middle p-1 bg-primary border border-white rounded-circle"></div>
              <div class="fw-bold text-dark fs-6">${escapeHtml(l.action)}</div>
              <div class="small text-muted mb-1"><i class="bi bi-person-fill"></i> ${escapeHtml(l.actor)} • ${new Date(l.createdAt).toLocaleString()}</div>
              ${l.details ? `<div class="bg-light p-2 rounded-3 small border mt-1">${escapeHtml(l.details)}</div>` : ''}
            </div>
          `).join('')
        : '<div class="text-muted small">No system activity logged.</div>';
    }

    new bootstrap.Modal(document.getElementById('detailsModal')).show();
  } catch (err) {
    showToast(err.message || 'Failed to load details', 'danger');
  }
}

function openSupportDetails(id) {
  const ticket = supportCache.find(t => t.id === id);
  if (!ticket) return;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  set('supModalId', `#SUP-${String(ticket.id).padStart(3, '0')}`);
  set('supModalSubject', ticket.subject);
  set('supModalMessage', ticket.message || 'No message provided.');
  set('supModalUser', ticket.displayName || ticket.username || 'System User');
  set('supModalDate', new Date(ticket.createdAt).toLocaleString());
  set('supModalCategory', ticket.category || 'General');

  const p = document.getElementById('supModalPriority');
  if (p) {
    p.innerText = ticket.priority;
    p.className = `pill ${ticket.priority === 'High' ? 'sev-critical' : ticket.priority === 'Medium' ? 'sev-medium' : 'sev-low'}`;
  }

  const s = document.getElementById('supModalStatus');
  if (s) {
    s.innerText = ticket.status;
    s.className = `pill ${statusClass(ticket.status)}`;
  }

  new bootstrap.Modal(document.getElementById('supportDetailsModal')).show();
}

function exportCSV() {
  if (!reportsCache.length) {
    showToast('No data to export', 'info');
    return;
  }

  const headers = ['ID', 'Title', 'Building', 'Area', 'Severity', 'Status', 'Reporter', 'Incident Time', 'Created At', 'Description', 'Assigned To'];
  const csvRows = [headers.join(',')];

  reportsCache.forEach(r => {
    const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    csvRows.push([
      r.id,
      quote(r.title),
      quote(r.building),
      quote(r.area),
      quote(r.severity),
      quote(r.status),
      quote(r.reporterName || r.user || ''),
      quote(r.datetime),
      quote(r.createdAt),
      quote(r.description || ''),
      quote(r.assignedTo || '')
    ].join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incident_reports_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  showToast('Export successful', 'success');
}

function openCreateUserModal() {
  const modal = document.getElementById('userModal');
  if (!modal) return;
  document.getElementById('userModalTitle').innerText = 'Create User';
  document.getElementById('userId').value = '';
  document.getElementById('userUsername').value = '';
  document.getElementById('userDisplayName').value = '';
  document.getElementById('userRole').value = 'student';
  document.getElementById('userPassword').value = '';
  new bootstrap.Modal(modal).show();
}

function openEditUserModal(id) {
  const user = usersCache.find(u => u.id === id);
  if (!user) return;
  document.getElementById('userModalTitle').innerText = 'Edit User';
  document.getElementById('userId').value = user.id;
  document.getElementById('userUsername').value = user.username;
  document.getElementById('userDisplayName').value = user.displayName;
  document.getElementById('userRole').value = user.role;
  document.getElementById('userPassword').value = '';
  new bootstrap.Modal(document.getElementById('userModal')).show();
}

async function saveUser() {
  const idValue = document.getElementById('userId').value;
  const id = idValue ? Number(idValue) : null;
  const payload = {
    username: document.getElementById('userUsername').value.trim(),
    displayName: document.getElementById('userDisplayName').value.trim(),
    email: document.getElementById('userEmail')?.value?.trim() || '',
    role: document.getElementById('userRole').value,
    password: document.getElementById('userPassword').value
  };

  if (!payload.username || !payload.displayName) {
    showToast('Username and Display Name are required.', 'danger');
    return;
  }

  try {
    if (id) {
      await request(`${API.users}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('User updated successfully.', 'success');
    } else {
      await request(API.users, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('New user created successfully.', 'success');
    }

    const modal = document.getElementById('userModal');
    bootstrap.Modal.getInstance(modal)?.hide();
    await loadAdminData();
    switchAdminTab('users');
  } catch (err) {
    showToast(err.message || 'Failed to save user', 'danger');
  }
}

async function deleteUser(id) {
  const user = usersCache.find(u => u.id === id);
  if (!user) return;
  if (!confirm(`Are you sure you want to permanently delete user @${user.username}?`)) return;

  try {
    await request(`${API.users}/${id}`, { method: 'DELETE' });
    showToast(`User @${user.username} deleted.`, 'success');
    await loadAdminData();
    switchAdminTab('users');
  } catch (err) {
    showToast(err.message || 'Failed to delete user', 'danger');
  }
}

async function updateStatus(id, status) {
  try {
    await request(`${API.reports}/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast(`Report #${id} status changed to ${status}.`, 'success');
    await loadAdminData();
    filterAdminReports();
  } catch (err) {
    showToast(err.message || 'Failed to update status', 'danger');
  }
}

async function assignReport(id) {
  const assignableUsers = usersCache.filter(
    u => u.role === 'staff' || u.role === 'admin'
  );

  if (!assignableUsers.length) {
    showToast('No available staff or admin users.', 'danger');
    return;
  }

  const options = assignableUsers
    .map(
      u =>
        `${u.id}: ${u.displayName} (${u.role.toUpperCase()})`
    )
    .join('\n');

  const selected = prompt(
    `Assign report to:\n\n${options}\n\nEnter User ID:`
  );

  if (!selected) return;

  const selectedUser = assignableUsers.find(
    u => String(u.id) === String(selected)
  );

  if (!selectedUser) {
    showToast('Invalid user selected.', 'danger');
    return;
  }

  try {
    await request(`${API.reports}/${id}/assign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assignedTo: selectedUser.displayName
      })
    });

    showToast(
      `Report assigned to ${selectedUser.displayName}.`,
      'success'
    );

    await loadAdminData();

    filterAdminReports();

  } catch (err) {
    showToast(
      err.message || 'Failed to update assignment',
      'danger'
    );
  }
}

async function updateSupportStatus(id, status) {
  try {
    await request(`${API.support}/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast('Support ticket status updated.', 'success');
    await loadAdminData();
  } catch (err) {
    showToast(err.message || 'Failed to update support ticket', 'danger');
  }
}

async function assignSupport(id) {
  const ticket = supportCache.find(t => t.id === id);

  if (!ticket) return;

  const assignableUsers = usersCache.filter(
    u => u.role === 'staff' || u.role === 'admin'
  );

  if (!assignableUsers.length) {
    showToast('No available staff or admin users.', 'danger');
    return;
  }

  const options = assignableUsers
    .map(
      u =>
        `${u.id}: ${u.displayName} (${u.role.toUpperCase()})`
    )
    .join('\n');

  const selected = prompt(
    `Assign support ticket to:\n\n${options}\n\nEnter User ID:`
  );

  if (!selected) return;

  const selectedUser = assignableUsers.find(
    u => String(u.id) === String(selected)
  );

  if (!selectedUser) {
    showToast('Invalid user selected.', 'danger');
    return;
  }

  try {
    await request(`${API.support}/${id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: ticket.status,
        assignedTo: selectedUser.displayName
      })
    });

    showToast(
      `Ticket assigned to ${selectedUser.displayName}.`,
      'success'
    );

    await loadAdminData();

  } catch (err) {
    showToast(
      err.message || 'Failed to assign ticket',
      'danger'
    );
  }
}
async function markNotificationRead(id) {
  try {
    await request(`${API.notifications}/${id}/read`, { method: 'PUT' });
    await loadSignedInData();
  } catch (err) {
    showToast(err.message || 'Failed to mark read', 'danger');
  }
}

async function markAllNotificationsRead() {
  try {
    await request(`${API.notifications}/read-all`, { method: 'PUT' });
    showToast('All notifications marked as read', 'success');
    await loadSignedInData();
  } catch (err) {
    showToast(err.message || 'Failed to clear notifications', 'danger');
  }
}

// ---------------- Global Bindings ----------------

window.login = login;
window.logout = logout;
window.switchLoginRole = switchLoginRole;
window.togglePassword = togglePassword;
window.openSignupModal = openSignupModal;
window.requestSignupCode = requestSignupCode;
window.verifySignupCode = verifySignupCode;
window.openForgotPasswordModal = openForgotPasswordModal;
window.requestPasswordResetCode = requestPasswordResetCode;
window.resetPassword = resetPassword;
window.submitReport = submitReport;
window.openDetails = openDetails;
window.openSupportDetails = openSupportDetails;
window.submitSupport = submitSupport;
window.exportCSV = exportCSV;
window.openCreateUserModal = openCreateUserModal;
window.openEditUserModal = openEditUserModal;
window.saveUser = saveUser;
window.deleteUser = deleteUser;
window.updateStatus = updateStatus;
window.assignReport = assignReport;
window.updateSupportStatus = updateSupportStatus;
window.assignSupport = assignSupport;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.filterAdminReports = filterAdminReports;
window.switchAdminTab = switchAdminTab;
window.updateSeverityHint = updateSeverityHint;
window.resetReportForm = resetReportForm;

window.addEventListener('DOMContentLoaded', boot);
