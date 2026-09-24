const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use local directory or AppData path
const dbPath = path.join(__dirname, 'bakery.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('🌱 Initializing sample database schema...');

// 1. Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pin TEXT,
    role TEXT DEFAULT 'CASHIER',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'Umum',
    unit TEXT DEFAULT 'pcs',
    cost_price REAL NOT NULL DEFAULT 0,
    sell_price REAL NOT NULL DEFAULT 0,
    tier1_price REAL,
    tier2_price REAL,
    tier3_price REAL,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER DEFAULT 5,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE NOT NULL,
    tier_used INTEGER DEFAULT 0,
    total_gross REAL NOT NULL DEFAULT 0,
    total_cogs REAL NOT NULL DEFAULT 0,
    total_profit REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'CASH',
    cash_tendered REAL DEFAULT 0,
    change_due REAL DEFAULT 0,
    cashier_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    pricing_type TEXT NOT NULL,
    cost_at_sale REAL NOT NULL,
    sell_at_sale REAL NOT NULL,
    subtotal_gross REAL NOT NULL,
    subtotal_cogs REAL NOT NULL,
    subtotal_profit REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eod_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date DATE UNIQUE NOT NULL,
    opening_float REAL DEFAULT 0,
    cash_sales REAL DEFAULT 0,
    expected_cash REAL DEFAULT 0,
    actual_cash_counted REAL DEFAULT 0,
    discrepancy REAL DEFAULT 0,
    reorder_fund REAL DEFAULT 0,
    net_profit REAL DEFAULT 0,
    closed_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    returned_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 2. Insert Default Staff Accounts (Mock Credentials)
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (name, username, password, pin, role)
  VALUES (?, ?, ?, ?, ?)
`);

insertUser.run('Owner Administrator', 'admin', 'admin123', '9999', 'ADMIN');
insertUser.run('Kasir Shift 1', 'cashier', '1234', '1234', 'CASHIER');

// 3. Insert Dummy Products (Generic Bakery Supplies)
const sampleProducts = [
  { barcode: '8991001', name: 'Tepung Terigu Serbaguna 1kg', category: 'Tepung', unit: 'kg', cost: 10000, sell: 12500, t1: 12000, t2: 11500, stock: 50 },
  { barcode: '8991002', name: 'Tepung Protein Tinggi 1kg', category: 'Tepung', unit: 'kg', cost: 12000, sell: 14500, t1: 14000, t2: 13500, stock: 40 },
  { barcode: '8991003', name: 'Margarin Serbaguna 200g', category: 'Mentega', unit: 'pcs', cost: 6500, sell: 8500, t1: 8200, t2: 8000, stock: 60 },
  { barcode: '8991004', name: 'Ragi Instan Sachet 11g', category: 'Pengembang', unit: 'sachet', cost: 4500, sell: 6000, t1: 5800, t2: 5500, stock: 100 },
  { barcode: '8991005', name: 'Coklat Batang Dark Compound 1kg', category: 'Coklat', unit: 'block', cost: 42000, sell: 50000, t1: 48500, t2: 47000, stock: 25 },
  { barcode: '8991006', name: 'Gula Halus Donat 500g', category: 'Gula', unit: 'pak', cost: 8000, sell: 10500, t1: 10000, t2: 9500, stock: 35 }
];

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (barcode, name, category, unit, cost_price, sell_price, tier1_price, tier2_price, stock_qty)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const p of sampleProducts) {
  insertProduct.run(p.barcode, p.name, p.category, p.unit, p.cost, p.sell, p.t1, p.t2, p.stock);
}

console.log('✅ Sample database seeded successfully with mock data.');
db.close();