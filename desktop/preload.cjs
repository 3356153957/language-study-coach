const { contextBridge } = require('electron');

// Only exposes a presentation flag; window controls stay native to Windows.
contextBridge.exposeInMainWorld('desktopShell', { customTitleBar: process.platform === 'win32' });
