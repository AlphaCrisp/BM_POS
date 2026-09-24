const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// Middleware parsing JSON & URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Layani file statis frontend dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. INISIALISASI DATABASE & JALUR PENYIMPANAN
// ==========================================
// Gunakan path Electron userData jika tersedia, atau fallback ke __dirname
const dataDir = process.env.USER_DATA_PATH || __dirname;

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bakery.db');
const defaultDbPath = path.join(__dirname, 'bakery.db');

// Jika dijalankan di Electron pertama kali dan file database di AppData belum ada,
// salin bakery.db lokal agar data awal tidak hilang
if (dataDir !== __dirname && !fs.existsSync(dbPath) && fs.existsSync(defaultDbPath)) {
  try {
    fs.copyFileSync(defaultDbPath, dbPath);
    console.log('Database awal berhasil disalin ke direktori pengguna.');
  } catch (err) {
    console.error('Gagal menyalin database awal:', err.message);
  }
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`Database SQLite aktif di: ${dbPath}`);

// ==========================================
// 2. STRUKTUR TABEL DATABASE
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'Umum',
    unit TEXT NOT NULL DEFAULT 'pcs',
    cost_price REAL NOT NULL DEFAULT 0,
    sell_price REAL NOT NULL DEFAULT 0,
    tier1_price REAL,
    tier2_price REAL,
    tier3_price REAL,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 5,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pin TEXT,
    role TEXT NOT NULL DEFAULT 'CASHIER',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE NOT NULL,
    tier_used INTEGER NOT NULL DEFAULT 0,
    total_gross REAL NOT NULL DEFAULT 0,
    total_cogs REAL NOT NULL DEFAULT 0,
    total_profit REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    cash_tendered REAL NOT NULL DEFAULT 0,
    change_due REAL NOT NULL DEFAULT 0,
    cashier_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    pricing_type TEXT NOT NULL,
    cost_at_sale REAL NOT NULL,
    sell_at_sale REAL NOT NULL,
    subtotal_gross REAL NOT NULL,
    subtotal_cogs REAL NOT NULL,
    subtotal_profit REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS eod_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date DATE UNIQUE NOT NULL,
    opening_float REAL NOT NULL DEFAULT 0,
    cash_sales REAL NOT NULL DEFAULT 0,
    expected_cash REAL NOT NULL DEFAULT 0,
    actual_cash_counted REAL NOT NULL DEFAULT 0,
    discrepancy REAL NOT NULL DEFAULT 0,
    reorder_fund REAL NOT NULL DEFAULT 0,
    net_profit REAL NOT NULL DEFAULT 0,
    closed_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_eod_reports_date ON eod_reports(report_date);
  

  CREATE TABLE IF NOT EXISTS product_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    returned_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// Pastikan kolom updated_at ada di tabel products
const productCols = db.prepare("PRAGMA table_info(products)").all();
const productColNames = productCols.map(c => c.name);
if (!productColNames.includes('updated_at')) {
  // 1. Tambahkan kolom tanpa klausa DEFAULT CURRENT_TIMESTAMP
  db.exec("ALTER TABLE products ADD COLUMN updated_at DATETIME;");
  // 2. Isi nilai baris yang sudah ada dengan timestamp saat ini
  db.exec("UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;");
}

// Migrasi aman untuk kolom tabel users (pin, name, role, created_at)
const userCols = db.prepare("PRAGMA table_info(users)").all();
const userColNames = userCols.map(c => c.name);

if (!userColNames.includes('name')) {
  db.exec("ALTER TABLE users ADD COLUMN name TEXT DEFAULT 'Staf';");
}
if (!userColNames.includes('pin')) {
  db.exec("ALTER TABLE users ADD COLUMN pin TEXT;");
}
if (!userColNames.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'CASHIER';");
}
if (!userColNames.includes('created_at')) {
  db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME;");
  db.exec("UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;");
}

// Inisialisasi akun bawaan jika tabel users kosong
const userCheck = db.prepare("SELECT COUNT(*) AS count FROM users").get();
if (userCheck.count === 0) {
  db.prepare(`
    INSERT INTO users (name, username, password, pin, role)
    VALUES 
      ('Owner Toko', 'admin', 'admin123', '8888', 'ADMIN'),
      ('Kasir Toko', 'cashier', '1234', '1234', 'CASHIER')
  `).run();
}

// ==========================================
// 3. API OTENTIKASI & PENGGUNA
// ==========================================
app.post('/api/login', (req, res) => {
  const { username, credential } = req.body;
  if (!username || !credential) {
    return res.status(400).json({ error: 'Username dan Password/PIN wajib diisi.' });
  }

  const user = db.prepare(`
    SELECT id, name, username, role 
    FROM users 
    WHERE username = ? AND (password = ? OR pin = ?)
  `).get(username, credential, credential);

  if (!user) {
    return res.status(401).json({ error: 'Kredensial tidak valid atau akun tidak ditemukan.' });
  }

  res.json({ success: true, user });
});

app.get('/api/admin/employees', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT id, name, username, role, pin, created_at 
      FROM users 
      ORDER BY id ASC
    `).all();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/employees', (req, res) => {
  const { name, username, password, pin, role } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Nama, username, dan password wajib diisi.' });
  }

  try {
    const cleanPin = pin && pin.trim() !== '' ? pin.trim() : null;

    const result = db.prepare(`
      INSERT INTO users (name, username, password, pin, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), username.trim(), password, cleanPin, role || 'CASHIER');

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Error tambah karyawan:', err.message);
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username sudah digunakan oleh akun lain.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. API PRODUK & KATALOG
// ==========================================
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', (req, res) => {
  const {
    barcode, name, category, unit, cost_price, 
    sell_price, tier1_price, tier2_price, tier3_price, stock_qty
  } = req.body;

  if (!name || !sell_price) {
    return res.status(400).json({ error: 'Nama barang dan harga jual wajib diisi.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO products (
        barcode, name, category, unit, cost_price, sell_price, 
        tier1_price, tier2_price, tier3_price, stock_qty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      barcode ? barcode.trim() : null,
      name.trim(),
      category || 'Umum',
      unit || 'pcs',
      parseFloat(cost_price) || 0,
      parseFloat(sell_price) || 0,
      tier1_price ? parseFloat(tier1_price) : null,
      tier2_price ? parseFloat(tier2_price) : null,
      tier3_price ? parseFloat(tier3_price) : null,
      parseInt(stock_qty, 10) || 0
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Barcode sudah terdaftar pada barang lain.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id', (req, res) => {
  const { id } = req.params;
  const {
    name, barcode, category, unit, min_stock_alert,
    cost_price, sell_price, tier1_price, tier2_price, tier3_price
  } = req.body;

  try {
    db.prepare(`
      UPDATE products SET
        name = ?,
        barcode = ?,
        category = ?,
        unit = ?,
        min_stock_alert = ?,
        cost_price = ?,
        sell_price = ?,
        tier1_price = ?,
        tier2_price = ?,
        tier3_price = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      barcode ? barcode.trim() : null,
      category || 'Umum',
      unit,
      parseInt(min_stock_alert, 10) || 5,
      parseFloat(cost_price) || 0,
      parseFloat(sell_price) || 0,
      tier1_price ? parseFloat(tier1_price) : null,
      tier2_price ? parseFloat(tier2_price) : null,
      tier3_price ? parseFloat(tier3_price) : null,
      id
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products/:id/adjust-stock', (req, res) => {
  const { id } = req.params;
  const { adjustmentQty, reason } = req.body;
  const delta = parseInt(adjustmentQty, 10);

  if (isNaN(delta) || delta === 0) {
    return res.status(400).json({ error: 'Jumlah penyesuaian tidak valid.' });
  }

  try {
    db.prepare(`
      UPDATE products 
      SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(delta, id);

    const updated = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
    res.json({ success: true, currentStock: updated ? updated.stock_qty : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. API TRANSAKSI PENJUALAN (CHECKOUT)
// ==========================================
app.post('/api/checkout', (req, res) => {
  const { tierUsed, paymentMethod, cashierId, cashTendered, changeDue, items } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'Keranjang belanja kosong.' });
  }

  const checkoutTx = db.transaction(() => {
      // 1. VALIDASI STOK SETIAP ITEM
      for (const item of items) {
        const prod = db.prepare("SELECT name, stock_qty FROM products WHERE id = ?").get(item.productId);
        if (!prod) {
          throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan.`);
        }
        if (prod.stock_qty <= 0) {
          throw new Error(`Barang "${prod.name}" sudah habis (Stok: 0)!`);
        }
        if (prod.stock_qty < item.quantity) {
          throw new Error(`Stok "${prod.name}" tidak mencukupi! Tersedia: ${prod.stock_qty}, diminta: ${item.quantity}.`);
        }
      }

  // HITUNG TOTAL & SIMPAN penjualan    
  // 2. HITUNG TOTAL & SIMPAN PENJUALAN
    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;
    const totalGross = items.reduce((acc, i) => acc + i.subtotalGross, 0);
    const totalCogs = items.reduce((acc, i) => acc + i.subtotalCogs, 0);
    const totalProfit = items.reduce((acc, i) => acc + i.subtotalProfit, 0);

    const saleResult = db.prepare(`
      INSERT INTO sales (receipt_no, tier_used, total_gross, total_cogs, total_profit, payment_method, cash_tendered, change_due, cashier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receiptNo, tierUsed, totalGross, totalCogs, totalProfit, paymentMethod, cashTendered, changeDue, cashierId);

    const saleId = saleResult.lastInsertRowid;

    // 2. Simpan item penjualan dan potong stok
    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, quantity, pricing_type, 
        cost_at_sale, sell_at_sale, subtotal_gross, subtotal_cogs, subtotal_profit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deductStock = db.prepare(`
      UPDATE products 
      SET stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    for (const item of items) {
      insertItem.run(
        saleId,
        item.productId,
        item.quantity,
        item.pricingType || 'REGULAR',
        item.costAtSale,
        item.sellAtSale,
        item.subtotalGross,
        item.subtotalCogs,
        item.subtotalProfit
      );

      deductStock.run(item.quantity, item.productId);
    }

    return receiptNo;
  });

  try {
    const generatedReceipt = checkoutTx();
    res.json({ success: true, receiptNo: generatedReceipt });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses transaksi: ' + err.message });
  }
});

// ==========================================
// 6. API RETUR BARANG
// ==========================================
app.post('/api/admin/returns', (req, res) => {
  const { productId, quantity, reason, notes, returnedBy } = req.body;
  const qty = parseInt(quantity, 10);

  if (!productId || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'ID produk dan jumlah retur yang valid wajib diisi.' });
  }

  const returnTx = db.transaction(() => {
    const product = db.prepare('SELECT id, name, stock_qty FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new Error('Produk tidak ditemukan.');
    }

    if (product.stock_qty < qty) {
      throw new Error(`Stok tidak mencukupi untuk diretur. Stok saat ini: ${product.stock_qty}, jumlah retur: ${qty}`);
    }

    db.prepare(`
      UPDATE products 
      SET stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(qty, productId);

    db.prepare(`
      INSERT INTO product_returns (product_id, quantity, reason, notes, returned_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(productId, qty, reason || 'Retur ke Supplier', notes || '', returnedBy || 'Pemilik Toko');

    const updatedProduct = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId);
    return { name: product.name, remainingStock: updatedProduct.stock_qty };
  });

  try {
    const result = returnTx();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/returns', (req, res) => {
  try {
    const returns = db.prepare(`
      SELECT 
        r.id,
        r.product_id,
        p.name AS product_name,
        p.unit,
        r.quantity,
        r.reason,
        r.notes,
        r.returned_by,
        r.created_at
      FROM product_returns r
      JOIN products p ON r.product_id = p.id
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all();
    res.json(returns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. API FINANSIAL & REKAP HARIAN (EOD)
// ==========================================
app.get('/api/admin/financials', (req, res) => {
  try {
    // Ringkasan penjualan hari ini
    const todaySummary = db.prepare(`
      SELECT 
        COALESCE(SUM(total_gross), 0) AS gross_sales,
        COALESCE(SUM(total_cogs), 0) AS reorder_fund,
        COALESCE(SUM(total_profit), 0) AS net_profit,
        COUNT(id) AS receipt_count
      FROM sales 
      WHERE date(created_at, 'localtime') = date('now', 'localtime')
    `).get();

    // 20 transaksi penjualan terakhir
    const recentSales = db.prepare(`
      SELECT 
        s.receipt_no,
        s.total_gross,
        s.total_cogs,
        s.total_profit,
        s.payment_method,
        s.created_at,
        s.cashier_id,
        COALESCE(u.name, 'Kasir') AS cashier_name,
        u.username AS cashier_username
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      ORDER BY s.created_at DESC
      LIMIT 20
    `).all();

    res.json({ today: todaySummary, recentSales });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/eod-preview', (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_gross ELSE 0 END), 0) AS cash_sales,
        COALESCE(SUM(total_cogs), 0) AS total_cogs,
        COALESCE(SUM(total_profit), 0) AS total_profit
      FROM sales
      WHERE date(created_at, 'localtime') = date('now', 'localtime')
    `).get();

    const pastReports = db.prepare(`
      SELECT * FROM eod_reports 
      ORDER BY report_date DESC 
      LIMIT 30
    `).all();

    res.json({ summary, pastReports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/eod-close', (req, res) => {
  // Dukung format snake_case maupun camelCase dari frontend
  const report_date = req.body.report_date || req.body.reportDate || req.body.date || new Date().toISOString().split('T')[0];
  const closed_by   = req.body.closed_by || req.body.closedBy || req.body.cashier || req.body.user || 'Admin';

  const opening_float       = parseFloat(req.body.opening_float || req.body.openingFloat || 0);
  const cash_sales          = parseFloat(req.body.cash_sales || req.body.cashSales || 0);
  const expected_cash       = parseFloat(req.body.expected_cash || req.body.expectedCash || 0);
  const actual_cash_counted = parseFloat(req.body.actual_cash_counted || req.body.actualCashCounted || 0);
  const discrepancy         = parseFloat(req.body.discrepancy || 0);
  const reorder_fund        = parseFloat(req.body.reorder_fund || req.body.reorderFund || 0);
  const net_profit          = parseFloat(req.body.net_profit || req.body.netProfit || 0);

  try {
    // 1. Cek apakah laporan pada tanggal ini sudah pernah dibuat
    const existing = db.prepare("SELECT id FROM eod_reports WHERE report_date = ?").get(report_date);

    if (existing) {
      // 2. Jika sudah ada, perbarui data
      db.prepare(`
        UPDATE eod_reports SET
          opening_float = ?,
          cash_sales = ?,
          expected_cash = ?,
          actual_cash_counted = ?,
          discrepancy = ?,
          reorder_fund = ?,
          net_profit = ?,
          closed_by = ?,
          created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        opening_float,
        cash_sales,
        expected_cash,
        actual_cash_counted,
        discrepancy,
        reorder_fund,
        net_profit,
        closed_by,
        existing.id
      );
    } else {
      // 3. Jika belum ada, buat baris baru
      db.prepare(`
        INSERT INTO eod_reports (
          report_date, opening_float, cash_sales, expected_cash,
          actual_cash_counted, discrepancy, reorder_fund, net_profit, closed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        report_date,
        opening_float,
        cash_sales,
        expected_cash,
        actual_cash_counted,
        discrepancy,
        reorder_fund,
        net_profit,
        closed_by
      );
    }

    res.json({ success: true, message: 'Rekap harian kasir berhasil disimpan.' });
  } catch (err) {
    console.error('Error saat menyimpan EOD:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. API BACKUP DATABASE LOKAL
// ==========================================
app.post('/api/admin/backup', async (req, res) => {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bakery-backup-${timestamp}.db`;
  const backupFilePath = path.join(backupDir, filename);

  try {
    // API online backup bawaan better-sqlite3 (aman saat ada transaksi aktif)
    await db.backup(backupFilePath);
    const stats = fs.statSync(backupFilePath);
    res.json({ success: true, filename, sizeBytes: stats.size });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat cadangan database: ' + err.message });
  }
});

// ==========================================
// 9. JALANKAN SERVER
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server POS aktif di http://127.0.0.1:${PORT}`);
});