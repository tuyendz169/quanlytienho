/* ==========================================================================
   MAIN JAVASCRIPT - SỔ QUẢN LÝ TIỀN HỌ & TÍNH LÃI CỘNG DỒN
   ========================================================================== */

// --- 1. STATE & STORAGE MANAGEMENT ---
const STORAGE_KEY_GROUPS = 'quanlyho_groups_v1';
const STORAGE_KEY_PAYMENTS = 'quanlyho_payments_v1';
const STORAGE_KEY_ACTIVE_GROUP = 'quanlyho_active_group_v1';
const STORAGE_KEY_THEME = 'quanlyho_theme_v1';

let appState = {
  groups: [],
  payments: [],
  activeGroupId: null,
  theme: 'dark',
  filterStatus: 'all',
  searchQuery: '',
  searchGroupQuery: ''
};

let interestChartInstance = null;
let comparisonChartInstance = null;

// Helper: Format Currency (VND)
function formatVND(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' đ';
}

// Helper: Parse Number from Formatted VND string
function parseVND(str) {
  if (!str) return 0;
  const raw = String(str).replace(/[^\d]/g, '');
  return parseInt(raw, 10) || 0;
}

// Helper: Format Date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('vi-VN');
}

// Helper: Unique ID
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

// --- 2. INITIALIZATION & DATA LOADING ---
function initApp() {
  loadDataFromStorage();
  initTheme();
  setupEventListeners();

  // If no group exists, load demo data or prompt
  if (appState.groups.length === 0) {
    loadDemoData(false); // Load sample silently on first run
  } else {
    // Ensure active group is valid
    if (!appState.activeGroupId || !appState.groups.find(g => g.id === appState.activeGroupId)) {
      appState.activeGroupId = appState.groups[0].id;
    }
  }

  renderAll();
  
  // Refresh Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function loadDataFromStorage() {
  try {
    const storedGroups = localStorage.getItem(STORAGE_KEY_GROUPS);
    const storedPayments = localStorage.getItem(STORAGE_KEY_PAYMENTS);
    const storedActiveGroup = localStorage.getItem(STORAGE_KEY_ACTIVE_GROUP);
    const storedTheme = localStorage.getItem(STORAGE_KEY_THEME);

    if (storedGroups) appState.groups = JSON.parse(storedGroups);
    if (storedPayments) appState.payments = JSON.parse(storedPayments);
    if (storedActiveGroup) appState.activeGroupId = storedActiveGroup;
    if (storedTheme) appState.theme = storedTheme;
  } catch (e) {
    console.error('Lỗi khi tải dữ liệu từ localStorage:', e);
  }
}

function saveDataToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(appState.groups));
    localStorage.setItem(STORAGE_KEY_PAYMENTS, JSON.stringify(appState.payments));
    localStorage.setItem(STORAGE_KEY_ACTIVE_GROUP, appState.activeGroupId || '');
    localStorage.setItem(STORAGE_KEY_THEME, appState.theme);
  } catch (e) {
    console.error('Lỗi khi lưu dữ liệu vào localStorage:', e);
  }
}

// --- 3. THEME MANAGEMENT ---
function initTheme() {
  document.documentElement.setAttribute('data-theme', appState.theme);
}

function toggleTheme() {
  appState.theme = appState.theme === 'dark' ? 'light' : 'dark';
  initTheme();
  saveDataToStorage();
  renderCharts(); // Re-render charts for theme colors
  showToast(`Đã chuyển sang giao diện ${appState.theme === 'dark' ? 'Tối' : 'Sáng'}`);
}

// --- 4. CORE COMPUTATION & CALCULATIONS ---
function getActiveGroup() {
  return appState.groups.find(g => g.id === appState.activeGroupId) || null;
}

function getActivePayments() {
  if (!appState.activeGroupId) return [];
  return appState.payments
    .filter(p => p.groupId === appState.activeGroupId)
    .sort((a, b) => Number(a.periodNumber) - Number(b.periodNumber));
}

// Compute Cumulative Interest per period chronologically
function getProcessedPayments() {
  const rawPayments = getActivePayments();
  let cumulativeInterest = 0;

  return rawPayments.map(payment => {
    const base = Number(payment.baseAmount) || 0;
    const actual = Number(payment.actualAmount) || 0;
    
    // Formula requested by User: Monthly Interest = Base Amount - Actual Amount Paid
    const monthlyInterest = base - actual;

    // Cumulative interest sums up for paid or won periods
    if (payment.status === 'paid' || payment.status === 'won') {
      cumulativeInterest += monthlyInterest;
    }

    return {
      ...payment,
      monthlyInterest,
      cumulativeInterest
    };
  });
}

function computeKPIs() {
  const processed = getProcessedPayments();
  const activePayments = processed.filter(p => p.status === 'paid' || p.status === 'won');

  let totalActualPaid = 0;
  let totalBaseAmount = 0;
  let totalCumulativeInterest = 0;

  activePayments.forEach(p => {
    totalActualPaid += Number(p.actualAmount) || 0;
    totalBaseAmount += Number(p.baseAmount) || 0;
    totalCumulativeInterest += p.monthlyInterest;
  });

  const activeGroup = getActiveGroup();
  const totalPlannedPeriods = activeGroup ? Number(activeGroup.totalPeriods || 12) : 12;
  const currentPeriodCount = processed.length;

  const returnRate = totalBaseAmount > 0 ? (totalCumulativeInterest / totalBaseAmount) * 100 : 0;

  return {
    totalActualPaid,
    totalBaseAmount,
    totalCumulativeInterest,
    activeCount: activePayments.length,
    totalPlannedPeriods,
    currentPeriodCount,
    returnRate
  };
}

// --- 5. RENDER FUNCTIONS ---
function renderAll() {
  renderGroupSelect();
  renderGroupBanner();
  renderKPIs();
  renderPaymentsTable();
  renderGroupListTab();
  renderCharts();
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderGroupSelect() {
  const select = document.getElementById('groupSelect');
  if (!select) return;

  select.innerHTML = '';
  appState.groups.forEach(g => {
    const option = document.createElement('option');
    option.value = g.id;
    const memberStr = g.memberName ? `👤 ${g.memberName} - ` : '';
    option.textContent = `${memberStr}${g.name} (${formatVND(g.baseAmount)})`;
    if (g.id === appState.activeGroupId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function renderGroupBanner() {
  const group = getActiveGroup();
  const nameEl = document.getElementById('currentGroupName');
  const baseEl = document.getElementById('baseAmountDisplay');
  const periodEl = document.getElementById('periodDisplay');

  if (!group) {
    if (nameEl) nameEl.textContent = 'Chưa chọn Dây Họ';
    return;
  }

  const memberText = group.memberName ? ` • Người chơi: ${group.memberName}` : '';
  if (nameEl) nameEl.textContent = group.name;
  if (baseEl) baseEl.textContent = formatVND(group.baseAmount);
  if (periodEl) periodEl.innerHTML = `${group.periodType || 'Hàng tháng'}<strong style="color:var(--accent-blue); margin-left:8px;">${memberText}</strong>`;
}

function renderKPIs() {
  const kpis = computeKPIs();

  const cumulativeEl = document.getElementById('statCumulativeInterest');
  const paidEl = document.getElementById('statTotalActualPaid');
  const baseEl = document.getElementById('statTotalBaseAmount');
  const countEl = document.getElementById('statInterestCount');
  const rateEl = document.getElementById('statReturnRate');
  const progressPeriodsEl = document.getElementById('statProgressPeriods');
  const progressBarEl = document.getElementById('statProgressBar');

  if (cumulativeEl) cumulativeEl.textContent = formatVND(kpis.totalCumulativeInterest);
  if (paidEl) paidEl.textContent = formatVND(kpis.totalActualPaid);
  if (baseEl) baseEl.textContent = formatVND(kpis.totalBaseAmount);
  
  if (countEl) {
    countEl.textContent = `Tích lũy qua ${kpis.activeCount} kỳ đã đóng`;
  }
  if (rateEl) {
    rateEl.textContent = `+${kpis.returnRate.toFixed(1)}% Tiết kiệm`;
  }
  
  if (progressPeriodsEl) {
    progressPeriodsEl.textContent = `${kpis.currentPeriodCount} / ${kpis.totalPlannedPeriods} kỳ`;
  }
  if (progressBarEl) {
    const pct = Math.min(100, Math.round((kpis.currentPeriodCount / kpis.totalPlannedPeriods) * 100));
    progressBarEl.style.width = `${pct}%`;
  }
}

function renderPaymentsTable() {
  const processed = getProcessedPayments();
  const tableBody = document.getElementById('paymentsTableBody');
  const mobileCardList = document.getElementById('mobileCardList');
  const emptyState = document.getElementById('emptyState');
  const tableEl = document.getElementById('paymentsTable');

  // Apply filters
  let filtered = processed.filter(p => {
    if (appState.filterStatus !== 'all' && p.status !== appState.filterStatus) return false;
    if (appState.searchQuery) {
      const q = appState.searchQuery.toLowerCase();
      const matchNote = (p.note || '').toLowerCase().includes(q);
      const matchPeriod = String(p.periodNumber).includes(q);
      const matchActual = String(p.actualAmount).includes(q);
      return matchNote || matchPeriod || matchActual;
    }
    return true;
  });

  if (!tableBody || !mobileCardList) return;

  if (filtered.length === 0) {
    tableBody.innerHTML = '';
    mobileCardList.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    if (tableEl) tableEl.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (tableEl) tableEl.classList.remove('hidden');

  // Render Desktop Table Rows
  tableBody.innerHTML = filtered.map(p => {
    const statusBadge = getStatusBadgeHTML(p.status);
    const dateFormatted = p.date ? formatDate(p.date) : 'Chưa ghi';
    const noteText = p.note || '-';

    return `
      <tr>
        <td>
          <span class="table-period-badge">${p.periodNumber}</span>
        </td>
        <td>${dateFormatted}</td>
        <td>${formatVND(p.baseAmount)}</td>
        <td style="font-weight: 700;">${formatVND(p.actualAmount)}</td>
        <td>
          <span class="badge-interest">+${formatVND(p.monthlyInterest)}</span>
        </td>
        <td>
          <strong class="text-emerald">${formatVND(p.cumulativeInterest)}</strong>
        </td>
        <td>${statusBadge}</td>
        <td style="max-width: 200px; text-overflow: ellipsis; overflow: hidden;" title="${noteText}">${noteText}</td>
        <td class="text-right">
          <button class="btn btn-icon btn-ghost btn-sm" onclick="editPayment('${p.id}')" title="Chỉnh sửa">
            <i data-lucide="edit-2"></i>
          </button>
          <button class="btn btn-icon btn-ghost btn-sm text-rose" onclick="deletePayment('${p.id}')" title="Xóa">
            <i data-lucide="trash-2"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Render Mobile Card List
  mobileCardList.innerHTML = filtered.map(p => {
    const statusBadge = getStatusBadgeHTML(p.status);
    const dateFormatted = p.date ? formatDate(p.date) : 'Chưa ghi';

    return `
      <div class="mobile-payment-card">
        <div class="m-card-header">
          <span class="m-card-period">Tháng / Kỳ ${p.periodNumber} (${dateFormatted})</span>
          ${statusBadge}
        </div>
        <div class="m-card-body">
          <div>
            <div class="m-card-label">Mức đóng chuẩn</div>
            <div class="m-card-val">${formatVND(p.baseAmount)}</div>
          </div>
          <div>
            <div class="m-card-label">Thực đóng</div>
            <div class="m-card-val">${formatVND(p.actualAmount)}</div>
          </div>
          <div>
            <div class="m-card-label">Lãi tháng này</div>
            <div class="badge-interest">+${formatVND(p.monthlyInterest)}</div>
          </div>
          <div>
            <div class="m-card-label">Lãi cộng dồn</div>
            <div class="m-card-val text-emerald">${formatVND(p.cumulativeInterest)}</div>
          </div>
        </div>
        ${p.note ? `<div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:8px;">📌 Ghi chú: ${p.note}</div>` : ''}
        <div class="m-card-actions">
          <button class="btn btn-sm btn-secondary" onclick="editPayment('${p.id}')">
            <i data-lucide="edit-2"></i> Sửa
          </button>
          <button class="btn btn-sm btn-ghost text-rose" onclick="deletePayment('${p.id}')">
            <i data-lucide="trash-2"></i> Xóa
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusBadgeHTML(status) {
  if (status === 'won') {
    return `<span class="badge-status status-won"><i data-lucide="trophy"></i> Đã Hốt Họ</span>`;
  } else if (status === 'paid') {
    return `<span class="badge-status status-paid"><i data-lucide="check-circle-2"></i> Đã Đóng</span>`;
  }
  return `<span class="badge-status status-pending"><i data-lucide="clock"></i> Chưa Đóng</span>`;
}

function renderGroupListTab() {
  const container = document.getElementById('groupsListGrid');
  if (!container) return;

  // Filter groups by searchGroupQuery (tên người dùng hoặc tên dây)
  let groupsToRender = appState.groups;
  if (appState.searchGroupQuery) {
    const q = appState.searchGroupQuery.toLowerCase();
    groupsToRender = appState.groups.filter(g => 
      (g.name || '').toLowerCase().includes(q) || 
      (g.memberName || '').toLowerCase().includes(q) ||
      (g.owner || '').toLowerCase().includes(q)
    );
  }

  if (groupsToRender.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i data-lucide="search-x" style="width: 48px; height: 48px; margin-bottom: 12px;"></i>
        <h4>Không tìm thấy dây họ nào phù hợp với tên "${appState.searchGroupQuery}"</h4>
      </div>
    `;
    return;
  }

  container.innerHTML = groupsToRender.map(g => {
    const isCurrent = g.id === appState.activeGroupId;
    const groupPayments = appState.payments.filter(p => p.groupId === g.id);
    const paidCount = groupPayments.filter(p => p.status === 'paid' || p.status === 'won').length;
    
    let totalInterest = 0;
    groupPayments.forEach(p => {
      if (p.status === 'paid' || p.status === 'won') {
        totalInterest += (Number(p.baseAmount) - Number(p.actualAmount));
      }
    });

    return `
      <div class="group-card ${isCurrent ? 'active-group-card' : ''}">
        <div>
          <div class="group-card-header">
            <div>
              <div class="group-title">${g.name}</div>
              <div style="font-size:0.9rem; font-weight: 700; color: var(--accent-blue); margin-top:4px;">
                👤 Người chơi: ${g.memberName || 'Chưa đặt tên'}
              </div>
              <span class="badge mt-1">${g.periodType || 'Hàng tháng'}</span>
            </div>
            ${isCurrent ? '<span class="badge-status status-paid">Đang chọn</span>' : ''}
          </div>

          <div class="group-card-stats">
            <div class="group-stat-item">
              <label>Mức đóng chuẩn</label>
              <div>${formatVND(g.baseAmount)}</div>
            </div>
            <div class="group-stat-item">
              <label>Tổng lãi tích lũy</label>
              <div class="text-emerald">${formatVND(totalInterest)}</div>
            </div>
            <div class="group-stat-item">
              <label>Tiến độ đóng</label>
              <div>${paidCount} / ${g.totalPeriods || 12} kỳ</div>
            </div>
            <div class="group-stat-item">
              <label>Chủ hụi / Liên hệ</label>
              <div style="font-size:0.85rem;">${g.owner || 'Không có'}</div>
            </div>
          </div>
        </div>

        <div class="group-card-footer">
          <button class="btn btn-sm ${isCurrent ? 'btn-secondary' : 'btn-primary'}" onclick="selectActiveGroup('${g.id}')">
            <i data-lucide="${isCurrent ? 'check' : 'arrow-right'}"></i> ${isCurrent ? 'Đang quản lý' : 'Chọn dây này'}
          </button>
          <div>
            <button class="btn btn-icon btn-ghost btn-sm" onclick="openEditGroupModal('${g.id}')" title="Sửa Dây Họ">
              <i data-lucide="edit-3"></i>
            </button>
            ${appState.groups.length > 1 ? `
              <button class="btn btn-icon btn-ghost btn-sm text-rose" onclick="deleteGroup('${g.id}')" title="Xóa Dây Họ">
                <i data-lucide="trash-2"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- 6. CHART.JS VISUAL ANALYTICS ---
function renderCharts() {
  const processed = getProcessedPayments();
  const isDark = appState.theme === 'dark';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Chart 1: Cumulative Interest Line Chart
  const ctxLine = document.getElementById('chartCumulativeInterest')?.getContext('2d');
  if (ctxLine) {
    if (interestChartInstance) interestChartInstance.destroy();

    const labels = processed.map(p => `Kỳ ${p.periodNumber}`);
    const dataInterest = processed.map(p => p.cumulativeInterest);

    interestChartInstance = new Chart(ctxLine, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Lãi Cộng Dồn (VNĐ)',
          data: dataInterest,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#10b981'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` Lãi cộng dồn: ${formatVND(context.raw)}`
            }
          }
        },
        scales: {
          x: { ticks: { color: textColor }, grid: { color: gridColor } },
          y: {
            ticks: {
              color: textColor,
              callback: (value) => value >= 1000000 ? (value / 1000000) + 'Tr' : (value / 1000) + 'k'
            },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  // Chart 2: Comparison Bar Chart
  const ctxBar = document.getElementById('chartComparison')?.getContext('2d');
  if (ctxBar) {
    if (comparisonChartInstance) comparisonChartInstance.destroy();

    const labels = processed.map(p => `Kỳ ${p.periodNumber}`);
    const baseData = processed.map(p => p.baseAmount);
    const actualData = processed.map(p => p.actualAmount);

    comparisonChartInstance = new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Mức Chuẩn',
            data: baseData,
            backgroundColor: 'rgba(139, 92, 246, 0.6)',
            borderRadius: 6
          },
          {
            label: 'Thực Đóng',
            data: actualData,
            backgroundColor: 'rgba(59, 130, 246, 0.85)',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${formatVND(context.raw)}`
            }
          }
        },
        scales: {
          x: { ticks: { color: textColor }, grid: { color: gridColor } },
          y: {
            ticks: {
              color: textColor,
              callback: (value) => value >= 1000000 ? (value / 1000000) + 'Tr' : (value / 1000) + 'k'
            },
            grid: { color: gridColor }
          }
        }
      }
    });
  }
}

// --- 7. MODAL & EVENT HANDLERS ---
function setupEventListeners() {
  // Theme Toggle
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  // Group Selector Header
  document.getElementById('groupSelect')?.addEventListener('change', (e) => {
    selectActiveGroup(e.target.value);
  });

  // Buttons for Modal Trigger
  document.getElementById('btnNewGroupHeader')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnAddNewGroupTab')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnEditCurrentGroup')?.addEventListener('click', () => openEditGroupModal(appState.activeGroupId));
  document.getElementById('btnAddPeriod')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('fabAddPeriod')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('btnEmptyAdd')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('btnExportMenu')?.addEventListener('click', () => openModal('exportModal'));

  // Close Modals
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabTarget}`)?.classList.add('active');
      
      if (tabTarget === 'analytics') {
        setTimeout(renderCharts, 50);
      }
    });
  });

  // Payment Form Submit
  document.getElementById('paymentForm')?.addEventListener('submit', handlePaymentFormSubmit);
  
  // Group Form Submit
  document.getElementById('groupForm')?.addEventListener('submit', handleGroupFormSubmit);

  // Filter & Search Inputs
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    renderPaymentsTable();
  });

  document.getElementById('filterStatus')?.addEventListener('change', (e) => {
    appState.filterStatus = e.target.value;
    renderPaymentsTable();
  });

  // Currency Live Formatting & Real-time Calc Preview
  setupCurrencyInputListeners();

  // Quick Bid Presets in Payment Modal
  document.querySelectorAll('.quick-bid-presets .btn-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const discount = Number(chip.getAttribute('data-discount'));
      const activeGroup = getActiveGroup();
      const base = activeGroup ? activeGroup.baseAmount : 5000000;
      const actual = Math.max(0, base - discount);

      const actualInput = document.getElementById('actualAmountInput');
      if (actualInput) {
        actualInput.value = new Intl.NumberFormat('vi-VN').format(actual);
        updateModalCalcPreview();
      }
    });
  });

  // Demo Data Button
  document.getElementById('btnDemoData')?.addEventListener('click', () => {
    if (confirm('Bạn có muốn nạp dữ liệu mẫu để trải nghiệm tính năng? (Dữ liệu hiện tại sẽ được cập nhật)')) {
      loadDemoData(true);
    }
  });

  // Export / Import Handlers
  document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON')?.addEventListener('click', exportJSON);
  document.getElementById('importJsonFile')?.addEventListener('change', handleImportJSON);
  document.getElementById('btnClearAllData')?.addEventListener('click', handleClearAllData);
}

// Live Input Currency Formatting & Calc Preview Setup
function setupCurrencyInputListeners() {
  const actualInput = document.getElementById('actualAmountInput');
  const groupBaseInput = document.getElementById('groupBaseAmountInput');
  const wonInput = document.getElementById('wonAmountInput');

  [actualInput, groupBaseInput, wonInput].forEach(input => {
    if (!input) return;
    input.addEventListener('input', (e) => {
      const val = parseVND(e.target.value);
      if (val === 0 && e.target.value === '') {
        e.target.value = '';
      } else {
        e.target.value = new Intl.NumberFormat('vi-VN').format(val);
      }
      if (input === actualInput) {
        updateModalCalcPreview();
      }
    });
  });
}

function updateModalCalcPreview() {
  const activeGroup = getActiveGroup();
  const base = activeGroup ? activeGroup.baseAmount : 5000000;
  const actualVal = parseVND(document.getElementById('actualAmountInput')?.value);
  const interest = base - actualVal;

  const prevBase = document.getElementById('previewBase');
  const prevActual = document.getElementById('previewActual');
  const prevInterest = document.getElementById('previewInterest');

  if (prevBase) prevBase.textContent = formatVND(base);
  if (prevActual) prevActual.textContent = formatVND(actualVal);
  if (prevInterest) {
    prevInterest.textContent = `${interest >= 0 ? '+' : ''}${formatVND(interest)}`;
    if (interest >= 0) {
      prevInterest.className = 'text-emerald';
    } else {
      prevInterest.className = 'text-rose';
    }
  }
}

// --- 8. CRUD ACTIONS ---
function selectActiveGroup(groupId) {
  appState.activeGroupId = groupId;
  saveDataToStorage();
  renderAll();
  showToast('Đã chuyển dây họ đang xem!');
}

function openPaymentModal(paymentId = null) {
  const modal = document.getElementById('paymentModal');
  const form = document.getElementById('paymentForm');
  if (!modal || !form) return;

  form.reset();

  const activeGroup = getActiveGroup();
  if (!activeGroup) {
    showToast('Vui lòng tạo Dây Họ trước khi thêm kỳ đóng!');
    return;
  }

  const baseInput = document.getElementById('baseAmountInput');
  if (baseInput) baseInput.value = new Intl.NumberFormat('vi-VN').format(activeGroup.baseAmount);

  const processed = getProcessedPayments();

  if (paymentId) {
    // Edit Mode
    const p = appState.payments.find(item => item.id === paymentId);
    if (!p) return;

    document.getElementById('paymentModalTitle').textContent = 'Chỉnh Sửa Kỳ Đóng';
    document.getElementById('paymentId').value = p.id;
    document.getElementById('periodNumber').value = p.periodNumber;
    document.getElementById('paymentDate').value = p.date || '';
    document.getElementById('actualAmountInput').value = new Intl.NumberFormat('vi-VN').format(p.actualAmount);
    document.getElementById('paymentStatus').value = p.status || 'paid';
    document.getElementById('wonAmountInput').value = p.wonAmount ? new Intl.NumberFormat('vi-VN').format(p.wonAmount) : '';
    document.getElementById('paymentNote').value = p.note || '';
  } else {
    // New Period Mode
    document.getElementById('paymentModalTitle').textContent = 'Thêm Kỳ Đóng Mới';
    document.getElementById('paymentId').value = '';
    
    // Auto increment period number
    const nextPeriod = processed.length > 0 ? Math.max(...processed.map(p => Number(p.periodNumber))) + 1 : 1;
    document.getElementById('periodNumber').value = nextPeriod;
    document.getElementById('paymentDate').valueAsDate = new Date();

    // Default sample actual amount (e.g. 10% lower bid default)
    const defaultActual = Math.round(activeGroup.baseAmount * 0.9);
    document.getElementById('actualAmountInput').value = new Intl.NumberFormat('vi-VN').format(defaultActual);
  }

  updateModalCalcPreview();
  openModal('paymentModal');
}

function handlePaymentFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('paymentId').value;
  const periodNumber = Number(document.getElementById('periodNumber').value);
  const date = document.getElementById('paymentDate').value;
  const activeGroup = getActiveGroup();
  const baseAmount = activeGroup ? activeGroup.baseAmount : 5000000;
  const actualAmount = parseVND(document.getElementById('actualAmountInput').value);
  const status = document.getElementById('paymentStatus').value;
  const wonAmount = parseVND(document.getElementById('wonAmountInput').value);
  const note = document.getElementById('paymentNote').value;

  if (id) {
    // Edit existing
    const index = appState.payments.findIndex(p => p.id === id);
    if (index !== -1) {
      appState.payments[index] = {
        ...appState.payments[index],
        periodNumber,
        date,
        baseAmount,
        actualAmount,
        status,
        wonAmount,
        note
      };
    }
  } else {
    // Add new
    const newPayment = {
      id: generateId(),
      groupId: appState.activeGroupId,
      periodNumber,
      date,
      baseAmount,
      actualAmount,
      status,
      wonAmount,
      note,
      createdAt: new Date().toISOString()
    };
    appState.payments.push(newPayment);
  }

  saveDataToStorage();
  closeModal('paymentModal');
  renderAll();
  
  triggerConfetti();
  showToast(id ? 'Đã cập nhật thông tin kỳ đóng!' : 'Đã thêm kỳ đóng thành công!');
}

window.editPayment = function(id) {
  openPaymentModal(id);
};

window.deletePayment = function(id) {
  if (confirm('Bạn có chắc chắn muốn xóa kỳ đóng này?')) {
    appState.payments = appState.payments.filter(p => p.id !== id);
    saveDataToStorage();
    renderAll();
    showToast('Đã xóa kỳ đóng!');
  }
};

// GROUP CRUD
function openGroupModal(groupId = null) {
  const form = document.getElementById('groupForm');
  if (!form) return;

  form.reset();

  if (groupId) {
    const g = appState.groups.find(item => item.id === groupId);
    if (!g) return;

    document.getElementById('groupModalTitle').textContent = 'Chỉnh Sửa Dây Họ';
    document.getElementById('groupId').value = g.id;
    document.getElementById('groupNameInput').value = g.name;
    document.getElementById('groupMemberNameInput').value = g.memberName || '';
    document.getElementById('groupBaseAmountInput').value = new Intl.NumberFormat('vi-VN').format(g.baseAmount);
    document.getElementById('groupPeriodType').value = g.periodType || 'Hàng tháng';
    document.getElementById('groupTotalPeriods').value = g.totalPeriods || 12;
    document.getElementById('groupStartDate').value = g.startDate || '';
    document.getElementById('groupOwner').value = g.owner || '';
  } else {
    document.getElementById('groupModalTitle').textContent = 'Tạo Dây Họ Mới';
    document.getElementById('groupId').value = '';
    document.getElementById('groupMemberNameInput').value = '';
    document.getElementById('groupBaseAmountInput').value = '5.000.000';
    document.getElementById('groupTotalPeriods').value = 12;
  }

  openModal('groupModal');
}

function handleGroupFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('groupId').value;
  const name = document.getElementById('groupNameInput').value;
  const memberName = document.getElementById('groupMemberNameInput').value;
  const baseAmount = parseVND(document.getElementById('groupBaseAmountInput').value);
  const periodType = document.getElementById('groupPeriodType').value;
  const totalPeriods = Number(document.getElementById('groupTotalPeriods').value) || 12;
  const startDate = document.getElementById('groupStartDate').value;
  const owner = document.getElementById('groupOwner').value;

  if (baseAmount <= 0) {
    alert('Mức đóng chuẩn phải lớn hơn 0!');
    return;
  }

  if (id) {
    const index = appState.groups.findIndex(g => g.id === id);
    if (index !== -1) {
      appState.groups[index] = {
        ...appState.groups[index],
        name,
        memberName,
        baseAmount,
        periodType,
        totalPeriods,
        startDate,
        owner
      };
    }
  } else {
    const newGroup = {
      id: generateId(),
      name,
      memberName,
      baseAmount,
      periodType,
      totalPeriods,
      startDate,
      owner,
      createdAt: new Date().toISOString()
    };
    appState.groups.push(newGroup);
    appState.activeGroupId = newGroup.id;
  }

  saveDataToStorage();
  closeModal('groupModal');
  renderAll();
  showToast(id ? 'Đã cập nhật Dây Họ!' : 'Đã tạo Dây Họ mới!');
}

window.openEditGroupModal = function(id) {
  openGroupModal(id);
};

window.deleteGroup = function(id) {
  if (appState.groups.length <= 1) {
    alert('Bạn phải giữ lại ít nhất 1 dây họ!');
    return;
  }

  if (confirm('Bạn có chắc muốn xóa Dây Họ này và tất cả dữ liệu đóng tiền thuộc về nó?')) {
    appState.groups = appState.groups.filter(g => g.id !== id);
    appState.payments = appState.payments.filter(p => p.groupId !== id);
    appState.activeGroupId = appState.groups[0].id;
    saveDataToStorage();
    renderAll();
    showToast('Đã xóa Dây Họ!');
  }
};

window.selectActiveGroup = function(id) {
  selectActiveGroup(id);
};

// --- 9. DEMO DATA GENERATOR ---
function loadDemoData(notify = true) {
  const demoGroupId = 'demo_group_5m';
  
  appState.groups = [
    {
      id: demoGroupId,
      name: 'Dây Họ 5 Triệu (Tháng)',
      memberName: 'Nguyễn Văn Tuấn (Tôi)',
      baseAmount: 5000000,
      periodType: 'Hàng tháng',
      totalPeriods: 12,
      startDate: '2024-01-01',
      owner: 'Chị Lan - Chợ Xóm Mới'
    },
    {
      id: 'demo_group_10m',
      name: 'Dây Hụi 10 Triệu Công Ty',
      memberName: 'Trần Thị Mai',
      baseAmount: 10000000,
      periodType: 'Hàng tháng',
      totalPeriods: 10,
      startDate: '2024-03-01',
      owner: 'Anh Hùng Kế Toán'
    }
  ];

  // User example: Base 5M, paid 4.5M -> 500k interest
  appState.payments = [
    { id: 'p1', groupId: demoGroupId, periodNumber: 1, date: '2024-01-15', baseAmount: 5000000, actualAmount: 4500000, status: 'paid', note: 'Tháng 1 đóng 4.5Tr -> Lãi 500k' },
    { id: 'p2', groupId: demoGroupId, periodNumber: 2, date: '2024-02-15', baseAmount: 5000000, actualAmount: 4700000, status: 'paid', note: 'Tháng 2 đóng 4.7Tr -> Lãi 300k' },
    { id: 'p3', groupId: demoGroupId, periodNumber: 3, date: '2024-03-15', baseAmount: 5000000, actualAmount: 4300000, status: 'paid', note: 'Tháng 3 đóng 4.3Tr -> Lãi 700k' },
    { id: 'p4', groupId: demoGroupId, periodNumber: 4, date: '2024-04-15', baseAmount: 5000000, actualAmount: 4600000, status: 'paid', note: 'Tháng 4 đóng 4.6Tr -> Lãi 400k' },
    { id: 'p5', groupId: demoGroupId, periodNumber: 5, date: '2024-05-15', baseAmount: 5000000, actualAmount: 4200000, status: 'paid', note: 'Tháng 5 đóng 4.2Tr -> Lãi 800k' }
  ];

  appState.activeGroupId = demoGroupId;
  saveDataToStorage();
  renderAll();

  if (notify) {
    triggerConfetti();
    showToast('Đã nạp dữ liệu mẫu thành công!');
  }
}

// --- 10. EXPORT / IMPORT & UTILS ---
function exportCSV() {
  const processed = getProcessedPayments();
  if (processed.length === 0) {
    alert('Không có dữ liệu để xuất!');
    return;
  }

  let csvContent = '\uFEFFKỳ số,Ngày đóng,Mức chuẩn (VNĐ),Thực đóng (VNĐ),Tiền lãi tháng (VNĐ),Lãi cộng dồn (VNĐ),Trạng thái,Ghi chú\n';

  processed.forEach(p => {
    const row = [
      p.periodNumber,
      p.date || '',
      p.baseAmount,
      p.actualAmount,
      p.monthlyInterest,
      p.cumulativeInterest,
      p.status === 'paid' ? 'Đã đóng' : p.status === 'won' ? 'Đã hốt' : 'Chưa đóng',
      `"${(p.note || '').replace(/"/g, '""')}"`
    ];
    csvContent += row.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const activeGroup = getActiveGroup();
  link.setAttribute('href', url);
  link.setAttribute('download', `So_Ho_${(activeGroup ? activeGroup.name : 'Data').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Đã xuất file CSV Excel thành công!');
}

function exportJSON() {
  const data = {
    groups: appState.groups,
    payments: appState.payments,
    exportDate: new Date().toISOString()
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Backup_So_Ho_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Đã tải file Backup JSON thành công!');
}

function handleImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed.groups && Array.isArray(parsed.groups)) {
        appState.groups = parsed.groups;
        appState.payments = parsed.payments || [];
        appState.activeGroupId = appState.groups[0]?.id || null;
        saveDataToStorage();
        renderAll();
        closeModal('exportModal');
        triggerConfetti();
        showToast('Khôi phục dữ liệu từ JSON thành công!');
      } else {
        alert('File JSON không hợp lệ!');
      }
    } catch (err) {
      alert('Không thể đọc file JSON!');
    }
  };
  reader.readAsText(file);
}

function handleClearAllData() {
  if (confirm('CẢNH BÁO: Xóa tất cả dữ liệu? Hành động này không thể hoàn tác!')) {
    localStorage.clear();
    appState.groups = [];
    appState.payments = [];
    appState.activeGroupId = null;
    loadDemoData(false);
    closeModal('exportModal');
    showToast('Đã khôi phục dữ liệu về mặc định!');
  }
}

// Modal Helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

// Toast Helper
function showToast(message) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMessage');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);
}

// Confetti Celebration Helper
function triggerConfetti() {
  if (window.confetti) {
    window.confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.8 }
    });
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', initApp);
