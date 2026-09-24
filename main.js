const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Matikan menu bar secara global di level sistem operasi
Menu.setApplicationMenu(null);

// 2. Tentukan folder data aplikasi untuk database SQLite
process.env.USER_DATA_PATH = app.getPath('userData');

// 3. Jalankan server Express internal
try {
  require('./server.js');
} catch (err) {
  console.error("Gagal menjalankan backend server:", err);
}

// 4. Siapkan direktori penyimpanan file PDF struk di Documents
const receiptsDir = path.join(app.getPath('documents'), 'Struk_Toko_Bahan_Kue');
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Kasir Toko Bahan Kue",
    icon: path.join(__dirname, 'pos-icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Hapus menu bar bawaan agar Windows tidak pernah mengunci fokus keyboard ke menu
  mainWindow.setMenu(null);

  const TARGET_URL = 'http://127.0.0.1:3000';

  function tryConnect() {
    mainWindow.loadURL(TARGET_URL).catch(() => {
      setTimeout(tryConnect, 1000);
    });
  }

  tryConnect();

  // Pastikan Chromium webContents memegang fokus input saat window aktif
  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==========================================
// PENANGAN IPC (PRINTER & AUTOSAVE STRUK)
// ==========================================

// Ambil daftar nama printer Windows
ipcMain.handle('get-printers', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return await mainWindow.webContents.getPrintersAsync();
});

// Penangan Cetak Fisik + Autosave PDF Berdasarkan No. Transaksi
ipcMain.on('print-receipt-silent', (event, { htmlContent, printerName, receiptNo }) => {
  let printWindow = new BrowserWindow({
    show: false,
    focusable: false, // Mencegah Windows mencuri fokus ke window background
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  printWindow.webContents.on('did-finish-load', async () => {
    // A. Simpan otomatis sebagai PDF dengan nama ID Transaksi
    try {
      const safeId = (receiptNo || `REC-${Date.now()}`).replace(/[/\\?%*:|"<>]/g, '-');
      const pdfFilePath = path.join(receiptsDir, `${safeId}.pdf`);

      const pdfData = await printWindow.webContents.printToPDF({
        preferCSSPageSize: true, // Mengikuti ukuran CSS @page (58mm/80mm)
        printBackground: true
      });

      await fs.promises.writeFile(pdfFilePath, pdfData);
      console.log(`[AutoSave] Struk tersimpan: ${pdfFilePath}`);
    } catch (saveErr) {
      console.error('Gagal menyimpan file PDF otomatis:', saveErr);
    }

    // B. Cetak langsung ke printer thermal (Silent Print)
    printWindow.webContents.print({
      silent: true,
      printBackground: true,
      deviceName: printerName || '',
      margins: { marginType: 'none' }
    }, (success, failureReason) => {
      if (!success) {
        console.log('Catatan printer fisik (abaikan jika tidak ada hardware printer):', failureReason);
      }
      if (!printWindow.isDestroyed()) {
        printWindow.close();
      }
      // Kembalikan fokus ke jendela kasir utama
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.blur(); // Melepas status limbo OS
        mainWindow.focus(); // Mengirim sinyal WM_ACTIVATE dan WM_SETFOCUS
        mainWindow.webContents.focus();
      }
    });
  });
});

// Penangan pemulihan fokus kursor jika dibutuhkan oleh frontend
ipcMain.on('force-refocus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

// Siklus hidup aplikasi Electron
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});