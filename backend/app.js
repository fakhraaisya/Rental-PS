const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHED_KEY = process.env.SUPABASE_PUBLISHED_KEY;
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const jsonHeaders = { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHED_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHED_KEY}` };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function supabaseRequest(table, options = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(options.query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const requestHeaders = { ...jsonHeaders };
  if (options.body) requestHeaders.Prefer = options.prefer || 'return=representation';
  const response = await fetch(url, { method: options.method || 'GET', headers: requestHeaders, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new HttpError(response.status, data?.message || data?.hint || `Supabase error ${response.status}`);
  return data;
}

async function parseBody(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Format JSON tidak valid.'); }
}

function getDateRange(requestUrl) {
  const period = requestUrl.searchParams.get('period') || 'month';
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (period === 'all') {
    start.setTime(0);
    return { period, start, end };
  }
  if (period === 'today') start.setHours(0, 0, 0, 0);
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
    const customStart = requestUrl.searchParams.get('start');
    const customEnd = requestUrl.searchParams.get('end');
    if (!customStart || !customEnd) throw new HttpError(400, 'Periode custom membutuhkan tanggal mulai dan selesai.');
    start.setTime(new Date(`${customStart}T00:00:00`).getTime());
    end.setTime(new Date(`${customEnd}T23:59:59`).getTime());
  }
  return { period, start, end };
}

function isInRange(value, range) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= range.start && date <= range.end;
}

function calculatePaymentStatus(total, paid) {
  if (paid <= 0) return 'Belum Lunas';
  if (paid >= total) return 'Lunas';
  return 'Sebagian';
}

async function getReportRows() {
  return supabaseRequest('v_laporan_pendapatan', { query: { select: '*', order: 'mulai_sewa.desc' } });
}

async function getUnitsWithRates() {
  const [units, tariffs] = await Promise.all([
    supabaseRequest('unit_playstation', { query: { select: '*', order: 'kode_unit.asc' } }),
    supabaseRequest('tarif_konsol', { query: { select: 'tipe_konsol,tarif_per_jam' } }),
  ]);
  const ratesByType = Object.fromEntries(tariffs.map((row) => [row.tipe_konsol, Number(row.tarif_per_jam)]));
  return units.map((unit) => ({ ...unit, tarif_per_jam: ratesByType[unit.tipe_konsol] }));
}

async function getRoomsWithRates() {
  const [rooms, tariffs] = await Promise.all([
    supabaseRequest('ruangan', { query: { select: '*', order: 'kode_ruangan.asc' } }),
    supabaseRequest('tarif_ruangan', { query: { select: 'tipe_ruangan,tarif_per_jam' } }),
  ]);
  const ratesByType = Object.fromEntries(tariffs.map((row) => [row.tipe_ruangan, Number(row.tarif_per_jam)]));
  return rooms.map((room) => ({ ...room, tarif_per_jam: ratesByType[room.tipe_ruangan] }));
}

async function getDashboard(requestUrl) {
  const range = getDateRange(requestUrl);
  const [rows, units, customers] = await Promise.all([
    getReportRows(),
    supabaseRequest('unit_playstation', { query: { select: '*' } }),
    supabaseRequest('pelanggan', { query: { select: 'id,nama,aktif' } }),
  ]);
  const filteredRows = rows.filter((row) => isInRange(row.mulai_sewa, range));
  const totalBilled = filteredRows.reduce((sum, row) => sum + Number(row.total_biaya || 0), 0);
  const totalPaid = filteredRows.reduce((sum, row) => sum + Math.min(Number(row.jumlah_bayar || 0), Number(row.total_biaya || 0)), 0);
  const totalReceivable = Math.max(totalBilled - totalPaid, 0);
  const packageMap = {};
  const paymentMap = {};
  const customerMap = {};
  filteredRows.forEach((row) => {
    const paid = Math.min(Number(row.jumlah_bayar || 0), Number(row.total_biaya || 0));
    packageMap[row.tipe_konsol] = (packageMap[row.tipe_konsol] || 0) + Number(row.total_biaya || 0);
    customerMap[row.nama_pelanggan] = (customerMap[row.nama_pelanggan] || 0) + Number(row.total_biaya || 0);
    if (row.metode_pembayaran) paymentMap[row.metode_pembayaran] = (paymentMap[row.metode_pembayaran] || 0) + paid;
  });
  return {
    period: range.period,
    updatedAt: new Date().toISOString(),
    collectedRevenue: totalPaid,
    totalBilled,
    totalReceivable,
    customerCount: customers.filter((item) => item.aktif !== false).length,
    transactionCount: filteredRows.length,
    completedSessions: filteredRows.filter((row) => row.status === 'Selesai').length,
    activeSessions: filteredRows.filter((row) => row.status === 'Berlangsung'),
    totalHours: filteredRows.reduce((sum, row) => sum + Number(row.durasi_jam || 0), 0),
    averageTransaction: filteredRows.length ? totalBilled / filteredRows.length : 0,
    paymentRate: totalBilled ? Math.round((totalPaid / totalBilled) * 100) : 0,
    unitSummary: { available: units.filter((item) => item.status === 'Tersedia').length, rented: units.filter((item) => item.status === 'Disewa').length, maintenance: units.filter((item) => item.status === 'Perawatan').length, total: units.length },
    consoleBreakdown: Object.entries(packageMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    paymentBreakdown: Object.entries(paymentMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    topCustomers: Object.entries(customerMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    recentTransactions: rows.slice(0, 8),
  };
}

async function validateCustomer(customerId) {
  const rows = await supabaseRequest('pelanggan', { query: { select: 'id', id: `eq.${customerId}`, aktif: 'eq.true' } });
  if (!rows[0]) throw new HttpError(400, 'Pelanggan aktif tidak ditemukan.');
}

async function validateUnitAvailable(unitId) {
  const rows = await supabaseRequest('unit_playstation', { query: { select: '*', id: `eq.${unitId}` } });
  if (!rows[0]) throw new HttpError(400, 'Unit PlayStation tidak ditemukan.');
  if (rows[0].status !== 'Tersedia') throw new HttpError(409, `Unit sedang ${rows[0].status.toLowerCase()} dan tidak dapat disewa.`);
  return rows[0];
}

async function validateRoomAvailable(roomId) {
  if (!roomId) return null;
  const rows = await supabaseRequest('ruangan', { query: { select: '*', id: `eq.${roomId}` } });
  if (!rows[0]) throw new HttpError(400, 'Ruangan tidak ditemukan.');
  if (rows[0].status !== 'Tersedia') throw new HttpError(409, `Ruangan sedang ${rows[0].status.toLowerCase()} dan tidak dapat disewa.`);
  return rows[0];
}

async function route(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathParts = requestUrl.pathname.split('/').filter(Boolean);
  const resource = pathParts[1];
  const id = pathParts[2];
  const send = (status, payload) => { response.writeHead(status, { ...jsonHeaders, 'Access-Control-Allow-Origin': '*' }); response.end(payload === null ? '' : JSON.stringify(payload)); };
  try {
    if (request.method === 'OPTIONS') return send(204, null);
    if (request.method === 'GET' && requestUrl.pathname === '/api/dashboard') return send(200, await getDashboard(requestUrl));
    if (request.method === 'GET' && requestUrl.pathname === '/api/report') {
      const range = getDateRange(requestUrl);
      return send(200, (await getReportRows()).filter((row) => isInRange(row.mulai_sewa, range)));
    }
    if (request.method === 'GET' && resource === 'customers') return send(200, await supabaseRequest('pelanggan', { query: { select: '*', order: 'nama.asc' } }));
    if (request.method === 'GET' && resource === 'units') return send(200, await getUnitsWithRates());
    if (request.method === 'GET' && resource === 'rooms') return send(200, await getRoomsWithRates());
    if (request.method === 'GET' && resource === 'tariffs') return send(200, await supabaseRequest('tarif_konsol', { query: { select: '*', order: 'tipe_konsol.asc' } }));
    if (request.method === 'GET' && resource === 'rentals') return send(200, await getReportRows());
    if (request.method === 'GET' && resource === 'payments') return send(200, await getReportRows());

    if (request.method === 'POST' && resource === 'customers') {
      const body = await parseBody(request);
      if (!body.nama || body.nama.trim().length < 2) throw new HttpError(400, 'Nama pelanggan minimal 2 karakter.');
      return send(201, (await supabaseRequest('pelanggan', { method: 'POST', body: { nama: body.nama.trim(), nomor_telepon: body.nomor_telepon?.trim() || null, email: body.email?.trim() || null, aktif: true } }))[0]);
    }
    if (request.method === 'PATCH' && resource === 'customers' && id) {
      const body = await parseBody(request);
      if (body.nama !== undefined && body.nama.trim().length < 2) throw new HttpError(400, 'Nama pelanggan minimal 2 karakter.');
      return send(200, (await supabaseRequest('pelanggan', { method: 'PATCH', query: { id: `eq.${id}` }, body }))[0]);
    }
    if (request.method === 'DELETE' && resource === 'customers' && id) return send(204, await supabaseRequest('pelanggan', { method: 'DELETE', query: { id: `eq.${id}` } }));

    if (request.method === 'POST' && resource === 'units') {
      const body = await parseBody(request);
      const consoleType = body.tipe_konsol || 'PS4';
      if (!body.kode_unit || !body.nama_unit || !['PS4', 'PS5'].includes(consoleType)) throw new HttpError(400, 'Kode, nama, dan tipe konsol wajib valid.');
      return send(201, (await supabaseRequest('unit_playstation', { method: 'POST', body: { kode_unit: body.kode_unit.trim(), nama_unit: body.nama_unit.trim(), tipe_konsol: consoleType, status: body.status || 'Tersedia', catatan: body.catatan || null } }))[0]);
    }
    if (request.method === 'PATCH' && resource === 'tariffs' && id) {
      const body = await parseBody(request);
      const amount = Number(body.tarif_per_jam);
      if (!['PS4', 'PS5'].includes(id) || !Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Tipe konsol atau tarif tidak valid.');
      return send(200, (await supabaseRequest('tarif_konsol', { method: 'PATCH', query: { tipe_konsol: `eq.${id}` }, body: { tarif_per_jam: amount } }))[0]);
    }
    if (request.method === 'PATCH' && resource === 'units' && id) return send(200, (await supabaseRequest('unit_playstation', { method: 'PATCH', query: { id: `eq.${id}` }, body: await parseBody(request) }))[0]);
    if (request.method === 'DELETE' && resource === 'units' && id) return send(204, await supabaseRequest('unit_playstation', { method: 'DELETE', query: { id: `eq.${id}` } }));

    if (request.method === 'POST' && resource === 'rentals') {
      const body = await parseBody(request);
      if (body.pelanggan_id === '__new__') {
        if (!body.customer_name || body.customer_name.trim().length < 2) throw new HttpError(400, 'Nama pelanggan baru minimal 2 karakter.');
        const createdCustomer = (await supabaseRequest('pelanggan', { method: 'POST', body: { nama: body.customer_name.trim(), nomor_telepon: body.customer_phone?.trim() || null, email: body.customer_email?.trim() || null, aktif: true } }))[0];
        body.pelanggan_id = createdCustomer.id;
      }
      const duration = Number(body.durasi_jam);
      if (!body.pelanggan_id || !body.unit_id || !Number.isFinite(duration) || duration <= 0) throw new HttpError(400, 'Pelanggan, unit, dan durasi lebih dari nol wajib diisi.');
      await validateCustomer(body.pelanggan_id);
      const unit = await validateUnitAvailable(body.unit_id);
      const roomId = body.ruangan_id || null;
      const room = await validateRoomAvailable(roomId);
      const status = body.status || 'Berlangsung';
      const tariffRows = await supabaseRequest('tarif_konsol', { query: { select: 'tarif_per_jam', tipe_konsol: `eq.${unit.tipe_konsol}` } });
      const hourlyRate = Number(tariffRows[0]?.tarif_per_jam);
      if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) throw new HttpError(400, `Tarif ${unit.tipe_konsol} tidak ditemukan.`);
      const roomRate = room ? Number((await supabaseRequest('tarif_ruangan', { query: { select: 'tarif_per_jam', tipe_ruangan: `eq.${room.tipe_ruangan}` } }))[0]?.tarif_per_jam || 0) : 0;
      if (room && roomRate <= 0) throw new HttpError(400, `Tarif ruang ${room.tipe_ruangan} tidak ditemukan.`);
      const total = Number(((hourlyRate + roomRate) * duration).toFixed(2));
      const rental = (await supabaseRequest('penyewaan', { method: 'POST', body: { kode_penyewaan: body.kode_penyewaan || `SEWA-${Date.now().toString().slice(-8)}`, pelanggan_id: body.pelanggan_id, unit_id: body.unit_id, ruangan_id: roomId, mulai_sewa: body.mulai_sewa || new Date().toISOString(), durasi_jam: duration, tarif_per_jam: hourlyRate, tarif_ruangan_per_jam: roomRate, total_biaya: total, status, catatan: body.catatan || null } }))[0];
      if (status === 'Berlangsung') {
        await supabaseRequest('unit_playstation', { method: 'PATCH', query: { id: `eq.${unit.id}` }, body: { status: 'Disewa' } });
        if (room) await supabaseRequest('ruangan', { method: 'PATCH', query: { id: `eq.${room.id}` }, body: { status: 'Disewa' } });
      }
      if (Number(body.jumlah_bayar) > 0) await savePayment(rental.id, Number(body.jumlah_bayar), body.metode_pembayaran || 'Tunai');
      return send(201, rental);
    }
    if (request.method === 'PATCH' && resource === 'rentals' && id) {
      const body = await parseBody(request);
      if (body.durasi_jam !== undefined && Number(body.durasi_jam) <= 0) throw new HttpError(400, 'Durasi harus lebih dari nol.');
      const current = (await supabaseRequest('penyewaan', { query: { select: 'unit_id,ruangan_id,status,tarif_per_jam,tarif_ruangan_per_jam', id: `eq.${id}` } }))[0];
      if (!current) throw new HttpError(404, 'Transaksi penyewaan tidak ditemukan.');
      if (body.durasi_jam !== undefined) body.total_biaya = Number((Number(body.durasi_jam) * (Number(current.tarif_per_jam) + Number(current.tarif_ruangan_per_jam || 0))).toFixed(2));
      if (current.status !== 'Berlangsung' && body.status === 'Berlangsung') {
        await validateUnitAvailable(current.unit_id);
        await validateRoomAvailable(current.ruangan_id);
      }
      const updated = (await supabaseRequest('penyewaan', { method: 'PATCH', query: { id: `eq.${id}` }, body }))[0];
      if (current.status !== 'Berlangsung' && body.status === 'Berlangsung') {
        await supabaseRequest('unit_playstation', { method: 'PATCH', query: { id: `eq.${current.unit_id}` }, body: { status: 'Disewa' } });
        if (current.ruangan_id) await supabaseRequest('ruangan', { method: 'PATCH', query: { id: `eq.${current.ruangan_id}` }, body: { status: 'Disewa' } });
      }
      if (current.status === 'Berlangsung' && body.status && body.status !== 'Berlangsung') {
        await supabaseRequest('unit_playstation', { method: 'PATCH', query: { id: `eq.${current.unit_id}` }, body: { status: 'Tersedia' } });
        if (current.ruangan_id) await supabaseRequest('ruangan', { method: 'PATCH', query: { id: `eq.${current.ruangan_id}` }, body: { status: 'Tersedia' } });
      }
      return send(200, updated);
    }
    if (request.method === 'DELETE' && resource === 'rentals' && id) {
      const current = (await supabaseRequest('penyewaan', { query: { select: 'unit_id,ruangan_id,status', id: `eq.${id}` } }))[0];
      await supabaseRequest('penyewaan', { method: 'DELETE', query: { id: `eq.${id}` } });
      if (current?.status === 'Berlangsung') {
        await supabaseRequest('unit_playstation', { method: 'PATCH', query: { id: `eq.${current.unit_id}` }, body: { status: 'Tersedia' } });
        if (current.ruangan_id) await supabaseRequest('ruangan', { method: 'PATCH', query: { id: `eq.${current.ruangan_id}` }, body: { status: 'Tersedia' } });
      }
      return send(204, null);
    }

    if (request.method === 'POST' && resource === 'payments') {
      const body = await parseBody(request);
      if (!body.penyewaan_id || !Number.isFinite(Number(body.jumlah_bayar)) || Number(body.jumlah_bayar) <= 0) throw new HttpError(400, 'Transaksi dan jumlah pembayaran wajib valid.');
      return send(201, await savePayment(body.penyewaan_id, Number(body.jumlah_bayar), body.metode_pembayaran || 'Tunai', body.catatan));
    }
    return send(404, { message: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    return send(error.status || 500, { message: error.message || 'Terjadi kesalahan server.' });
  }
}

async function savePayment(rentalId, amount, method, note = null) {
  const rental = (await supabaseRequest('penyewaan', { query: { select: 'id,total_biaya', id: `eq.${rentalId}` } }))[0];
  if (!rental) throw new HttpError(400, 'Transaksi penyewaan tidak ditemukan.');
  const payment = { penyewaan_id: rentalId, jumlah_bayar: Math.min(amount, Number(rental.total_biaya)), metode_pembayaran: method, status_pembayaran: calculatePaymentStatus(Number(rental.total_biaya), amount), catatan: note };
  const result = await supabaseRequest('pembayaran', { method: 'POST', body: payment, prefer: 'resolution=merge-duplicates,return=representation' });
  return result[0];
}

function serveStatic(request, response) {
  const requested = new URL(request.url, 'http://localhost').pathname;
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\//, '');
  const filePath = path.normalize(path.join(FRONTEND_DIR, relative));
  if (!filePath.startsWith(FRONTEND_DIR)) return response.writeHead(403).end();
  fs.readFile(filePath, (error, content) => { if (error) return response.writeHead(404).end('Not found'); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }; response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'text/plain' }); response.end(content); });
}

http.createServer((request, response) =>
  request.url.startsWith('/api/')
    ? route(request, response)
    : serveStatic(request, response)
).listen(PORT, '0.0.0.0', () => {
  console.log(`Rental revenue app running on port ${PORT}`);
});