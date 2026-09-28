const pageName = document.body.dataset.page || 'dashboard';
const state = { customers: [], units: [], rentals: [], payments: [], period: 'month', chartPeriod: '7', dashboard: null, pendingDelete: null, revenueChart: null, chartJsPromise: null };
const $ = (selector) => document.querySelector(selector);
const formatRupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const formatDate = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const formatDateOnly = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value)) : '-';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

async function api(endpoint, options = {}) {
  const response = await fetch(endpoint, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'Permintaan gagal diproses.');
  return data;
}

function setText(selector, value) { const element = $(selector); if (element) element.textContent = value; }
function refreshIcons() { window.lucide?.createIcons(); }
function showToast(message, type = 'success') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 3000);
}
function setLoading(target, message = 'Memuat data...') { if (target) target.innerHTML = `<tr><td colspan="12" class="empty">${message}</td></tr>`; }
function statusBadge(status) { return `<span class="status ${String(status).toLowerCase().replaceAll(' ', '-')}">${escapeHtml(status)}</span>`; }
function getCustomQuery() {
  const start = $('#custom-start')?.value;
  const end = $('#custom-end')?.value;
  return start && end ? `&start=${start}&end=${end}` : '';
}
function modalControl(id, open) { const dialog = $(`#${id}`); if (!dialog) return; open ? dialog.showModal() : dialog.close(); }

function navMarkup(active) {
  const links = [['dashboard', '/index.html', 'Dashboard', 'layout-dashboard'], ['rentals', '/transaksi.html', 'Transaksi', 'receipt-text'], ['units', '/unit.html', 'Unit PS', 'gamepad-2'], ['customers', '/pelanggan.html', 'Pelanggan', 'users-round'], ['payments', '/pembayaran.html', 'Pembayaran', 'wallet-cards'], ['reports', '/laporan.html', 'Laporan', 'file-chart-column']];
  return `<aside class="sidebar"><div class="brand"><span class="brand-mark"><i data-lucide="gamepad-2" aria-hidden="true"></i></span><span>PlayVora</span></div><nav class="side-nav" aria-label="Navigasi utama">${links.map(([key, href, label, icon]) => `<a class="${key === active ? 'active' : ''}" href="${href}" aria-label="${label}" title="${label}"><i class="nav-icon" data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('')}</nav><div class="sidebar-footer">Sistem akuntansi rental PlayStation</div></aside>`;
}
function loadLucideIcons() {
  if (window.lucide) { window.lucide.createIcons(); return; }
  const iconScript = document.createElement('script');
  iconScript.src = 'https://unpkg.com/lucide@latest';
  iconScript.onload = () => window.lucide?.createIcons();
  document.head.appendChild(iconScript);
}
function applyNav() { const shell = $('.app-shell'); if (shell && !shell.querySelector('.sidebar')) shell.insertAdjacentHTML('afterbegin', navMarkup(pageName)); loadLucideIcons(); }

async function renderDashboard(data) {
  state.dashboard = data;
  setText('#updated-at', `Diperbarui ${formatDate(data.updatedAt)}`);
  setText('#collected-revenue', formatRupiah(data.collectedRevenue));
  setText('#monthly-revenue', formatRupiah(data.collectedRevenue));
  setText('#total-billed', formatRupiah(data.totalBilled));
  setText('#total-receivable', formatRupiah(data.totalReceivable));
  setText('#customer-count', data.customerCount);
  setText('#transaction-count', data.transactionCount);
  setText('#completed-sessions', data.completedSessions);
  setText('#total-hours', `${Number(data.totalHours || 0).toLocaleString('id-ID')} jam`);
  setText('#average-transaction', formatRupiah(data.averageTransaction));
  setText('#payment-rate', `${data.paymentRate}% tertagih`);
  setText('#unit-available', data.unitSummary.available);
  setText('#unit-rented', data.unitSummary.rented);
  setText('#unit-maintenance', data.unitSummary.maintenance);
  renderActiveSessions(data.activeSessions || []);
  renderRecentTransactions(data.recentTransactions || []);
  ensureRevenueChartControls();
  await loadRevenueChart();
  renderBreakdown('#console-breakdown', data.consoleBreakdown || []);
  renderBreakdown('#payment-breakdown', data.paymentBreakdown || []);
    renderTopCustomers(data.topCustomers || []);
}
function renderActiveSessions(rows) {
  const target = $('#active-sessions');
  if (!target) return;
  target.innerHTML = rows.length ? rows.map((row) => `<div class="session-row"><div><b>${escapeHtml(row.nama_pelanggan)}</b><small>${escapeHtml(row.nama_unit)} · mulai ${formatDate(row.mulai_sewa)}</small></div><strong>${row.durasi_jam} jam</strong>${statusBadge(row.status)}</div>`).join('') : '<div class="empty">Tidak ada sesi yang sedang berlangsung.</div>';
}
function renderRecentTransactions(rows) {
  const target = $('#recent-transactions');
  if (!target) return;
  target.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.kode_penyewaan)}</td><td>${escapeHtml(row.nama_pelanggan)}</td><td>${escapeHtml(row.kode_unit)}</td><td>${row.durasi_jam} jam</td><td>${formatRupiah(row.total_biaya)}</td><td>${formatRupiah(row.jumlah_bayar)}</td><td>${formatRupiah(row.piutang)}</td><td>${statusBadge(row.status_pembayaran)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Belum ada transaksi.</td></tr>';
}
function formatCompactRupiah(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000) return `Rp${(amount / 1000000).toFixed(1)} jt`;
  if (amount >= 1000) return `Rp${Math.round(amount / 1000)} rb`;
  return formatRupiah(amount);
}
function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (state.chartJsPromise) return state.chartJsPromise;
  state.chartJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
    script.onload = () => resolve(window.Chart);
    script.onerror = () => reject(new Error('Library grafik gagal dimuat.'));
    document.head.appendChild(script);
  });
  return state.chartJsPromise;
}
function localDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function dateKeyToDate(key) { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day); }
function chartPeriodRange() {
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (state.chartPeriod === 'all') { start.setTime(0); return { start, end }; }
  if (state.chartPeriod === 'month') start.setDate(1);
  else start.setDate(start.getDate() - Number(state.chartPeriod) + 1);
  return { start, end };
}
function chartDateKeys(start, end) {
  const keys = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) keys.push(localDateKey(date));
  return keys;
}
function renderRevenueEmpty(message = 'Belum ada data pendapatan pada periode ini') {
  const target = $('#revenue-chart');
  if (!target) return;
  state.revenueChart?.destroy(); state.revenueChart = null;
  target.classList.add('chart-empty-state');
  target.innerHTML = `<div class="chart-empty"><i data-lucide="chart-no-axes-column-increasing"></i><b>${message}</b><small>Data akan muncul setelah transaksi tersedia.</small></div>`;
  refreshIcons();
}
function ensureRevenueChartControls() {
  const chart = $('#revenue-chart');
  if (!chart) return;
  const heading = chart.closest('.card')?.querySelector('.card-head h3');
  if (heading) heading.textContent = 'Perkembangan Pendapatan';
  const cardHead = chart.closest('.card')?.querySelector('.card-head');
  if (!cardHead || cardHead.querySelector('.chart-periods')) return;
  cardHead.insertAdjacentHTML('beforeend', '<div class="chart-periods" role="group" aria-label="Periode grafik pendapatan"><button class="active" data-chart-period="7">7 Hari</button><button data-chart-period="30">30 Hari</button><button data-chart-period="month">Bulan Ini</button><button data-chart-period="all">All</button></div>');
  cardHead.querySelectorAll('[data-chart-period]').forEach((button) => button.addEventListener('click', async () => {
    state.chartPeriod = button.dataset.chartPeriod;
    cardHead.querySelectorAll('[data-chart-period]').forEach((item) => item.classList.toggle('active', item === button));
    await loadRevenueChart();
  }));
}
async function loadRevenueChart() {
  const target = $('#revenue-chart');
  if (!target) return;
  try {
    const Chart = await loadChartJs();
    const rentals = await api('/api/rentals');
    const { start, end } = chartPeriodRange();
    const grouped = rentals.filter((row) => new Date(row.mulai_sewa) >= start && new Date(row.mulai_sewa) <= new Date(end.getTime() + 86400000 - 1)).reduce((result, row) => {
      const date = localDateKey(row.mulai_sewa);
      result[date] = (result[date] || 0) + Number(row.total_biaya || 0);
      return result;
    }, {});
    const keys = chartDateKeys(start, end);
    const values = keys.map((key) => grouped[key] || 0);
    if (!rentals.some((row) => isFinite(Number(row.total_biaya)) && Number(row.total_biaya) > 0 && new Date(row.mulai_sewa) >= start && new Date(row.mulai_sewa) <= end)) { renderRevenueEmpty(); return; }
    target.classList.remove('chart-empty-state');
    target.innerHTML = '<canvas id="revenue-chart-canvas" aria-label="Grafik perkembangan pendapatan"></canvas>';
    state.revenueChart?.destroy();
    const canvas = $('#revenue-chart-canvas');
    const max = Math.max(...values, 1);
    state.revenueChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: keys.map((key) => dateKeyToDate(key).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })), datasets: [{ label: 'Pendapatan', data: values, borderWidth: 1, borderRadius: 7, borderSkipped: false, borderColor: '#c084fc', backgroundColor: (context) => { const chart = context.chart; const { ctx, chartArea } = chart; if (!chartArea) return 'rgba(168, 85, 247, .7)'; const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top); gradient.addColorStop(0, 'rgba(34, 211, 238, .58)'); gradient.addColorStop(.55, 'rgba(168, 85, 247, .8)'); gradient.addColorStop(1, 'rgba(236, 72, 153, .88)'); return gradient; } }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 450, easing: 'easeOutQuart' }, scales: { x: { grid: { color: 'rgba(168, 85, 247, .1)' }, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, suggestedMax: max * 1.12, grid: { color: 'rgba(168, 85, 247, .12)' }, ticks: { color: '#94a3b8', callback: (value) => formatCompactRupiah(value) } } }, plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#111827', borderColor: 'rgba(192, 132, 252, .45)', borderWidth: 1, titleColor: '#f0abfc', bodyColor: '#e2e8f0', callbacks: { title: (items) => `${items[0].label}`, label: (context) => `Pendapatan: ${formatRupiah(context.parsed.y)}` } } } }
    });
  } catch (error) {
    renderRevenueEmpty(error.message);
  }
}
function renderBreakdown(selector, rows) {
  const target = $(selector);
  if (!target) return;
  const max = Math.max(...rows.map((row) => Number(row.amount || 0)), 1);
  target.innerHTML = rows.length ? rows.map((row) => `<div class="breakdown-item"><span>${escapeHtml(row.name)}</span><div class="breakdown-bar"><span style="width:${Math.max(Number(row.amount || 0) / max * 100, 12)}%"></span></div><strong>${formatRupiah(row.amount)}</strong></div>`).join('') : '<div class="empty">Belum ada data.</div>';
}
  function renderTopCustomers(rows = []) {
    const target = $('#top-customers');
    if (!target) return;
    target.innerHTML = rows.length ? rows.map((row, index) => `<div class="insight-row"><div><b><span class="rank">0${index + 1}</span> ${escapeHtml(row.name)}</b><small>Pelanggan aktif</small></div><strong>${formatRupiah(row.amount)}</strong></div>`).join('') : '<div class="empty">Belum ada aktivitas pelanggan.</div>';
  }
async function loadDashboard() {
  const query = `?period=${state.period}${state.period === 'custom' ? getCustomQuery() : ''}`;
  try { await renderDashboard(await api(`/api/dashboard${query}`)); } catch (error) { showToast(error.message, 'error'); }
}
function ensureDashboardPeriodControls() {
  if (pageName !== 'dashboard') return;
  const toolbar = document.querySelector('.period-buttons');
  if (!toolbar || toolbar.querySelector('[data-period="all"]')) return;
  toolbar.insertAdjacentHTML('beforeend', '<button data-period="all">All</button>');
}

function renderRentals(rows = state.rentals) {
  const target = $('#rental-list');
  if (!target) return;
  const query = ($('#rental-search')?.value || '').toLowerCase();
  const status = $('#rental-status')?.value || '';
  const filtered = rows.filter((row) => (!status || row.status === status) && [row.kode_penyewaan, row.nama_pelanggan, row.kode_unit].some((value) => String(value || '').toLowerCase().includes(query)));
  target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${escapeHtml(row.kode_penyewaan)}</td><td>${escapeHtml(row.nama_pelanggan)}</td><td>${escapeHtml(row.kode_unit)} · ${escapeHtml(row.nama_unit)}</td><td>${row.durasi_jam} jam</td><td>${formatRupiah(row.total_biaya)}</td><td>${formatRupiah(row.jumlah_bayar)}</td><td>${formatRupiah(row.piutang)}</td><td>${statusBadge(row.status_pembayaran)}</td><td>${statusBadge(row.status)}</td><td class="action-cell"><button class="icon-btn detail-rental" data-id="${row.id}">Lihat</button><button class="icon-btn edit-rental" data-id="${row.id}">Edit</button><button class="icon-btn danger delete-rental" data-id="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Tidak ada transaksi yang cocok.</td></tr>';
  setText('#rental-count-page', filtered.length);
  setText('#transaction-running', rows.filter((row) => row.status === 'Berlangsung').length);
  setText('#transaction-value', formatRupiah(rows.reduce((sum, row) => sum + Number(row.total_biaya || 0), 0)));
  setText('#transaction-paid', formatRupiah(rows.reduce((sum, row) => sum + Math.min(Number(row.jumlah_bayar || 0), Number(row.total_biaya || 0)), 0)));
  setText('#transaction-receivable', formatRupiah(rows.reduce((sum, row) => sum + Number(row.piutang || 0), 0)));
  refreshIcons();
}
async function loadRentals() { try { state.rentals = await api('/api/rentals'); renderRentals(); } catch (error) { showToast(error.message, 'error'); } }
function fillSelect(selector, rows, valueKey, label) { const target = $(selector); if (target) target.innerHTML = rows.map((row) => `<option value="${row[valueKey]}">${escapeHtml(label(row))}</option>`).join(''); }
function ensureInlineCustomerFields() {
  const select = $('#rental-customer');
  if (!select) return;
  if (!$('#inline-customer-fields')) {
    select.insertAdjacentHTML('beforebegin', '<div id="inline-customer-fields" class="inline-customer-fields is-hidden"><label>Nama pelanggan baru<input id="customer-name" name="customer_name" minlength="2" placeholder="Ketik nama pelanggan"></label><div class="grid-2"><label>Nomor telepon<input name="customer_phone" type="tel"></label><label>Email<input name="customer_email" type="email"></label></div></div>');
    select.addEventListener('change', () => { const fields = $('#inline-customer-fields'); fields?.classList.toggle('is-hidden', select.value !== '__new__'); });
  }
  if (!select.querySelector('option[value="__new__"]')) select.insertAdjacentHTML('afterbegin', '<option value="__new__">+ Pelanggan baru</option>');
  select.value = state.customers.length ? state.customers[0].id : '__new__';
}
async function openRentalModal() { await Promise.all([loadCustomers(), loadUnits()]); fillSelect('#rental-customer', state.customers.filter((row) => row.aktif), 'id', (row) => row.nama); ensureInlineCustomerFields(); modalControl('rental-modal', true); }
async function saveRental(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  try { await api('/api/rentals', { method: 'POST', body: JSON.stringify(payload) }); modalControl('rental-modal', false); event.currentTarget.reset(); showToast('Transaksi berhasil disimpan.'); await loadRentals(); } catch (error) { showToast(error.message, 'error'); }
}
function showRentalDetail(id) {
  const row = state.rentals.find((item) => item.id === id); if (!row) return;
  $('#detail-content').innerHTML = `<div class="receipt-header"><div class="receipt-icon"><i data-lucide="receipt-text" aria-hidden="true"></i></div><div><p class="eyebrow">Detail transaksi</p><h2>Detail Transaksi</h2><span>${escapeHtml(row.kode_penyewaan)}</span></div><div class="receipt-status">${statusBadge(row.status)}</div></div><div class="receipt-total"><span>Total biaya</span><strong>${formatRupiah(row.total_biaya)}</strong><small>${row.durasi_jam} jam × ${formatRupiah(row.tarif_per_jam)}/jam</small></div><div class="receipt-sections"><section><div class="receipt-section-title"><i data-lucide="gamepad-2" aria-hidden="true"></i><h3>Informasi penyewaan</h3></div><div class="receipt-grid"><span>ID transaksi</span><b>${escapeHtml(row.kode_penyewaan)}</b><span>Pelanggan</span><b>${escapeHtml(row.nama_pelanggan)}</b><span>Unit PlayStation</span><b>${escapeHtml(row.kode_unit)} · ${escapeHtml(row.nama_unit)}</b><span>Waktu mulai</span><b>${formatDate(row.mulai_sewa)}</b><span>Durasi</span><b>${row.durasi_jam} jam</b></div></section><section><div class="receipt-section-title"><i data-lucide="calculator" aria-hidden="true"></i><h3>Rincian biaya</h3></div><div class="receipt-grid"><span>Tarif per jam</span><b>${formatRupiah(row.tarif_per_jam)}</b><span>Total biaya</span><b class="accent-value">${formatRupiah(row.total_biaya)}</b><span>Jumlah pembayaran</span><b class="paid-value">${formatRupiah(row.jumlah_bayar)}</b><span>Piutang</span><b class="debt-value">${formatRupiah(row.piutang)}</b></div></section><section><div class="receipt-section-title"><i data-lucide="credit-card" aria-hidden="true"></i><h3>Pembayaran</h3></div><div class="receipt-grid"><span>Metode pembayaran</span><b>${escapeHtml(row.metode_pembayaran || '-')}</b><span>Status pembayaran</span><b>${statusBadge(row.status_pembayaran)}</b><span>Tanggal pembayaran</span><b>${formatDate(row.tanggal_bayar)}</b></div></section></div>`;
  refreshIcons(); modalControl('detail-modal', true);
}

function renderUnits(rows = state.units) {
  const target = $('#unit-list'); if (!target) return;
  const query = ($('#unit-search')?.value || '').toLowerCase(); const status = $('#unit-status-filter')?.value || '';
  const filtered = rows.filter((row) => (!status || row.status === status) && [row.kode_unit, row.nama_unit, row.tipe_konsol].some((value) => String(value || '').toLowerCase().includes(query)));
  target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${escapeHtml(row.kode_unit)}</td><td>${escapeHtml(row.nama_unit)}</td><td>${escapeHtml(row.tipe_konsol)}</td><td>${formatRupiah(row.tarif_per_jam)}</td><td>${statusBadge(row.status)}</td><td>${escapeHtml(row.catatan || '-')}</td><td class="action-cell"><button class="icon-btn edit-unit" data-id="${row.id}">Edit</button><button class="icon-btn danger delete-unit" data-id="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Belum ada unit yang cocok.</td></tr>';
  setText('#unit-count-page', filtered.length);
  setText('#unit-available-page', rows.filter((row) => row.status === 'Tersedia').length);
  setText('#unit-rented-page', rows.filter((row) => row.status === 'Disewa').length);
  setText('#unit-maintenance-page', rows.filter((row) => row.status === 'Perawatan').length);
  renderPriceList(rows);
}
function renderPriceList(rows = state.units) {
  const target = $('#price-list'); if (!target) return;
  target.innerHTML = rows.length ? rows.map((row) => `<article class="price-item"><div class="price-item-icon"><i data-lucide="gamepad-2" aria-hidden="true"></i></div><div class="price-item-main"><b>${escapeHtml(row.nama_unit)}</b><small>${escapeHtml(row.kode_unit)} · ${escapeHtml(row.tipe_konsol)}</small></div><strong>${formatRupiah(row.tarif_per_jam)}<small>/ jam</small></strong></article>`).join('') : '<div class="empty">Belum ada unit untuk ditampilkan.</div>';
  refreshIcons();
}
async function loadUnits() { try { state.units = await api('/api/units'); renderUnits(); } catch (error) { showToast(error.message, 'error'); } }
async function saveUnit(event) { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); payload.tarif_per_jam = Number(payload.tarif_per_jam); try { await api('/api/units', { method: 'POST', body: JSON.stringify(payload) }); modalControl('unit-modal', false); event.currentTarget.reset(); showToast('Unit berhasil ditambahkan.'); await loadUnits(); } catch (error) { showToast(error.message, 'error'); } }

function renderCustomers(rows = state.customers) { const target = $('#customer-list'); if (!target) return; const query = ($('#customer-search')?.value || '').toLowerCase(); const filtered = rows.filter((row) => [row.nama, row.email, row.nomor_telepon].some((value) => String(value || '').toLowerCase().includes(query))); target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td><b>${escapeHtml(row.nama)}</b></td><td>${escapeHtml(row.nomor_telepon || '-')}</td><td>${escapeHtml(row.email || '-')}</td><td>${row.aktif ? statusBadge('Aktif') : statusBadge('Nonaktif')}</td><td><button class="icon-btn customer-history" data-id="${row.id}">Riwayat</button><button class="icon-btn edit-customer" data-id="${row.id}">Edit</button><button class="icon-btn danger delete-customer" data-id="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Belum ada pelanggan.</td></tr>'; setText('#customer-count-page', filtered.length); }
async function loadCustomers() { try { state.customers = await api('/api/customers'); renderCustomers(); } catch (error) { showToast(error.message, 'error'); } }
async function saveCustomer(event) { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); try { await api('/api/customers', { method: 'POST', body: JSON.stringify(payload) }); modalControl('customer-modal', false); event.currentTarget.reset(); showToast('Pelanggan berhasil ditambahkan.'); await loadCustomers(); } catch (error) { showToast(error.message, 'error'); } }
function showCustomerHistory(id) { const customer = state.customers.find((row) => row.id === id); const rows = state.rentals.filter((row) => row.pelanggan_id === id || row.nama_pelanggan === customer?.nama); $('#detail-content').innerHTML = `<h3>Riwayat ${escapeHtml(customer?.nama || 'pelanggan')}</h3><p class="modal-note">${rows.length} transaksi tercatat</p>${rows.length ? `<div class="history-list">${rows.map((row) => `<div><b>${escapeHtml(row.kode_penyewaan)}</b><span>${formatDateOnly(row.mulai_sewa)} · ${formatRupiah(row.total_biaya)}</span></div>`).join('')}</div>` : '<div class="empty">Belum ada riwayat transaksi.</div>'}`; modalControl('detail-modal', true); }

function renderPayments(rows = state.payments) { const target = $('#payment-list'); if (!target) return; const query = ($('#payment-search')?.value || '').toLowerCase(); const filtered = rows.filter((row) => [row.kode_penyewaan, row.nama_pelanggan, row.kode_unit].some((value) => String(value || '').toLowerCase().includes(query))); target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${escapeHtml(row.kode_penyewaan)}</td><td>${escapeHtml(row.nama_pelanggan)}</td><td>${escapeHtml(row.kode_unit)}</td><td>${formatRupiah(row.total_biaya)}</td><td>${formatRupiah(row.jumlah_bayar)}</td><td>${formatRupiah(row.piutang)}</td><td>${statusBadge(row.status_pembayaran)}</td><td><button class="icon-btn add-payment" data-id="${row.id}" data-code="${escapeHtml(row.kode_penyewaan)}">Catat</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Belum ada data pembayaran.</td></tr>'; }
async function loadPayments() { try { state.payments = await api('/api/payments'); renderPayments(); } catch (error) { showToast(error.message, 'error'); } }
function openPaymentModal(id, code) { $('#payment-rental-id').value = id; $('#payment-rental-code').textContent = code; modalControl('payment-modal', true); }
async function savePayment(event) { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); payload.jumlah_bayar = Number(payload.jumlah_bayar); try { await api('/api/payments', { method: 'POST', body: JSON.stringify(payload) }); modalControl('payment-modal', false); event.currentTarget.reset(); showToast('Pembayaran berhasil dicatat.'); await loadPayments(); } catch (error) { showToast(error.message, 'error'); } }

function renderReport(rows) { const total = rows.reduce((sum, row) => sum + Number(row.total_biaya || 0), 0); const paid = rows.reduce((sum, row) => sum + Math.min(Number(row.jumlah_bayar || 0), Number(row.total_biaya || 0)), 0); setText('#report-count', rows.length); setText('#report-total', formatRupiah(total)); setText('#report-paid', formatRupiah(paid)); setText('#report-receivable', formatRupiah(Math.max(total - paid, 0))); const target = $('#report-list'); if (target) target.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.kode_penyewaan)}</td><td>${formatDateOnly(row.mulai_sewa)}</td><td>${escapeHtml(row.nama_pelanggan)}</td><td>${escapeHtml(row.kode_unit)}</td><td>${formatRupiah(row.total_biaya)}</td><td>${formatRupiah(row.jumlah_bayar)}</td><td>${formatRupiah(row.piutang)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">Belum ada data pada periode ini.</td></tr>'; }
async function loadReport() { try { const query = `?period=${state.period}${state.period === 'custom' ? getCustomQuery() : ''}`; renderReport(await api(`/api/report${query}`)); } catch (error) { showToast(error.message, 'error'); } }

async function editRental(id) {
  const row = state.rentals.find((item) => item.id === id); if (!row) return;
  const duration = window.prompt('Durasi rental (jam):', row.durasi_jam); if (duration === null) return;
  const status = window.prompt('Status: Berlangsung, Selesai, atau Dibatalkan:', row.status); if (status === null) return;
  try { await api(`/api/rentals/${id}`, { method: 'PATCH', body: JSON.stringify({ durasi_jam: Number(duration), status, catatan: row.catatan }) }); showToast('Transaksi berhasil diperbarui.'); await loadRentals(); } catch (error) { showToast(error.message, 'error'); }
}
async function editUnit(id) {
  const row = state.units.find((item) => item.id === id); if (!row) return;
  const name = window.prompt('Nama unit:', row.nama_unit); if (name === null) return;
  const rate = window.prompt('Tarif per jam:', row.tarif_per_jam); if (rate === null) return;
  const status = window.prompt('Status: Tersedia, Disewa, atau Perawatan:', row.status); if (status === null) return;
  try { await api(`/api/units/${id}`, { method: 'PATCH', body: JSON.stringify({ nama_unit: name, tarif_per_jam: Number(rate), status }) }); showToast('Unit berhasil diperbarui.'); await loadUnits(); } catch (error) { showToast(error.message, 'error'); }
}
async function editCustomer(id) {
  const row = state.customers.find((item) => item.id === id); if (!row) return;
  const name = window.prompt('Nama pelanggan:', row.nama); if (name === null) return;
  const phone = window.prompt('Nomor telepon:', row.nomor_telepon || ''); if (phone === null) return;
  try { await api(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify({ nama: name, nomor_telepon: phone }) }); showToast('Pelanggan berhasil diperbarui.'); await loadCustomers(); } catch (error) { showToast(error.message, 'error'); }
}

async function deleteResource(resource, id, reload) { if (!window.confirm('Yakin ingin menghapus data ini?')) return; try { await api(`/api/${resource}/${id}`, { method: 'DELETE' }); showToast('Data berhasil dihapus.'); await reload(); } catch (error) { showToast(error.message, 'error'); } }
function requestRentalDelete(id) { state.pendingDelete = id; modalControl('delete-confirm-modal', true); }
async function confirmRentalDelete() { if (!state.pendingDelete) return; const id = state.pendingDelete; state.pendingDelete = null; modalControl('delete-confirm-modal', false); try { await api(`/api/rentals/${id}`, { method: 'DELETE' }); showToast('Transaksi berhasil dihapus.'); await loadRentals(); } catch (error) { showToast(error.message, 'error'); } }
function bindCommon() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'open-rental') openRentalModal();
    if (button.id === 'open-unit') modalControl('unit-modal', true);
    if (button.id === 'open-customer') modalControl('customer-modal', true);
    if (button.id === 'open-payment') modalControl('payment-modal', true);
    if (button.id === 'refresh-page') pageName === 'dashboard' ? loadDashboard() : pageName === 'rentals' ? loadRentals() : pageName === 'units' ? loadUnits() : pageName === 'customers' ? loadCustomers() : pageName === 'payments' ? loadPayments() : loadReport();
    if (button.classList.contains('detail-rental')) showRentalDetail(button.dataset.id);
    if (button.classList.contains('edit-rental')) editRental(button.dataset.id);
    if (button.classList.contains('edit-unit')) editUnit(button.dataset.id);
    if (button.classList.contains('edit-customer')) editCustomer(button.dataset.id);
    if (button.classList.contains('customer-history')) showCustomerHistory(button.dataset.id);
    if (button.classList.contains('add-payment')) openPaymentModal(button.dataset.id, button.dataset.code);
    if (button.classList.contains('delete-rental')) pageName === 'rentals' ? requestRentalDelete(button.dataset.id) : deleteResource('rentals', button.dataset.id, loadRentals);
    if (button.classList.contains('delete-unit')) deleteResource('units', button.dataset.id, loadUnits);
    if (button.classList.contains('delete-customer')) deleteResource('customers', button.dataset.id, loadCustomers);
    if (button.id === 'print-report') window.print();
    if (button.id === 'confirm-delete') confirmRentalDelete();
  });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => modalControl(button.dataset.close, false)));
  $('#rental-form')?.addEventListener('submit', saveRental); $('#unit-form')?.addEventListener('submit', saveUnit); $('#customer-form')?.addEventListener('submit', saveCustomer); $('#payment-form')?.addEventListener('submit', savePayment);
  $('#rental-search')?.addEventListener('input', () => renderRentals()); $('#rental-status')?.addEventListener('change', () => renderRentals()); $('#unit-search')?.addEventListener('input', () => renderUnits()); $('#unit-status-filter')?.addEventListener('change', () => renderUnits()); $('#customer-search')?.addEventListener('input', () => renderCustomers()); $('#payment-search')?.addEventListener('input', () => renderPayments());
  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => { state.period = button.dataset.period; document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('active', item === button)); pageName === 'dashboard' ? loadDashboard() : loadReport(); }));
  $('#custom-period')?.addEventListener('change', () => { if ($('#custom-start')?.value && $('#custom-end')?.value) { state.period = 'custom'; pageName === 'dashboard' ? loadDashboard() : loadReport(); } });
}
async function start() {
  document.title = document.title.replace('PlayLedger', 'PlayVora');
  document.querySelectorAll('.eyebrow').forEach((element) => { element.textContent = element.textContent.replace('PlayLedger', 'PlayVora'); });
  if (pageName === 'dashboard') document.querySelector('h1')?.replaceChildren('Dashboard Pendapatan');
  if (pageName === 'dashboard') document.querySelector('.hero-badge')?.replaceChildren('PlayVora Analytics');
  document.querySelectorAll('#refresh-page').forEach((button) => { button.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>'; button.title = 'Refresh Data'; button.setAttribute('aria-label', 'Refresh Data'); });
  applyNav(); ensureDashboardPeriodControls(); bindCommon();
  if (pageName === 'dashboard') await loadDashboard();
  if (pageName === 'rentals') await loadRentals();
  if (pageName === 'units') await loadUnits();
  if (pageName === 'customers') { await loadCustomers(); await loadRentals(); }
  if (pageName === 'payments') await loadPayments();
  if (pageName === 'reports') await loadReport();
}
start();
