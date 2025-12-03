const { app , BrowserWindow } = require('electron');

app.whenReady().then(() => {
    newWindow();
});


function newWindow() {
    const myWindow = new BrowserWindow({
        width: 500,
        height: 300,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    // myWindow.loadFile('html/index.html');
    myWindow.loadURL('https://www.douyin.com');
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
