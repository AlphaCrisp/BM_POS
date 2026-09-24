const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const filePath = path.join(__dirname, 'documentation.html');
  await win.loadFile(filePath);

  const pdfData = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: {
      marginType: 'custom',
      top: 0.4,
      bottom: 0.4,
      left: 0.4,
      right: 0.4
    }
  });

  const outputPath = path.join(__dirname, 'POS_System_Documentation.pdf');
  fs.writeFileSync(outputPath, pdfData);
  console.log(`[SUCCESS] Documentation PDF created at: ${outputPath}`);

  app.quit();
});