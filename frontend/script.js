const pageName = document.body.dataset.page || 'dashboard';
const state = { customers: [], units: [], tariffs: [], rooms: [], rentals: [], payments: [], period: 'month', chartPeriod: '7', dashboard: null, pendingDelete: null, revenueChart: null, chartJsPromise: null };
const $ = (selector) => document.querySelector(selector);
const formatRupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const formatDate = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const formatDateOnly = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value)) : '-';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

const SUPABASE_URL = 'https://clxskbmlsaunjixybzst.supabase.co';
const SUPABASE_PUBLISHED_KEY = 'sb_publishable_tZ_WeABf_RthbLNkLGza4g_GXuQP9hL';

const supabaseHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_PUBLISHED_KEY,
  'Authorization': `Bearer ${SUPABASE_PUBLISHED_KEY}`
};

async function supabaseRequest(table, options = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);

  Object.entries(options.query || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const headers = {
    ...supabaseHeaders
  };

  if (options.body) {
    headers.Prefer = options.prefer || 'return=representation';
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      `Supabase error ${response.status}`
    );
  }

  return data;
}

function calculatePaymentStatus(total, paid) {
  if (paid <= 0) return 'Belum Lunas';
  if (paid >= total) return 'Lunas';
  return 'Sebagian';
}

async function getReportRows() {
  return supabaseRequest('v_laporan_pendapatan', {
    query: {
      select: '*',
      order: 'mulai_sewa.desc'
    }
  });
}

async function getUnitsWithRates() {
  const [units, tariffs] = await Promise.all([
    supabaseRequest('unit_playstation', {
      query: { select: '*', order: 'kode_unit.asc' }
    }),
    supabaseRequest('tarif_konsol', {
      query: { select: 'tipe_konsol,tarif_per_jam' }
    })
  ]);
  const ratesByType = Object.fromEntries(
    tariffs.map((row) => [row.tipe_konsol, Number(row.tarif_per_jam)])
  );
  return units.map((unit) => ({
    ...unit,
    tarif_per_jam: ratesByType[unit.tipe_konsol]
  }));
}

async function getRoomsWithRates() {
  const [rooms, tariffs] = await Promise.all([
    supabaseRequest('ruangan', {
      query: { select: '*', order: 'kode_ruangan.asc' }
    }),
    supabaseRequest('tarif_ruangan', {
      query: { select: 'tipe_ruangan,tarif_per_jam' }
    })
  ]);
  const ratesByType = Object.fromEntries(
    tariffs.map((row) => [row.tipe_ruangan, Number(row.tarif_per_jam)])
  );
  return rooms.map((room) => ({
    ...room,
    tarif_per_jam: ratesByType[room.tipe_ruangan]
  }));
}

function getDateRangeFromEndpoint(endpoint) {
  const queryString = endpoint.includes('?')
    ? endpoint.split('?')[1]
    : '';

  const params = new URLSearchParams(queryString);

  const period = params.get('period') || 'month';

  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (period === 'all') {
    start.setTime(0);
    return { period, start, end };
  }

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  }

  if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
  }

  if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  if (period === 'custom') {
    const customStart = params.get('start');
    const customEnd = params.get('end');

    if (!customStart || !customEnd) {
      throw new Error(
        'Periode custom membutuhkan tanggal mulai dan selesai.'
      );
    }

    start.setTime(
      new Date(`${customStart}T00:00:00`).getTime()
    );

    end.setTime(
      new Date(`${customEnd}T23:59:59`).getTime()
    );
  }

  return { period, start, end };
}

function isInRange(value, range) {
  const date = new Date(value);

  return (
    !Number.isNaN(date.getTime()) &&
    date >= range.start &&
    date <= range.end
  );
}

async function getDashboardFromSupabase(endpoint) {
  const range = getDateRangeFromEndpoint(endpoint);

  const [rows, units, customers] = await Promise.all([
    getReportRows(),
    supabaseRequest('unit_playstation', {
      query: {
        select: '*'
      }
    }),
    supabaseRequest('pelanggan', {
      query: {
        select: 'id,nama,aktif'
      }
    })
  ]);

  const filteredRows = rows.filter((row) =>
    isInRange(row.mulai_sewa, range)
  );

  const totalBilled = filteredRows.reduce(
    (sum, row) => sum + Number(row.total_biaya || 0),
    0
  );

  const totalPaid = filteredRows.reduce(
    (sum, row) =>
      sum +
      Math.min(
        Number(row.jumlah_bayar || 0),
        Number(row.total_biaya || 0)
      ),
    0
  );

  const totalReceivable = Math.max(
    totalBilled - totalPaid,
    0
  );

  const consoleMap = {};
  const paymentMap = {};
  const customerMap = {};

  filteredRows.forEach((row) => {
    const paid = Math.min(
      Number(row.jumlah_bayar || 0),
      Number(row.total_biaya || 0)
    );

    consoleMap[row.tipe_konsol] =
      (consoleMap[row.tipe_konsol] || 0) +
      Number(row.total_biaya || 0);

    customerMap[row.nama_pelanggan] =
      (customerMap[row.nama_pelanggan] || 0) +
      Number(row.total_biaya || 0);

    if (row.metode_pembayaran) {
      paymentMap[row.metode_pembayaran] =
        (paymentMap[row.metode_pembayaran] || 0) +
        paid;
    }
  });

  return {
    period: range.period,
    updatedAt: new Date().toISOString(),

    collectedRevenue: totalPaid,
    totalBilled,
    totalReceivable,

    customerCount: customers.filter(
      (item) => item.aktif !== false
    ).length,

    transactionCount: filteredRows.length,

    completedSessions: filteredRows.filter(
      (row) => row.status === 'Selesai'
    ).length,

    activeSessions: filteredRows.filter(
      (row) => row.status === 'Berlangsung'
    ),

    totalHours: filteredRows.reduce(
      (sum, row) =>
        sum + Number(row.durasi_jam || 0),
      0
    ),

    averageTransaction: filteredRows.length
      ? totalBilled / filteredRows.length
      : 0,

    paymentRate: totalBilled
      ? Math.round((totalPaid / totalBilled) * 100)
      : 0,

    unitSummary: {
      available: units.filter(
        (item) => item.status === 'Tersedia'
      ).length,

      rented: units.filter(
        (item) => item.status === 'Disewa'
      ).length,

      maintenance: units.filter(
        (item) => item.status === 'Perawatan'
      ).length,

      total: units.length
    },

    consoleBreakdown: Object.entries(consoleMap)
      .map(([name, amount]) => ({
        name,
        amount
      }))
      .sort((a, b) => b.amount - a.amount),

    paymentBreakdown: Object.entries(paymentMap)
      .map(([name, amount]) => ({
        name,
        amount
      }))
      .sort((a, b) => b.amount - a.amount),

    topCustomers: Object.entries(customerMap)
      .map(([name, amount]) => ({
        name,
        amount
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),

    recentTransactions: rows.slice(0, 8)
  };
}

async function savePaymentDirect(
  rentalId,
  amount,
  method,
  note = null
) {
  const rentalRows = await supabaseRequest(
    'penyewaan',
    {
      query: {
        select: 'id,total_biaya',
        id: `eq.${rentalId}`
      }
    }
  );

  const rental = rentalRows[0];

  if (!rental) {
    throw new Error(
      'Transaksi penyewaan tidak ditemukan.'
    );
  }

  const total = Number(rental.total_biaya);

  const payment = {
    penyewaan_id: rentalId,
    jumlah_bayar: Math.min(amount, total),
    metode_pembayaran: method,
    status_pembayaran: calculatePaymentStatus(
      total,
      amount
    ),
    catatan: note
  };

  const result = await supabaseRequest(
    'pembayaran',
    {
      method: 'POST',
      body: payment,
      prefer:
        'resolution=merge-duplicates,return=representation'
    }
  );

  return result[0];
}

async function api(endpoint, options = {}) {
  const method = options.method || 'GET';
  const body = options.body
    ? JSON.parse(options.body)
    : null;

  if (endpoint.startsWith('/api/dashboard')) {
    return getDashboardFromSupabase(endpoint);
  }

  if (endpoint.startsWith('/api/report')) {
    const range = getDateRangeFromEndpoint(endpoint);

    const rows = await getReportRows();

    return rows.filter((row) =>
      isInRange(row.mulai_sewa, range)
    );
  }

  if (endpoint === '/api/customers' && method === 'GET') {
    return supabaseRequest('pelanggan', {
      query: {
        select: '*',
        order: 'nama.asc'
      }
    });
  }

  if (endpoint === '/api/units' && method === 'GET') {
    return getUnitsWithRates();
  }

  if (endpoint === '/api/rooms' && method === 'GET') {
    return getRoomsWithRates();
  }

  if (endpoint === '/api/tariffs' && method === 'GET') {
    return supabaseRequest('tarif_konsol', {
      query: {
        select: '*',
        order: 'tipe_konsol.asc'
      }
    });
  }

  if (
    (endpoint === '/api/rentals' ||
      endpoint === '/api/payments') &&
    method === 'GET'
  ) {
    return getReportRows();
  }

  if (endpoint === '/api/customers' && method === 'POST') {
    if (!body.nama || body.nama.trim().length < 2) {
      throw new Error(
        'Nama pelanggan minimal 2 karakter.'
      );
    }

    const result = await supabaseRequest(
      'pelanggan',
      {
        method: 'POST',
        body: {
          nama: body.nama.trim(),
          nomor_telepon:
            body.nomor_telepon?.trim() || null,
          email: body.email?.trim() || null,
          aktif: true
        }
      }
    );

    return result[0];
  }

  const customerMatch = endpoint.match(
    /^\/api\/customers\/([^/]+)$/
  );

  if (customerMatch && method === 'PATCH') {
    const id = customerMatch[1];

    if (
      body.nama !== undefined &&
      body.nama.trim().length < 2
    ) {
      throw new Error(
        'Nama pelanggan minimal 2 karakter.'
      );
    }

    const result = await supabaseRequest(
      'pelanggan',
      {
        method: 'PATCH',
        query: {
          id: `eq.${id}`
        },
        body
      }
    );

    return result[0];
  }

  if (customerMatch && method === 'DELETE') {
    const id = customerMatch[1];

    await supabaseRequest(
      'pelanggan',
      {
        method: 'DELETE',
        query: {
          id: `eq.${id}`
        }
      }
    );

    return null;
  }

  if (endpoint === '/api/units' && method === 'POST') {
    const consoleType = body.tipe_konsol || 'PS4';
    if (!body.kode_unit || !body.nama_unit || !['PS4', 'PS5'].includes(consoleType)) {
      throw new Error(
        'Kode, nama, dan tipe konsol unit wajib valid.'
      );
    }

    const result = await supabaseRequest(
      'unit_playstation',
      {
        method: 'POST',
        body: {
          kode_unit: body.kode_unit.trim(),
          nama_unit: body.nama_unit.trim(),
          tipe_konsol: consoleType,
          status: body.status || 'Tersedia',
          catatan: body.catatan || null
        }
      }
    );

    return result[0];
  }

  const tariffMatch = endpoint.match(/^\/api\/tariffs\/(PS4|PS5)$/);

  if (tariffMatch && method === 'PATCH') {
    const amount = Number(body.tarif_per_jam);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Tarif per jam harus lebih dari nol.');
    }
    const result = await supabaseRequest('tarif_konsol', {
      method: 'PATCH',
      query: { tipe_konsol: `eq.${tariffMatch[1]}` },
      body: { tarif_per_jam: amount }
    });
    return result[0];
  }

  const unitMatch = endpoint.match(
    /^\/api\/units\/([^/]+)$/
  );

  if (unitMatch && method === 'PATCH') {
    const id = unitMatch[1];

    const result = await supabaseRequest(
      'unit_playstation',
      {
        method: 'PATCH',
        query: {
          id: `eq.${id}`
        },
        body
      }
    );

    return result[0];
  }

  if (unitMatch && method === 'DELETE') {
    const id = unitMatch[1];

    await supabaseRequest(
      'unit_playstation',
      {
        method: 'DELETE',
        query: {
          id: `eq.${id}`
        }
      }
    );

    return null;
  }

  if (endpoint === '/api/rentals' && method === 'POST') {
    if (body.pelanggan_id === '__new__') {
      if (
        !body.customer_name ||
        body.customer_name.trim().length < 2
      ) {
        throw new Error(
          'Nama pelanggan baru minimal 2 karakter.'
        );
      }

      const createdCustomer =
        await supabaseRequest(
          'pelanggan',
          {
            method: 'POST',
            body: {
              nama: body.customer_name.trim(),
              nomor_telepon:
                body.customer_phone?.trim() || null,
              email:
                body.customer_email?.trim() || null,
              aktif: true
            }
          }
        );

      body.pelanggan_id =
        createdCustomer[0].id;
    }

    const duration = Number(body.durasi_jam);

    if (
      !body.pelanggan_id ||
      !body.unit_id ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        'Pelanggan, unit, dan durasi lebih dari nol wajib diisi.'
      );
    }

    const customerRows = await supabaseRequest(
      'pelanggan',
      {
        query: {
          select: 'id',
          id: `eq.${body.pelanggan_id}`,
          aktif: 'eq.true'
        }
      }
    );

    if (!customerRows[0]) {
      throw new Error(
        'Pelanggan aktif tidak ditemukan.'
      );
    }

    const unitRows = await supabaseRequest(
      'unit_playstation',
      {
        query: {
          select: '*',
          id: `eq.${body.unit_id}`
        }
      }
    );

    const unit = unitRows[0];

    if (!unit) {
      throw new Error(
        'Unit PlayStation tidak ditemukan.'
      );
    }

    if (unit.status !== 'Tersedia') {
      throw new Error(
        `Unit sedang ${unit.status.toLowerCase()} dan tidak dapat disewa.`
      );
    }

    const roomId = body.ruangan_id || null;
    let room = null;
    let roomRate = 0;
    if (roomId) {
      const roomRows = await supabaseRequest('ruangan', {
        query: { select: '*', id: `eq.${roomId}` }
      });
      room = roomRows[0];
      if (!room) throw new Error('Ruangan tidak ditemukan.');
      if (room.status !== 'Tersedia') throw new Error('Ruangan tidak tersedia.');
      const roomTariffs = await supabaseRequest('tarif_ruangan', {
        query: {
          select: 'tarif_per_jam',
          tipe_ruangan: `eq.${room.tipe_ruangan}`
        }
      });
      roomRate = Number(roomTariffs[0]?.tarif_per_jam);
      if (!Number.isFinite(roomRate) || roomRate <= 0) {
        throw new Error(`Tarif ruang ${room.tipe_ruangan} tidak ditemukan.`);
      }
    }

    const tariffRows = await supabaseRequest('tarif_konsol', {
      query: {
        select: 'tarif_per_jam',
        tipe_konsol: `eq.${unit.tipe_konsol}`
      }
    });
    const hourlyRate = Number(tariffRows[0]?.tarif_per_jam);
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      throw new Error(`Tarif ${unit.tipe_konsol} tidak ditemukan.`);
    }
    const total = Number(((hourlyRate + roomRate) * duration).toFixed(2));

    const rentalResult = await supabaseRequest(
      'penyewaan',
      {
        method: 'POST',
        body: {
          kode_penyewaan:
            body.kode_penyewaan ||
            `SEWA-${Date.now()
              .toString()
              .slice(-8)}`,

          pelanggan_id: body.pelanggan_id,

          unit_id: body.unit_id,

          ruangan_id: roomId,

          mulai_sewa:
            body.mulai_sewa ||
            new Date().toISOString(),

          durasi_jam: duration,

          tarif_per_jam: hourlyRate,

          tarif_ruangan_per_jam: roomRate,

          total_biaya: total,

          status:
            body.status || 'Berlangsung',

          catatan:
            body.catatan || null
        }
      }
    );

    const rental = rentalResult[0];

    if (body.status === 'Berlangsung' || !body.status) {
      await supabaseRequest(
        'unit_playstation',
        {
          method: 'PATCH',
          query: {
            id: `eq.${unit.id}`
          },
          body: {
            status: 'Disewa'
          }
        }
      );
      if (room) {
        await supabaseRequest('ruangan', {
          method: 'PATCH',
          query: { id: `eq.${room.id}` },
          body: { status: 'Disewa' }
        });
      }
    }

    if (Number(body.jumlah_bayar) > 0) {
      await savePaymentDirect(
        rental.id,
        Number(body.jumlah_bayar),
        body.metode_pembayaran || 'Tunai'
      );
    }

    return rental;
  }

  const rentalMatch = endpoint.match(
    /^\/api\/rentals\/([^/]+)$/
  );

  if (rentalMatch && method === 'PATCH') {
    const id = rentalMatch[1];

    const updateData = { ...body };
    const currentRows = await supabaseRequest('penyewaan', {
      query: {
        select: 'unit_id,ruangan_id,status,tarif_per_jam,tarif_ruangan_per_jam',
        id: `eq.${id}`
      }
    });
    const rental = currentRows[0];
    if (!rental) throw new Error('Transaksi penyewaan tidak ditemukan.');

    if (body.durasi_jam !== undefined) {
      const duration = Number(body.durasi_jam);

      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(
          'Durasi harus lebih dari nol.'
        );
      }

      updateData.durasi_jam = duration;
      updateData.total_biaya = Number(
        (duration * (Number(rental.tarif_per_jam) + Number(rental.tarif_ruangan_per_jam || 0))).toFixed(2)
      );
    }

    if (rental.status !== 'Berlangsung' && body.status === 'Berlangsung') {
      const units = await supabaseRequest('unit_playstation', {
        query: { select: 'id,status', id: `eq.${rental.unit_id}` }
      });
      if (units[0]?.status !== 'Tersedia') throw new Error('Unit tidak tersedia untuk mengaktifkan kembali transaksi.');
      if (rental.ruangan_id) {
        const rooms = await supabaseRequest('ruangan', {
          query: { select: 'id,status', id: `eq.${rental.ruangan_id}` }
        });
        if (rooms[0]?.status !== 'Tersedia') throw new Error('Ruangan tidak tersedia untuk mengaktifkan kembali transaksi.');
      }
    }

    const result = await supabaseRequest(
      'penyewaan',
      {
        method: 'PATCH',
        query: {
          id: `eq.${id}`
        },
        body: updateData
      }
    );

    if (body.status === 'Berlangsung' && rental.status !== 'Berlangsung') {
      await supabaseRequest('unit_playstation', {
        method: 'PATCH',
        query: { id: `eq.${rental.unit_id}` },
        body: { status: 'Disewa' }
      });
      if (rental.ruangan_id) {
        await supabaseRequest('ruangan', {
          method: 'PATCH',
          query: { id: `eq.${rental.ruangan_id}` },
          body: { status: 'Disewa' }
        });
      }
    } else if (rental.status === 'Berlangsung' && body.status && body.status !== 'Berlangsung') {
      await supabaseRequest('unit_playstation', {
        method: 'PATCH',
        query: { id: `eq.${rental.unit_id}` },
        body: { status: 'Tersedia' }
      });
      if (rental.ruangan_id) {
        await supabaseRequest('ruangan', {
          method: 'PATCH',
          query: { id: `eq.${rental.ruangan_id}` },
          body: { status: 'Tersedia' }
        });
      }
    }

    return result[0];
  }

  if (rentalMatch && method === 'DELETE') {
    const id = rentalMatch[1];

    const rentalRows = await supabaseRequest('penyewaan', {
      query: { select: 'unit_id,ruangan_id,status', id: `eq.${id}` }
    });
    const rental = rentalRows[0];

    await supabaseRequest(
      'penyewaan',
      {
        method: 'DELETE',
        query: {
          id: `eq.${id}`
        }
      }
    );

    if (rental?.status === 'Berlangsung') {
      await supabaseRequest('unit_playstation', {
        method: 'PATCH',
        query: { id: `eq.${rental.unit_id}` },
        body: { status: 'Tersedia' }
      });
      if (rental.ruangan_id) {
        await supabaseRequest('ruangan', {
          method: 'PATCH',
          query: { id: `eq.${rental.ruangan_id}` },
          body: { status: 'Tersedia' }
        });
      }
    }

    return null;
  }

  if (endpoint === '/api/payments' && method === 'POST') {
    if (
      !body.penyewaan_id ||
      !Number.isFinite(Number(body.jumlah_bayar)) ||
      Number(body.jumlah_bayar) <= 0
    ) {
      throw new Error(
        'Transaksi dan jumlah pembayaran wajib valid.'
      );
    }

    return savePaymentDirect(
      body.penyewaan_id,
      Number(body.jumlah_bayar),
      body.metode_pembayaran || 'Tunai',
      body.catatan
    );
  }

  throw new Error(
    'Endpoint tidak ditemukan.'
  );
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
  const links = [
    ['dashboard', 'index.html', 'layout-dashboard', 'Dashboard'],
    ['rentals', 'transaksi.html', 'receipt-text', 'Transaksi'],
    ['units', 'unit.html', 'gamepad-2', 'Unit PlayStation'],
    ['customers', 'pelanggan.html', 'users-round', 'Pelanggan'],
    ['payments', 'pembayaran.html', 'credit-card', 'Pembayaran'],
    ['reports', 'laporan.html', 'chart-no-axes-column-increasing', 'Laporan']
  ];

  return `<aside class="sidebar">
    <a class="brand" href="index.html" aria-label="PlayVora, Dashboard">
      <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><defs><linearGradient id="pv-mark-gradient" x1="7" y1="8" x2="41" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#22D3EE"/><stop offset=".55" stop-color="#A855F7"/><stop offset="1" stop-color="#EC4899"/></linearGradient></defs><path d="M11 8.5h17.5L39 17v14l-10.5 8.5H11L7 33V15z" fill="none" stroke="url(#pv-mark-gradient)" stroke-linejoin="round" stroke-width="1.8"/><path d="M15 32V16h8a5 5 0 0 1 0 10h-8m12-8 5.5 14 5.5-14" fill="none" stroke="url(#pv-mark-gradient)" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8"/></svg></span>
      <span class="brand-copy"><strong>PlayVora</strong><small>Sistem Akuntansi Rental PlayStation</small></span>
    </a>
    <nav class="side-nav" aria-label="Navigasi utama">
      ${links.map(([page, href, icon, label]) => `<a class="${active === page ? 'active' : ''}" href="${href}"${active === page ? ' aria-current="page"' : ''}><i class="nav-icon" data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('')}
    </nav>
  </aside>`;
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
  setText('#unit-total', data.unitSummary.total);
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
  target.innerHTML = rows.length ? rows.map((row) => `<div class="session-row"><div><b>${escapeHtml(row.nama_pelanggan)}</b><small>${escapeHtml(row.nama_unit)}${row.nama_ruangan ? ` · ${escapeHtml(row.nama_ruangan)}` : ''} · mulai ${formatDate(row.mulai_sewa)}</small></div><strong>${row.durasi_jam} jam</strong>${statusBadge(row.status)}</div>`).join('') : '<div class="empty">Tidak ada sesi yang sedang berlangsung.</div>';
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
  const filtered = rows.filter((row) => (!status || row.status === status) && [row.kode_penyewaan, row.nama_pelanggan, row.kode_unit, row.nama_ruangan].some((value) => String(value || '').toLowerCase().includes(query)));
  target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${escapeHtml(row.kode_penyewaan)}</td><td>${escapeHtml(row.nama_pelanggan)}</td><td>${escapeHtml(row.kode_unit)} · ${escapeHtml(row.nama_unit)}</td><td>${escapeHtml(row.nama_ruangan || '-')}</td><td>${row.durasi_jam} jam</td><td>${formatRupiah(row.total_biaya)}</td><td>${formatRupiah(row.jumlah_bayar)}</td><td>${formatRupiah(row.piutang)}</td><td>${statusBadge(row.status_pembayaran)}</td><td>${statusBadge(row.status)}</td><td class="action-cell"><button class="icon-btn detail-rental" data-id="${row.id}">Lihat</button><button class="icon-btn edit-rental" data-id="${row.id}">Edit</button><button class="icon-btn danger delete-rental" data-id="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="11" class="empty">Tidak ada transaksi yang cocok.</td></tr>';
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
async function loadRooms() { try { state.rooms = await api('/api/rooms'); } catch (error) { state.rooms = []; showToast(error.message, 'error'); } }
function updateRentalEstimate() {
  const unit = state.units.find((row) => row.id === $('#rental-unit')?.value);
  const room = state.rooms.find((row) => row.id === $('#rental-room')?.value);
  const duration = Number($('#rental-form [name="durasi_jam"]')?.value);
  const target = $('#rental-estimate');
  if (!target) return;
  target.textContent = unit && Number.isFinite(duration) && duration > 0
    ? formatRupiah((Number(unit.tarif_per_jam) + Number(room?.tarif_per_jam || 0)) * duration)
    : 'Pilih unit dan durasi';
}
async function openRentalModal() {
  await Promise.all([loadCustomers(), loadUnits(), loadRooms()]);
  fillSelect('#rental-customer', state.customers.filter((row) => row.aktif), 'id', (row) => row.nama);
  fillSelect('#rental-unit', state.units.filter((row) => row.status === 'Tersedia'), 'id', (row) => `${row.nama_unit} · ${row.tipe_konsol} · ${formatRupiah(row.tarif_per_jam)}/jam`);
  const roomSelect = $('#rental-room');
  if (roomSelect) roomSelect.innerHTML = `<option value="">Tanpa ruangan tambahan</option>${state.rooms.filter((row) => row.status === 'Tersedia').map((row) => `<option value="${row.id}">${escapeHtml(row.nama_ruangan)} · ${escapeHtml(row.tipe_ruangan)} · ${formatRupiah(row.tarif_per_jam)}/jam</option>`).join('')}`;
  ensureInlineCustomerFields();
  updateRentalEstimate();
  modalControl('rental-modal', true);
}
async function saveRental(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());
  try { await api('/api/rentals', { method: 'POST', body: JSON.stringify(payload) }); modalControl('rental-modal', false); formElement.reset(); showToast('Transaksi berhasil disimpan.'); await Promise.all([loadRentals(), loadUnits(), loadRooms()]); updateRentalEstimate(); } catch (error) { showToast(error.message, 'error'); }
}
function showRentalDetail(id) {
  const row = state.rentals.find((item) => item.id === id); if (!row) return;
  $('#detail-content').innerHTML = `<div class="receipt-header"><div class="receipt-icon"><i data-lucide="receipt-text" aria-hidden="true"></i></div><div><p class="eyebrow">Detail transaksi</p><h2>Detail Transaksi</h2><span>${escapeHtml(row.kode_penyewaan)}</span></div><div class="receipt-status">${statusBadge(row.status)}</div></div><div class="receipt-total"><span>Total biaya</span><strong>${formatRupiah(row.total_biaya)}</strong><small>${row.durasi_jam} jam × (${formatRupiah(row.tarif_per_jam)} PS${row.nama_ruangan ? ` + ${formatRupiah(row.tarif_ruangan_per_jam)} ruang` : ''})/jam</small></div><div class="receipt-sections"><section><div class="receipt-section-title"><i data-lucide="gamepad-2" aria-hidden="true"></i><h3>Informasi penyewaan</h3></div><div class="receipt-grid"><span>ID transaksi</span><b>${escapeHtml(row.kode_penyewaan)}</b><span>Pelanggan</span><b>${escapeHtml(row.nama_pelanggan)}</b><span>Unit PlayStation</span><b>${escapeHtml(row.kode_unit)} · ${escapeHtml(row.nama_unit)}</b><span>Ruangan</span><b>${escapeHtml(row.nama_ruangan || 'Tanpa ruangan')}</b><span>Waktu mulai</span><b>${formatDate(row.mulai_sewa)}</b><span>Durasi</span><b>${row.durasi_jam} jam</b></div></section><section><div class="receipt-section-title"><i data-lucide="calculator" aria-hidden="true"></i><h3>Rincian biaya</h3></div><div class="receipt-grid"><span>Tarif PS per jam</span><b>${formatRupiah(row.tarif_per_jam)}</b><span>Tarif ruang per jam</span><b>${row.nama_ruangan ? formatRupiah(row.tarif_ruangan_per_jam) : '-'}</b><span>Total biaya</span><b class="accent-value">${formatRupiah(row.total_biaya)}</b><span>Jumlah pembayaran</span><b class="paid-value">${formatRupiah(row.jumlah_bayar)}</b><span>Piutang</span><b class="debt-value">${formatRupiah(row.piutang)}</b></div></section><section><div class="receipt-section-title"><i data-lucide="credit-card" aria-hidden="true"></i><h3>Pembayaran</h3></div><div class="receipt-grid"><span>Metode pembayaran</span><b>${escapeHtml(row.metode_pembayaran || '-')}</b><span>Status pembayaran</span><b>${statusBadge(row.status_pembayaran)}</b><span>Tanggal pembayaran</span><b>${formatDate(row.tanggal_bayar)}</b></div></section></div>`;
  refreshIcons(); modalControl('detail-modal', true);
}

function prepareUnitForm() {
  const rateInput = $('#unit-form [name="tarif_per_jam"]');
  if (!rateInput) return;
  const fields = rateInput.closest('.grid-2');
  rateInput.closest('label')?.remove();
  fields?.classList.remove('grid-2');
  const priceLabel = $('#price-list')?.closest('.price-list-card')?.querySelector('.live-label');
  if (priceLabel) priceLabel.textContent = 'Tarif berlaku per tipe konsol';
}
function renderUnits(rows = state.units) {
  const target = $('#unit-list'); if (!target) return;
  const rateHeader = target.closest('table')?.querySelector('thead th:nth-child(4)');
  if (rateHeader?.textContent.trim() === 'Tarif/jam') rateHeader.remove();
  const query = ($('#unit-search')?.value || '').toLowerCase(); const status = $('#unit-status-filter')?.value || '';
  const filtered = rows.filter((row) => (!status || row.status === status) && [row.kode_unit, row.nama_unit, row.tipe_konsol].some((value) => String(value || '').toLowerCase().includes(query)));
  target.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${escapeHtml(row.kode_unit)}</td><td>${escapeHtml(row.nama_unit)}</td><td>${escapeHtml(row.tipe_konsol)}</td><td>${statusBadge(row.status)}</td><td>${escapeHtml(row.catatan || '-')}</td><td class="action-cell"><button class="icon-btn edit-unit" data-id="${row.id}">Edit</button><button class="icon-btn danger delete-unit" data-id="${row.id}">Hapus</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Belum ada unit yang cocok.</td></tr>';
  setText('#unit-count-page', filtered.length);
  setText('#unit-available-page', rows.filter((row) => row.status === 'Tersedia').length);
  setText('#unit-rented-page', rows.filter((row) => row.status === 'Disewa').length);
  setText('#unit-maintenance-page', rows.filter((row) => row.status === 'Perawatan').length);
  renderPriceList(rows);
}
function renderPriceList(rows = state.units) {
  const target = $('#price-list'); if (!target) return;
  target.innerHTML = rows.length ? rows.map((row) => `<article class="price-item"><div class="price-item-icon"><i data-lucide="gamepad-2" aria-hidden="true"></i></div><div class="price-item-main"><b>Tarif ${escapeHtml(row.tipe_konsol)}</b><small>Berlaku untuk semua unit ${escapeHtml(row.tipe_konsol)}</small></div><label class="console-rate-control"><span>Tarif per jam</span><input data-tariff-input="${row.tipe_konsol}" type="number" min="1" step="1000" value="${Number(row.tarif_per_jam)}" aria-label="Tarif ${row.tipe_konsol} per jam"></label><button type="button" class="secondary-btn console-rate-save" data-save-tariff="${row.tipe_konsol}"><i data-lucide="save" aria-hidden="true"></i>Simpan</button></article>`).join('') : '<div class="empty">Tarif konsol belum tersedia.</div>';
  refreshIcons();
}
async function loadUnits() { try { [state.units, state.tariffs] = await Promise.all([api('/api/units'), api('/api/tariffs')]); renderUnits(); renderPriceList(state.tariffs); } catch (error) { showToast(error.message, 'error'); } }
async function saveUnit(event) { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); try { await api('/api/units', { method: 'POST', body: JSON.stringify(payload) }); modalControl('unit-modal', false); event.currentTarget.reset(); showToast('Unit berhasil ditambahkan.'); await loadUnits(); } catch (error) { showToast(error.message, 'error'); } }
async function saveConsoleTariff(type) { const amount = Number($(`[data-tariff-input="${type}"]`)?.value); if (!Number.isFinite(amount) || amount <= 0) { showToast('Tarif per jam harus lebih dari nol.', 'error'); return; } try { await api(`/api/tariffs/${type}`, { method: 'PATCH', body: JSON.stringify({ tarif_per_jam: amount }) }); showToast(`Tarif ${type} berhasil diperbarui.`); await loadUnits(); } catch (error) { showToast(error.message, 'error'); } }

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
  const consoleType = window.prompt('Tipe konsol (PS4 atau PS5):', row.tipe_konsol); if (consoleType === null) return;
  const status = window.prompt('Status: Tersedia, Disewa, atau Perawatan:', row.status); if (status === null) return;
  const note = window.prompt('Catatan unit:', row.catatan || ''); if (note === null) return;
  try { await api(`/api/units/${id}`, { method: 'PATCH', body: JSON.stringify({ nama_unit: name, tipe_konsol: consoleType.trim().toUpperCase(), status, catatan: note }) }); showToast('Unit berhasil diperbarui.'); await loadUnits(); } catch (error) { showToast(error.message, 'error'); }
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
    if (button.dataset.saveTariff) saveConsoleTariff(button.dataset.saveTariff);
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
  $('#rental-unit')?.addEventListener('change', updateRentalEstimate); $('#rental-room')?.addEventListener('change', updateRentalEstimate); $('#rental-form [name="durasi_jam"]')?.addEventListener('input', updateRentalEstimate);
  $('#rental-search')?.addEventListener('input', () => renderRentals()); $('#rental-status')?.addEventListener('change', () => renderRentals()); $('#unit-search')?.addEventListener('input', () => renderUnits()); $('#unit-status-filter')?.addEventListener('change', () => renderUnits()); $('#customer-search')?.addEventListener('input', () => renderCustomers()); $('#payment-search')?.addEventListener('input', () => renderPayments());
  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => { state.period = button.dataset.period; document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('active', item === button)); pageName === 'dashboard' ? loadDashboard() : loadReport(); }));
  $('#custom-period')?.addEventListener('change', () => { if ($('#custom-start')?.value && $('#custom-end')?.value) { state.period = 'custom'; pageName === 'dashboard' ? loadDashboard() : loadReport(); } });
}
async function start() {
  document.title = document.title.replace('PlayLedger', 'PlayVora');
  if (!document.querySelector('link[rel="icon"]')) {
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/svg+xml';
    favicon.href = 'favicon.svg';
    document.head.appendChild(favicon);
  }
  document.querySelectorAll('.eyebrow').forEach((element) => { element.textContent = element.textContent.replace('PlayLedger', 'PlayVora'); });
  if (pageName === 'dashboard') document.querySelector('h1')?.replaceChildren('Dashboard');
  if (pageName === 'dashboard') document.querySelector('.hero-badge')?.replaceChildren('PlayVora Analytics');
  document.querySelectorAll('#refresh-page').forEach((button) => { button.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>'; button.title = 'Refresh Data'; button.setAttribute('aria-label', 'Refresh Data'); });
  if (pageName === 'units') prepareUnitForm();
  applyNav(); ensureDashboardPeriodControls(); bindCommon();
  if (pageName === 'dashboard') await loadDashboard();
  if (pageName === 'rentals') await loadRentals();
  if (pageName === 'units') await loadUnits();
  if (pageName === 'customers') { await loadCustomers(); await loadRentals(); }
  if (pageName === 'payments') await loadPayments();
  if (pageName === 'reports') await loadReport();
}
start();
