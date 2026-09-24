const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Kirim data HTML, nama printer, dan No. Transaksi
  printReceipt: (htmlContent, printerName = '', receiptNo = '') => {
    ipcRenderer.send('print-receipt-silent', { htmlContent, printerName, receiptNo });
  },
  getPrinters: () => ipcRenderer.invoke('get-printers')
});