/* ==========================================================================
   MAIN JAVASCRIPT - SỔ QUẢN LÝ TIỀN HỌ & TÍNH LÃI CỘNG DỒN
   ========================================================================== */

// --- 1. STATE & STORAGE MANAGEMENT ---
const STORAGE_KEY_GROUPS = 'quanlyho_groups_v1';
const STORAGE_KEY_PAYMENTS = 'quanlyho_payments_v1';
const STORAGE_KEY_ACTIVE_GROUP = 'quanlyho_active_group_v1';
const STORAGE_KEY_THEME = 'quanlyho_theme_v1';
const STORAGE_KEY_SYNC_KEY = 'quanlyho_sync_key_v1';
const STORAGE_KEY_UPDATED_AT = 'quanlyho_updated_at_v1';

let appState = {
  groups: [],
  payments: [],
  activeGroupId: null,
  selectedUserTab: 'ALL', // 'ALL' or memberName
  syncKey: '',
  theme: 'dark',
  filterStatus: 'all',
  searchQuery: '',
  searchGroupQuery: '',
  lastUpdatedAt: null
};

let cloudSyncTimer = null;
let isSyncing = false;

let confirmModalCallback = null;

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

  // Check URL parameter for automatic mobile sync (?sync=KEY)
  const urlParams = new URLSearchParams(window.location.search);
  const urlSyncKey = urlParams.get('sync');
  if (urlSyncKey && urlSyncKey.trim()) {
    appState.syncKey = urlSyncKey.trim();
    localStorage.setItem(STORAGE_KEY_SYNC_KEY, appState.syncKey);
  } else if (!appState.syncKey) {
    appState.syncKey = 'tuyendz169'; // Default User Sync Key
  }

  // Render initial local state immediately
  renderAll();

  // Smart Cloud Sync on startup
  if (appState.syncKey) {
    syncOnStartup();
  } else if (!appState.groups || appState.groups.length === 0) {
    loadDemoData(false);
    renderAll();
  }

  // Start background auto-sync engine
  startAutoSyncEngine();
}

function loadDataFromStorage() {
  try {
    const storedGroups = localStorage.getItem(STORAGE_KEY_GROUPS);
    const storedPayments = localStorage.getItem(STORAGE_KEY_PAYMENTS);
    const storedActiveGroup = localStorage.getItem(STORAGE_KEY_ACTIVE_GROUP);
    const storedTheme = localStorage.getItem(STORAGE_KEY_THEME);
    const storedSyncKey = localStorage.getItem(STORAGE_KEY_SYNC_KEY);
    const storedUpdatedAt = localStorage.getItem(STORAGE_KEY_UPDATED_AT);

    if (storedGroups) {
      appState.groups = JSON.parse(storedGroups);
      if (Array.isArray(appState.groups)) {
        appState.groups.forEach((g, idx) => {
          if (!g.memberName || !g.memberName.trim()) {
            g.memberName = `Người dùng ${idx + 1}`;
          }
        });
      } else {
        appState.groups = [];
      }
    }

    if (storedPayments) appState.payments = JSON.parse(storedPayments);
    if (storedActiveGroup) appState.activeGroupId = storedActiveGroup;
    if (storedTheme) appState.theme = storedTheme;
    if (storedSyncKey) appState.syncKey = storedSyncKey;

    if (storedUpdatedAt) {
      appState.lastUpdatedAt = storedUpdatedAt;
    } else if (appState.groups && appState.groups.length > 0) {
      appState.lastUpdatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_UPDATED_AT, appState.lastUpdatedAt);
    }
  } catch (e) {
    console.error('Lỗi khi tải dữ liệu từ localStorage:', e);
    appState.groups = [];
    appState.payments = [];
  }
}

async function syncOnStartup() {
  if (!appState.syncKey) return;

  updateCloudStatusBadge('syncing');

  try {
    const indexObj = await fetchCloudIndex();
    const remoteRecord = indexObj.data ? indexObj.data[appState.syncKey] : null;

    const hasLocalData = appState.groups && appState.groups.length > 0;
    const hasRemoteData = remoteRecord && remoteRecord.groups && Array.isArray(remoteRecord.groups) && remoteRecord.groups.length > 0;

    const remoteTime = (hasRemoteData && remoteRecord.updatedAt) ? new Date(remoteRecord.updatedAt).getTime() : 0;
    const localTime = appState.lastUpdatedAt ? new Date(appState.lastUpdatedAt).getTime() : 0;

    if (hasLocalData && hasRemoteData) {
      if (remoteTime > localTime) {
        await pullDataFromCloud(false, true);
      } else {
        await pushDataToCloud(false);
      }
    } else if (hasLocalData && !hasRemoteData) {
      await pushDataToCloud(false);
    } else if (!hasLocalData && hasRemoteData) {
      await pullDataFromCloud(false, true);
    } else {
      loadDemoData(false);
      renderAll();
      await pushDataToCloud(false);
    }

    updateCloudStatusBadge('synced');
  } catch (err) {
    console.warn('Startup sync error:', err);
    updateCloudStatusBadge('synced');
  }
}

function saveDataToStorage(triggerPush = true) {
  appState.lastUpdatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(appState.groups));
    localStorage.setItem(STORAGE_KEY_PAYMENTS, JSON.stringify(appState.payments));
    localStorage.setItem(STORAGE_KEY_ACTIVE_GROUP, appState.activeGroupId || '');
    localStorage.setItem(STORAGE_KEY_THEME, appState.theme);
    localStorage.setItem(STORAGE_KEY_SYNC_KEY, appState.syncKey || '');
    localStorage.setItem(STORAGE_KEY_UPDATED_AT, appState.lastUpdatedAt);
  } catch (e) {
    console.error('Lỗi khi lưu dữ liệu vào localStorage:', e);
  }

  if (triggerPush) {
    triggerCloudAutoPush();
  }
}

// --- CLOUD MULTI-DEVICE SYNC ENGINE ---
const GLOBAL_CLOUD_INDEX_ID = 'ff8081819ff5b11001a032a3fd850a49';
const CLOUD_API_ENDPOINT = `https://api.restful-api.dev/objects/${GLOBAL_CLOUD_INDEX_ID}`;

function updateCloudStatusBadge(status, errorMsg = '') {
  const textEl = document.getElementById('cloudStatusText');
  const btn = document.getElementById('btnCloudSync');
  if (!textEl || !btn) return;

  if (status === 'synced') {
    textEl.textContent = 'Cloud: Đã lưu';
    btn.className = 'btn btn-sm btn-outline-warning';
    btn.title = 'Đồng bộ Cloud (Đã lưu dữ liệu mới nhất)';
  } else if (status === 'syncing') {
    textEl.textContent = 'Cloud: Đang lưu...';
    btn.className = 'btn btn-sm btn-outline-warning';
    btn.title = 'Đang đồng bộ dữ liệu...';
  } else if (status === 'error') {
    textEl.textContent = 'Cloud: Thử lại';
    btn.className = 'btn btn-sm btn-danger';
    btn.title = errorMsg || 'Lỗi kết nối Cloud. Bấm để thử lại.';
  } else {
    textEl.textContent = 'Đồng bộ Cloud';
    btn.className = 'btn btn-sm btn-primary';
  }
}

function triggerCloudAutoPush() {
  if (!appState.syncKey) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    pushDataToCloud(false);
  }, 800);
}

async function fetchCloudIndex() {
  const res = await fetch(CLOUD_API_ENDPOINT, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  const json = await res.json();
  return {
    name: json.name || 'quanlytienho_global_sync_v1',
    data: json.data || {}
  };
}

async function pushDataToCloud(notify = false) {
  if (!appState.syncKey) {
    if (notify) alert('Vui lòng nhập Mã Đồng Bộ trước!');
    return false;
  }

  if (isSyncing) return false;
  isSyncing = true;
  updateCloudStatusBadge('syncing');

  const nowIso = new Date().toISOString();
  appState.lastUpdatedAt = nowIso;
  try {
    localStorage.setItem(STORAGE_KEY_UPDATED_AT, nowIso);
  } catch (e) {}

  const payload = {
    syncKey: appState.syncKey,
    groups: appState.groups,
    payments: appState.payments,
    updatedAt: nowIso
  };

  try {
    let indexObj;
    try {
      indexObj = await fetchCloudIndex();
    } catch (e) {
      indexObj = { name: 'quanlytienho_global_sync_v1', data: {} };
    }

    if (!indexObj.data) indexObj.data = {};
    indexObj.data[appState.syncKey] = payload;

    const putRes = await fetch(CLOUD_API_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        name: indexObj.name,
        data: indexObj.data
      })
    });

    if (!putRes.ok) {
      throw new Error(`Cập nhật Cloud thất bại (${putRes.status})`);
    }

    updateCloudStatusBadge('synced');
    if (notify) showToast('✅ Đã lưu dữ liệu lên Cloud thành công!');
    isSyncing = false;
    return true;
  } catch (err) {
    console.error('Cloud Push error:', err);
    updateCloudStatusBadge('error', 'Lỗi kết nối Cloud');
    if (notify) showToast('❌ Lỗi kết nối Cloud: ' + err.message);
    isSyncing = false;
    return false;
  }
}

async function pullDataFromCloud(notify = false, forceReplace = false) {
  if (!appState.syncKey) return false;

  updateCloudStatusBadge('syncing');

  try {
    const indexObj = await fetchCloudIndex();
    const remoteRecord = indexObj.data ? indexObj.data[appState.syncKey] : null;

    if (remoteRecord && remoteRecord.groups && Array.isArray(remoteRecord.groups) && remoteRecord.groups.length > 0) {
      const remoteTime = remoteRecord.updatedAt ? new Date(remoteRecord.updatedAt).getTime() : 0;
      const localTime = appState.lastUpdatedAt ? new Date(appState.lastUpdatedAt).getTime() : 0;

      if (forceReplace || remoteTime > localTime || !appState.groups || appState.groups.length === 0) {
        const previousActive = appState.activeGroupId;
        appState.groups = remoteRecord.groups;
        appState.payments = remoteRecord.payments || [];
        appState.lastUpdatedAt = remoteRecord.updatedAt || new Date().toISOString();

        if (!appState.groups.some(g => g.id === appState.activeGroupId)) {
          if (previousActive && appState.groups.some(g => g.id === previousActive)) {
            appState.activeGroupId = previousActive;
          } else {
            appState.activeGroupId = appState.groups[0]?.id || null;
          }
        }

        saveDataToStorage(false);
        renderAll();
        updateCloudStatusBadge('synced');
        if (notify) {
          showToast('📱 Đã đồng bộ dữ liệu mới nhất từ Cloud!');
        }
        return true;
      }
    } else {
      if (appState.groups && appState.groups.length > 0) {
        await pushDataToCloud(false);
      }
    }
    updateCloudStatusBadge('synced');
    return true;
  } catch (err) {
    console.warn('Cloud Pull error:', err);
    updateCloudStatusBadge('synced');
    if (notify) showToast('⚠️ Không thể tải từ Cloud: ' + err.message);
    return false;
  }
}

function startAutoSyncEngine() {
  setInterval(() => {
    if (document.visibilityState === 'visible' && appState.syncKey && !isSyncing) {
      pullDataFromCloud(false, false);
    }
  }, 8000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && appState.syncKey && !isSyncing) {
      pullDataFromCloud(false, false);
    }
  });

  window.addEventListener('focus', () => {
    if (appState.syncKey && !isSyncing) {
      pullDataFromCloud(false, false);
    }
  });
}

function openCloudSyncModal(triggerPush = false) {
  closeModal('exportModal');

  const keyInput = document.getElementById('syncKeyInput');
  if (!appState.syncKey) {
    appState.syncKey = 'tuyendz169';
  }
  if (keyInput) keyInput.value = appState.syncKey;

  updateCloudQRCode();
  openModal('cloudModal');

  if (triggerPush && appState.syncKey) {
    pushDataToCloud(true);
  }
}

function updateCloudQRCode() {
  const qrImg = document.getElementById('qrCodeImg');
  const keyInput = document.getElementById('syncKeyInput');
  const currentKey = keyInput ? keyInput.value.trim() : appState.syncKey;
  if (!qrImg || !currentKey) return;
  const shareURL = `${window.location.origin}${window.location.pathname}?sync=${encodeURIComponent(currentKey)}`;
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shareURL)}`;
}

window.openCloudSyncModal = function (triggerPush = false) {
  openCloudSyncModal(triggerPush);
};

// --- 3. THEME MANAGEMENT ---
function initTheme() {
  document.documentElement.setAttribute('data-theme', appState.theme);
}

function toggleTheme() {
  appState.theme = appState.theme === 'dark' ? 'light' : 'dark';
  initTheme();
  saveDataToStorage();
  renderCharts();
  showToast(`Đã chuyển sang giao diện ${appState.theme === 'dark' ? 'Tối' : 'Sáng'}`);
}

// --- 4. CORE COMPUTATION & CALCULATIONS ---
function getActiveGroup() {
  if (!appState.groups || appState.groups.length === 0) return null;
  return appState.groups.find(g => g.id === appState.activeGroupId) || appState.groups[0];
}

function getActivePayments() {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return [];
  return appState.payments
    .filter(p => p.groupId === activeGroup.id)
    .sort((a, b) => Number(a.periodNumber) - Number(b.periodNumber));
}

// Compute Cumulative Interest per period chronologically
function getProcessedPayments() {
  const rawPayments = getActivePayments();
  let cumulativeInterest = 0;

  return rawPayments.map(payment => {
    const base = Number(payment.baseAmount) || 0;
    const actual = Number(payment.actualAmount) || 0;
    const monthlyInterest = base - actual;

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
  // Guarantee demo data if state is empty
  if (!appState.groups || appState.groups.length === 0) {
    loadDemoData(false);
    return;
  }

  renderUserTabs();
  renderSidebarGroupList();
  renderGroupSelect();
  renderGroupBanner();
  renderKPIs();
  updateTakePotCalculation();
  renderPaymentsTable();
  renderGroupListTab();
  renderCharts();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderUserTabs() {
  const container = document.getElementById('userSidebarList');
  if (!container) return;

  if (!appState.groups || appState.groups.length === 0) {
    loadDemoData(false);
  }

  // Extract unique member names with fallback
  const userMap = {};
  appState.groups.forEach((g, idx) => {
    let name = (g.memberName && typeof g.memberName === 'string' && g.memberName.trim()) ? g.memberName.trim() : '';
    if (!name) {
      name = `Người dùng ${idx + 1}`;
      g.memberName = name;
    }
    userMap[name] = (userMap[name] || 0) + 1;
  });

  const uniqueUsers = Object.keys(userMap);
  const totalGroups = appState.groups.length;

  container.innerHTML = '';

  // 1. "Tất cả người dùng" Button
  const allBtn = document.createElement('button');
  allBtn.className = `sidebar-user-item ${appState.selectedUserTab === 'ALL' ? 'active' : ''}`;
  allBtn.innerHTML = `
    <span><i data-lucide="users"></i> Tất cả người dùng</span>
    <span class="sidebar-user-badge">${totalGroups}</span>
  `;
  allBtn.onclick = () => selectUserTab('ALL');
  container.appendChild(allBtn);

  // 2. Individual User Items
  uniqueUsers.forEach(uName => {
    const isSelected = appState.selectedUserTab === uName;
    const count = userMap[uName];

    const userBtn = document.createElement('button');
    userBtn.className = `sidebar-user-item ${isSelected ? 'active' : ''}`;
    userBtn.innerHTML = `
      <span><i data-lucide="user"></i> ${uName}</span>
      <span class="sidebar-user-badge">${count} dây</span>
    `;
    userBtn.onclick = () => selectUserTab(uName);
    container.appendChild(userBtn);
  });
}

function renderSidebarGroupList() {
  const container = document.getElementById('sidebarGroupList');
  const titleEl = document.getElementById('sidebarGroupListTitle');
  if (!container) return;

  if (titleEl) {
    const label = appState.selectedUserTab === 'ALL' ? 'DÂY HỌ (TẤT CẢ)' : `DÂY HỌ (${appState.selectedUserTab})`;
    titleEl.innerHTML = `<i data-lucide="layers"></i> ${label}`;
  }

  let groupsToRender = appState.groups;
  if (appState.selectedUserTab !== 'ALL') {
    groupsToRender = appState.groups.filter(g => (g.memberName || '').trim() === appState.selectedUserTab);
  }

  container.innerHTML = '';

  if (groupsToRender.length === 0) {
    container.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); padding: 8px 0;">Chưa có dây họ nào</div>`;
    return;
  }

  groupsToRender.forEach(g => {
    const isCurrent = g.id === appState.activeGroupId;
    const groupPayments = appState.payments.filter(p => p.groupId === g.id);
    const paidCount = groupPayments.filter(p => p.status === 'paid' || p.status === 'won').length;

    const item = document.createElement('div');
    item.className = `sidebar-group-item ${isCurrent ? 'active' : ''}`;
    item.onclick = (e) => {
      if (e.target.closest('.s-group-actions')) return;
      selectActiveGroup(g.id);
    };

    item.innerHTML = `
      <div class="s-group-top">
        <span class="s-group-title">${g.name}</span>
        ${isCurrent ? '<span class="badge-status status-paid" style="font-size:0.7rem; padding:2px 6px;">Đang chọn</span>' : ''}
      </div>
      <div class="s-group-meta">
        <span>${formatVND(g.baseAmount)}</span>
        <span>${paidCount}/${g.totalPeriods || 12} kỳ</span>
      </div>
      <div class="s-group-actions mt-1" style="display:flex; justify-content:flex-end; gap:4px;">
        <button class="btn btn-icon btn-ghost btn-sm" onclick="event.stopPropagation(); openEditGroupModal('${g.id}')" title="Sửa dây này">
          <i data-lucide="edit-2" style="width:14px; height:14px;"></i>
        </button>
        ${appState.groups.length > 1 ? `
          <button class="btn btn-icon btn-ghost btn-sm text-rose" onclick="event.stopPropagation(); deleteGroup('${g.id}')" title="Xóa dây này">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
          </button>
        ` : ''}
      </div>
    `;
    container.appendChild(item);
  });
}

function renderGroupSelect() {
  const select = document.getElementById('groupSelect');
  if (!select) return;

  select.innerHTML = '';

  let groupsToDisplay = appState.groups;
  if (appState.selectedUserTab !== 'ALL') {
    const filtered = appState.groups.filter(g => {
      const name = (g.memberName && g.memberName.trim()) ? g.memberName.trim() : 'Người dùng';
      return name === appState.selectedUserTab;
    });
    if (filtered.length > 0) {
      groupsToDisplay = filtered;
    }
  }

  if (!groupsToDisplay || groupsToDisplay.length === 0) {
    groupsToDisplay = appState.groups;
  }

  if (!groupsToDisplay || groupsToDisplay.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '-- Chưa có Dây Họ --';
    select.appendChild(option);
    return;
  }

  groupsToDisplay.forEach((g, idx) => {
    const option = document.createElement('option');
    option.value = g.id;
    const memberStr = (g.memberName && g.memberName.trim()) ? g.memberName.trim() : `Người dùng ${idx + 1}`;
    option.textContent = `👤 ${memberStr} | ${g.name} (${formatVND(g.baseAmount)})`;
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

// --- "NẾU LẤY HỌ" CALCULATOR ENGINE ---
function initTakePotCalculator() {
  const periodSelect = document.getElementById('takePotPeriodSelect');
  const bidInput = document.getElementById('takePotBidInput');

  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      updateTakePotCalculation();
    });
  }

  if (bidInput) {
    bidInput.addEventListener('input', (e) => {
      const rawVal = parseVND(e.target.value);
      if (rawVal === 0 && e.target.value === '') {
        e.target.value = '';
      } else {
        e.target.value = new Intl.NumberFormat('vi-VN').format(rawVal);
      }
      updateTakePotCalculation();
    });
  }
}

function updateTakePotCalculation() {
  const activeGroup = getActiveGroup();
  const periodSelect = document.getElementById('takePotPeriodSelect');
  const bidInput = document.getElementById('takePotBidInput');

  if (!activeGroup) return;

  const totalPeriods = Number(activeGroup.totalPeriods) || 30;
  const baseAmount = Number(activeGroup.baseAmount) || 5000000;
  const payments = getActivePayments();
  const paidPayments = payments.filter(p => p.status === 'paid' || p.status === 'won');
  const paidCount = paidPayments.length;

  // Populate periodSelect options if totalPeriods changed
  if (periodSelect) {
    if (periodSelect.options.length !== totalPeriods) {
      periodSelect.innerHTML = '';
      for (let i = 1; i <= totalPeriods; i++) {
        const option = document.createElement('option');
        option.value = i;
        const isNext = (i === Math.min(totalPeriods, paidCount + 1));
        option.textContent = `Kỳ ${i}${isNext ? ' (Kỳ tiếp theo)' : ''}`;
        periodSelect.appendChild(option);
      }
      // Default selected option: paidCount + 1
      const defaultPeriod = Math.min(totalPeriods, paidCount + 1);
      periodSelect.value = defaultPeriod;
    }
  }

  // Target period selected
  const targetPeriod = periodSelect ? (parseInt(periodSelect.value, 10) || Math.min(totalPeriods, paidCount + 1)) : Math.min(totalPeriods, paidCount + 1);

  // Set default bid input value if empty
  if (bidInput && !bidInput.value.trim()) {
    const defaultBid = Math.max(0, baseAmount - 300000);
    bidInput.value = new Intl.NumberFormat('vi-VN').format(defaultBid);
  }

  const bidAmount = parseVND(bidInput?.value);

  // Math formula breakdown:
  // Dead periods count = targetPeriod - 1
  const deadPeriodsCount = Math.max(0, targetPeriod - 1);
  const deadBaseTotal = deadPeriodsCount * baseAmount;

  // Live periods multiplier = max(0, totalPeriods - targetPeriod - 1)
  // E.g. 30 total periods, taking at period 25 -> 30 - 25 - 1 = 4 live periods
  const liveMultiplier = Math.max(0, totalPeriods - targetPeriod - 1);
  const liveTotal = bidAmount * liveMultiplier;

  const totalReceived = deadBaseTotal + liveTotal;

  // Update DOM elements
  const badgeEl = document.getElementById('takePotTargetPeriodBadge');
  const deadCountEl = document.getElementById('takePotDeadPeriodsCount');
  const deadBaseEl = document.getElementById('takePotDeadBaseTotal');
  const liveCountEl = document.getElementById('takePotLivePeriodsCount');
  const liveMultEl = document.getElementById('takePotLiveMultiplier');
  const bidDisplayEl = document.getElementById('takePotBidDisplay');
  const liveTotalEl = document.getElementById('takePotLiveTotal');
  const totalReceivedEl = document.getElementById('takePotTotalReceived');

  if (badgeEl) badgeEl.textContent = `Kỳ ${targetPeriod} / ${totalPeriods}`;
  if (deadCountEl) deadCountEl.textContent = deadPeriodsCount;
  if (deadBaseEl) deadBaseEl.textContent = formatVND(deadBaseTotal);
  if (liveCountEl) liveCountEl.textContent = liveMultiplier;
  if (liveMultEl) liveMultEl.textContent = liveMultiplier;
  if (bidDisplayEl) bidDisplayEl.textContent = formatVND(bidAmount);
  if (liveTotalEl) liveTotalEl.textContent = formatVND(liveTotal);
  if (totalReceivedEl) totalReceivedEl.textContent = formatVND(totalReceived);
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

  // Filter groups by selectedUserTab AND searchGroupQuery
  let groupsToRender = appState.groups;

  if (appState.selectedUserTab !== 'ALL') {
    groupsToRender = groupsToRender.filter(g => (g.memberName || 'Chưa đặt tên') === appState.selectedUserTab);
  }

  if (appState.searchGroupQuery) {
    const q = appState.searchGroupQuery.toLowerCase();
    groupsToRender = groupsToRender.filter(g =>
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
  try {
    if (typeof Chart === 'undefined') return;

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
  } catch (err) {
    console.warn('Chart rendering caught exception silently:', err);
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

  // Cloud Sync Buttons
  document.getElementById('btnCloudSync')?.addEventListener('click', (e) => {
    e.preventDefault();
    openCloudSyncModal(true);
  });
  document.getElementById('btnPushToCloud')?.addEventListener('click', () => pushDataToCloud(true));
  document.getElementById('btnPullFromCloud')?.addEventListener('click', () => pullDataFromCloud(true, true));
  document.getElementById('syncKeyInput')?.addEventListener('input', () => updateCloudQRCode());
  document.getElementById('btnConnectSyncKey')?.addEventListener('click', async () => {
    const inputVal = document.getElementById('syncKeyInput')?.value;
    if (inputVal && inputVal.trim()) {
      appState.syncKey = inputVal.trim();
      saveDataToStorage(false);
      updateCloudQRCode();
      showToast('Đang kết nối Mã Đồng Bộ: ' + appState.syncKey + '...');
      const success = await pullDataFromCloud(true, true);
      if (success) {
        closeModal('cloudModal');
      }
    } else {
      alert('Vui lòng nhập Mã Đồng Bộ!');
    }
  });

  // Buttons for Modal Trigger
  document.getElementById('btnNewGroupHeader')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnSidebarAddUser')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnSidebarAddGroup')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnAddNewGroupTab')?.addEventListener('click', () => openGroupModal());
  document.getElementById('btnEditCurrentGroup')?.addEventListener('click', () => openEditGroupModal(appState.activeGroupId));
  document.getElementById('btnAddPeriod')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('fabAddPeriod')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('btnEmptyAdd')?.addEventListener('click', () => openPaymentModal());
  document.getElementById('btnExportMenu')?.addEventListener('click', () => openModal('exportModal'));

  // "Nếu Lấy Họ" Calculator Input & Select Listeners
  initTakePotCalculator();

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
  document.getElementById('importBackupFile')?.addEventListener('change', handleImportBackup);
  document.getElementById('importJsonFile')?.addEventListener('change', handleImportBackup);
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

window.editPayment = function (id) {
  openPaymentModal(id);
};

// --- CUSTOM CENTERED CONFIRMATION POPUP ---
function showCustomConfirmModal({ title = 'Xác Nhận Xóa', message = 'Bạn có chắc chắn muốn xóa mục này?', onConfirm }) {
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMessage');

  if (!modal) return;

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  confirmModalCallback = onConfirm;
  openModal('confirmModal');
}

// Setup Confirm Modal Buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnCancelConfirm')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmModalCallback = null;
  });

  document.getElementById('btnAcceptConfirm')?.addEventListener('click', () => {
    if (typeof confirmModalCallback === 'function') {
      confirmModalCallback();
    }
    closeModal('confirmModal');
    confirmModalCallback = null;
  });
});
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
      // Pre-fill member name if a specific user tab is currently selected
      const defaultUser = (appState.selectedUserTab && appState.selectedUserTab !== 'ALL') ? appState.selectedUserTab : '';
      document.getElementById('groupMemberNameInput').value = defaultUser;
      document.getElementById('groupBaseAmountInput').value = '5.000.000';
      document.getElementById('groupTotalPeriods').value = 12;
    }

    openModal('groupModal');
  }

  function handleGroupFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('groupId').value;
    const name = document.getElementById('groupNameInput').value;
    let rawMemberName = document.getElementById('groupMemberNameInput').value;

    // Ensure non-empty memberName
    const memberName = (rawMemberName && rawMemberName.trim()) ? rawMemberName.trim() : `Người dùng ${appState.groups.length + 1}`;

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

    // Switch focus to the saved user tab
    appState.selectedUserTab = memberName;

    saveDataToStorage();
    closeModal('groupModal');
    renderAll();
    showToast(id ? 'Đã cập nhật Dây Họ!' : 'Đã tạo Dây Họ mới!');
  }

  window.openEditGroupModal = function (id) {
    openGroupModal(id);
  };

  window.deletePayment = function (id) {
    const p = appState.payments.find(item => item.id === id);
    const periodStr = p ? `Kỳ số ${p.periodNumber}` : 'kỳ đóng này';

    showCustomConfirmModal({
      title: 'Xóa Kỳ Đóng Tiền',
      message: `Bạn có chắc chắn muốn xóa ${periodStr}? Tất cả dữ liệu đóng tiền và lãi của kỳ này sẽ bị xóa.`,
      onConfirm: () => {
        appState.payments = appState.payments.filter(item => item.id !== id);
        saveDataToStorage();
        renderAll();
        showToast('Đã xóa kỳ đóng!');
      }
    });
  };

  window.deleteGroup = function (id) {
    if (appState.groups.length <= 1) {
      alert('Bạn phải giữ lại ít nhất 1 dây họ!');
      return;
    }

    const group = appState.groups.find(g => g.id === id);
    const groupName = group ? group.name : 'dây họ này';

    showCustomConfirmModal({
      title: 'Xóa Dây Họ',
      message: `Bạn có chắc chắn muốn xóa "${groupName}"? Tất cả lịch sử đóng tiền thuộc dây họ này sẽ bị xóa vĩnh viễn.`,
      onConfirm: () => {
        appState.groups = appState.groups.filter(g => g.id !== id);
        appState.payments = appState.payments.filter(p => p.groupId !== id);
        appState.activeGroupId = appState.groups[0].id;
        saveDataToStorage();
        renderAll();
        showToast('Đã xóa Dây Họ!');
      }
    });
  };

  window.selectActiveGroup = function (id) {
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
    link.setAttribute('download', `So_Ho_${(activeGroup ? activeGroup.name : 'Data').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
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
    link.setAttribute('download', `Backup_So_Ho_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Đã tải file Backup JSON thành công!');
  }

  function parseCSVText(text) {
    if (text.startsWith('\uFEFF')) {
      text = text.slice(1);
    }
    const lines = [];
    let currentRow = [];
    let currentVal = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentVal.trim());
        if (currentRow.some(cell => cell.length > 0)) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }

    if (currentVal.trim() || currentRow.length > 0) {
      currentRow.push(currentVal.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        lines.push(currentRow);
      }
    }

    return lines;
  }

  function handleImportBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      const fileName = file.name.toLowerCase();

      // Check if JSON
      if (fileName.endsWith('.json') || content.trim().startsWith('{') || content.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.groups && Array.isArray(parsed.groups)) {
            appState.groups = parsed.groups;
            appState.payments = parsed.payments || [];
            appState.activeGroupId = appState.groups[0]?.id || null;
            saveDataToStorage();
            renderAll();
            closeModal('exportModal');
            triggerConfetti();
            showToast('✅ Khôi phục dữ liệu từ file JSON thành công!');
            return;
          }
        } catch (err) {
          // Fall through to try parsing as CSV if JSON fails
        }
      }

      // Process as CSV
      try {
        const rows = parseCSVText(content);
        if (rows.length < 2) {
          alert('File CSV không có dữ liệu hợp lệ!');
          return;
        }

        // Determine column indexes from header (first row)
        const header = rows[0].map(h => h.toLowerCase());
        let periodIdx = header.findIndex(h => h.includes('kỳ') || h.includes('period'));
        let dateIdx = header.findIndex(h => h.includes('ngày') || h.includes('date'));
        let baseIdx = header.findIndex(h => h.includes('chuẩn') || h.includes('mức') || h.includes('base'));
        let actualIdx = header.findIndex(h => h.includes('thực') || h.includes('đóng') || h.includes('actual'));
        let statusIdx = header.findIndex(h => h.includes('trạng thái') || h.includes('status'));
        let noteIdx = header.findIndex(h => h.includes('ghi chú') || h.includes('note'));

        // Fallbacks if header wasn't matched
        if (periodIdx === -1) periodIdx = 0;
        if (dateIdx === -1) dateIdx = 1;
        if (baseIdx === -1) baseIdx = 2;
        if (actualIdx === -1) actualIdx = 3;
        if (statusIdx === -1) statusIdx = 6;
        if (noteIdx === -1) noteIdx = 7;

        const importedPayments = [];
        const dataRows = rows.slice(1);

        // Ensure active group exists
        if (appState.groups.length === 0) {
          const defaultGroupId = generateId();
          const firstBase = parseVND(dataRows[0]?.[baseIdx]) || 5000000;
          appState.groups = [{
            id: defaultGroupId,
            name: 'Dây Họ Khôi Phục (CSV)',
            totalPeriods: Math.max(12, dataRows.length),
            baseAmount: firstBase,
            startDate: new Date().toISOString().slice(0, 10),
            memberCount: 12,
            note: 'Tạo tự động khi khôi phục từ file CSV'
          }];
          appState.activeGroupId = defaultGroupId;
        }

        const targetGroupId = appState.activeGroupId || appState.groups[0].id;
        let successCount = 0;

        dataRows.forEach((row, index) => {
          if (!row || row.length === 0) return;
          const periodNum = parseInt(row[periodIdx], 10) || (index + 1);
          const date = row[dateIdx] || new Date().toISOString().slice(0, 10);
          const baseAmount = parseVND(row[baseIdx]) || getActiveGroup()?.baseAmount || 5000000;
          const actualAmount = parseVND(row[actualIdx]) || 0;
          const statusStr = (row[statusIdx] || '').toLowerCase();
          
          let status = 'paid';
          if (statusStr.includes('hốt') || statusStr.includes('won')) {
            status = 'won';
          } else if (statusStr.includes('chưa') || statusStr.includes('unpaid')) {
            status = 'unpaid';
          }

          const note = row[noteIdx] || '';

          importedPayments.push({
            id: generateId(),
            groupId: targetGroupId,
            periodNumber: periodNum,
            date: date,
            baseAmount: baseAmount,
            actualAmount: actualAmount,
            status: status,
            note: note
          });
          successCount++;
        });

        if (successCount > 0) {
          // Append/update payments for target group
          appState.payments = appState.payments.filter(p => p.groupId !== targetGroupId).concat(importedPayments);
          saveDataToStorage();
          renderAll();
          closeModal('exportModal');
          triggerConfetti();
          showToast(`✅ Đã khôi phục ${successCount} kỳ đóng từ file CSV thành công!`);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ trong file CSV!');
        }
      } catch (err) {
        console.error('Lỗi khi đọc file CSV:', err);
        alert('Không thể đọc file CSV! Vui lòng kiểm tra lại định dạng file.');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
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
