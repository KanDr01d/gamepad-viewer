// main.js
const { app, BrowserWindow, globalShortcut, Menu, Tray, ipcMain, screen } = require('electron');

const path = require('path');
const fs = require('fs');

let mainWin, tray;
let currentOpacity = 1.0;
let currentScale = 1.0;
let clickThrough = false;
let alwaysOnTopState = true;
let currentDisplayId = null; // null = primary
let currentCorner = 'top-left'; // one of 'top-left','top-right','bottom-left','bottom-right','center'
const cornerMargin = 20;

const isDebug = (
  process.argv.includes('--gv-debug') ||
  process.env.GV_DEBUG === '1' ||
  process.argv.includes('--debug') // legacy, may trigger Node deprecation warning
);

const dlog = (...args) => {
  if (isDebug) {
    const d = new Date();
    const pad = (n, w=2) => String(n).padStart(w, '0');
    const DD = pad(d.getDate());
    const MM = pad(d.getMonth() + 1);
    const YY = pad(d.getFullYear() % 100);
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const sss = pad(d.getMilliseconds(), 3);
    const ts = `${DD}_${MM}_${YY}---${hh}:${mm}:${ss}.${sss}2`;
    const line = `[${ts}] [MAIN] ` + args.map(a => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    console.log(line);
    if (logStream) logStream.write(line + "\n");
  }
};

let logStream = null;
function initFileLog() {
  if (!isDebug || logStream) return;
  try {
    const baseDir = app.getPath('userData');
    const logsDir = path.join(baseDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const d = new Date();
    const pad = (n, w=2) => String(n).padStart(w, '0');
    const fname = `session_${pad(d.getDate())}_${pad(d.getMonth()+1)}_${pad(d.getFullYear()%100)}---${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}2.log`;
    const filePath = path.join(logsDir, fname);
    logStream = fs.createWriteStream(filePath, { flags: 'a' });
    dlog('File logging to', filePath);
  } catch (e) {
    console.error('Failed to init file logging', e);
  }
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: false,
      devTools: isDebug
    }
  });

  mainWin.loadFile('index.html');
  mainWin.setMenu(null);

  mainWin.webContents.on('did-finish-load', () => {
    // inform renderer about debug state
    mainWin.webContents.send('set-debug', isDebug);
    mainWin.webContents.executeJavaScript(`
      document.body.style.cssText += ';-webkit-app-region: drag;';
      document.querySelectorAll('button,a,select,input,#help-popout,#overlay').forEach(el=>{
        el.style.cssText += ';-webkit-app-region: no-drag;';
      });
    `).catch(() => {});
  });

  mainWin.once('ready-to-show', () => {
    mainWin.show();
    mainWin.setAlwaysOnTop(alwaysOnTopState, process.platform === 'darwin' ? 'floating' : 'screen-saver');
    mainWin.moveTop();
  });

  mainWin.on('blur', () => {
    if (alwaysOnTopState) {
      mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
      mainWin.moveTop();
    }
  });
}

function rebuildTrayMenu() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const template = [
    { 
      label: 'Click-through', 
      type: 'checkbox', 
      checked: clickThrough, 
      click: (item) => {
        clickThrough = item.checked;
        dlog('Tray Click-through', { clickThrough });
        mainWin.setIgnoreMouseEvents(item.checked, { forward: true });
        mainWin.setAlwaysOnTop(alwaysOnTopState, process.platform === 'darwin' ? 'floating' : 'screen-saver'); 
        if (alwaysOnTopState) mainWin.moveTop();
      }
    },

    { type: 'separator' },

    { label: 'Display', submenu: displays.map((d, idx) => ({
      label: `Display ${idx+1} (${d.size.width}x${d.size.height})${(currentDisplayId ?? primaryId) === d.id ? ' ✓' : ''}`,
      submenu: [
        { label: 'Use this display', click: () => { currentDisplayId = d.id; placeWindow(currentDisplayId, currentCorner || 'top-left'); } },
        { type: 'separator' },
        { label: 'Corner', submenu: [
          { label: 'Top-Left',     type: 'radio', checked: currentCorner === 'top-left',     click: () => { currentDisplayId = d.id; currentCorner = 'top-left';     placeWindow(currentDisplayId, currentCorner); } },
          { label: 'Top-Right',    type: 'radio', checked: currentCorner === 'top-right',    click: () => { currentDisplayId = d.id; currentCorner = 'top-right';    placeWindow(currentDisplayId, currentCorner); } },
          { label: 'Bottom-Left',  type: 'radio', checked: currentCorner === 'bottom-left',  click: () => { currentDisplayId = d.id; currentCorner = 'bottom-left';  placeWindow(currentDisplayId, currentCorner); } },
          { label: 'Bottom-Right', type: 'radio', checked: currentCorner === 'bottom-right', click: () => { currentDisplayId = d.id; currentCorner = 'bottom-right'; placeWindow(currentDisplayId, currentCorner); } },
          { label: 'Center',       type: 'radio', checked: currentCorner === 'center',       click: () => { currentDisplayId = d.id; currentCorner = 'center';       placeWindow(currentDisplayId, currentCorner); } },
        ]}
      ]
    }))},

    { label: 'Opacity', submenu: [
      { label: '100%', type: 'radio', checked: currentOpacity === 1.0, click: () => { dlog('Tray Opacity', 1.0); setOpacity(1.0);} },
      { label: '80%',  type: 'radio', checked: currentOpacity === 0.8, click: () => { dlog('Tray Opacity', 0.8); setOpacity(0.8);} },
      { label: '60%',  type: 'radio', checked: currentOpacity === 0.6, click: () => { dlog('Tray Opacity', 0.6); setOpacity(0.6);} },
      { label: '40%',  type: 'radio', checked: currentOpacity === 0.4, click: () => { dlog('Tray Opacity', 0.4); setOpacity(0.4);} },
    ]},

    { label: 'Size', submenu: [
      { label: '50%',  type: 'radio', checked: currentScale === 0.5, click: () => { dlog('Tray Size', 0.5); setSize(0.5);} },
      { label: '75%',  type: 'radio', checked: currentScale === 0.75, click: () => { dlog('Tray Size', 0.75); setSize(0.75);} },
      { label: '100%', type: 'radio', checked: currentScale === 1.0, click: () => { dlog('Tray Size', 1.0); setSize(1.0);} },
      { label: '150%', type: 'radio', checked: currentScale === 1.5, click: () => { dlog('Tray Size', 1.5); setSize(1.5);} },
      { label: '200%', type: 'radio', checked: currentScale === 2.0, click: () => { dlog('Tray Size', 2.0); setSize(2.0);} },
    ]},

    { label: 'Skin', submenu: [
      { label: 'Auto',       type: 'radio', checked: true,  click: () => { dlog('Tray Skin', 'auto'); mainWin.webContents.send('set-skin', 'auto'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'DualShock 4',type: 'radio', click: () => { dlog('Tray Skin', 'ds4'); mainWin.webContents.send('set-skin', 'ds4'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'Xbox One',   type: 'radio', click: () => { dlog('Tray Skin', 'xbox-one'); mainWin.webContents.send('set-skin', 'xbox-one'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'Debug',      type: 'radio', click: () => { dlog('Tray Skin', 'debug'); mainWin.webContents.send('set-skin', 'debug'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
    ]},

    { label: 'Color', submenu: [
      { label: 'Default', click: () => { dlog('Tray Color', ''); mainWin.webContents.send('change-color', ''); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'Black',   click: () => { dlog('Tray Color', 'black'); mainWin.webContents.send('change-color', 'black'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'White',   click: () => { dlog('Tray Color', 'white'); mainWin.webContents.send('change-color', 'white'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'Red',     click: () => { dlog('Tray Color', 'red'); mainWin.webContents.send('change-color', 'red'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
      { label: 'Blue',    click: () => { dlog('Tray Color', 'blue'); mainWin.webContents.send('change-color', 'blue'); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },
    ]},

    { label: 'Background', submenu: 'transparent checkered dimgrey black white lime magenta'.split(' ').map(b => ({
      label: b.charAt(0).toUpperCase() + b.slice(1),
      type: 'radio',
      click: () => { dlog('Tray Background', b); mainWin.webContents.send('change-background', b); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } }
    }))},

    { label: 'Triggers Meter', type: 'checkbox', checked: false, click: (i) => { dlog('Tray Triggers Meter', i.checked); mainWin.webContents.send('toggle-triggers', i.checked); if (alwaysOnTopState) { mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver'); mainWin.moveTop(); } } },

    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'favicon.png'));
  tray.setToolTip('Gamepad Overlay');
  tray.on('click', () => {
    dlog('Tray Icon clicked');
    if (mainWin.isVisible()) {
      mainWin.hide();
    } else {
      mainWin.show();
      mainWin.setAlwaysOnTop(alwaysOnTopState, process.platform === 'darwin' ? 'floating' : 'screen-saver');
      mainWin.moveTop();
    }
  });

  rebuildTrayMenu();
}

function setOpacity(val) {
  currentOpacity = val;
  mainWin.setOpacity(val);
  if (alwaysOnTopState) {
    mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  }
  rebuildTrayMenu();
}

function setSize(scale) {
  currentScale = scale;
  const [w, h] = [Math.round(600 * scale), Math.round(450 * scale)];
  const wasResizable = mainWin.isResizable();
  if (!wasResizable) mainWin.setResizable(true);
  mainWin.setSize(w, h);
  if (!wasResizable) mainWin.setResizable(false);
  // if user selected an anchor, re-place to keep corner alignment on current display
  if (currentCorner) {
    placeWindow(currentDisplayId, currentCorner);
  }
  if (alwaysOnTopState) {
    mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  }
  rebuildTrayMenu();
}

function placeWindow(displayId, corner) {
  const displays = screen.getAllDisplays();
  const target = displayId ? displays.find(d => d.id === displayId) : screen.getPrimaryDisplay();
  if (!target) return;
  const wa = target.workArea; // { x, y, width, height }
  const [w, h] = mainWin.getSize();
  let x = wa.x, y = wa.y;
  switch (corner) {
    case 'top-left':      x = wa.x + cornerMargin;                          y = wa.y + cornerMargin; break;
    case 'top-right':     x = wa.x + wa.width - w - cornerMargin;           y = wa.y + cornerMargin; break;
    case 'bottom-left':   x = wa.x + cornerMargin;                          y = wa.y + wa.height - h - cornerMargin; break;
    case 'bottom-right':  x = wa.x + wa.width - w - cornerMargin;           y = wa.y + wa.height - h - cornerMargin; break;
    case 'center':        x = wa.x + Math.round((wa.width  - w)/2);         y = wa.y + Math.round((wa.height - h)/2); break;
    default:              x = wa.x + cornerMargin;                          y = wa.y + cornerMargin; break;
  }
  mainWin.setBounds({ x, y, width: w, height: h }, false);
  if (alwaysOnTopState) {
    mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  }
  rebuildTrayMenu();
}

// IPC handlers – safe & working
ipcMain.on('change-skin',       (_, skin)  => mainWin.webContents.executeJavaScript(`window.gamepad?.changeSkin('${skin}')`).catch(() => {}));
ipcMain.on('change-color',      (_, color) => mainWin.webContents.executeJavaScript(`window.gamepad?.changeGamepadColor('${color}')`).catch(() => {}));
ipcMain.on('change-background', (_, bg)    => mainWin.webContents.executeJavaScript(`window.gamepad?.changeBackgroundStyle('${bg}')`).catch(() => {}));
ipcMain.on('toggle-triggers',   (_, on)    => mainWin.webContents.executeJavaScript(`window.gamepad?.toggleTriggersMeter(${on})`).catch(() => {}));

ipcMain.on('set-skin', (e, skin) => {
  const payload = JSON.stringify(skin || 'auto');
  mainWin.webContents.executeJavaScript(`
    try { window.gamepad?.changeSkin(${payload}) } catch (e) {}
  `).catch(() => {});
});

ipcMain.on('set-color', (e, color) => {
  mainWin.webContents.executeJavaScript(`window.gamepad?.changeGamepadColor("${color || ''}")`);
});

ipcMain.on('set-background', (e, bg) => {
  mainWin.webContents.executeJavaScript(`window.gamepad?.changeBackgroundStyle("${bg}")`);
});

ipcMain.on('debug-log', (_, line) => {
  if (!isDebug) return;
  try {
    const out = typeof line === 'string' ? line : JSON.stringify(line);
    if (logStream) logStream.write(out + "\n");
    console.log(out);
  } catch {}
});

app.whenReady().then(() => {
  initFileLog();
  createWindow();
  createTray();

  globalShortcut.register('Control+Alt+G', () => {
    mainWin.isVisible() ? mainWin.hide() : mainWin.show() && mainWin.moveTop();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());