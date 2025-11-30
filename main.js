const { app, BrowserWindow, globalShortcut, Menu, Tray } = require('electron');
const path = require('path');

let mainWin;
let tray = null;
let currentOpacity = 1.0;
let currentScale = 1.0;
let clickThrough = false;
let alwaysOnTop = true;
let anchorLocked = false;
let detectionInProgress = true;
let userHasManuallyChangedSkin = false;

const identifiers = {
  'ds4': { colors: ['black', 'white', 'red', 'blue'], triggers: true },
  'xbox-one': { colors: ['black', 'white'], triggers: true },
  'debug': { colors: [], triggers: false },
};

async function rebuildTrayMenu() {
  const currentSkin = await mainWin.webContents.executeJavaScript('gamepad.type || "auto"', true);
  const currentBackground = await mainWin.webContents.executeJavaScript('gamepad.backgroundStyle[gamepad.backgroundStyleIndex]', true);
  const currentColor = await mainWin.webContents.executeJavaScript('gamepad.colorName || ""', true);
  const currentTriggersMeter = await mainWin.webContents.executeJavaScript('gamepad.triggersMeter', true);

  const template = [
    { label: 'Click-through', type: 'checkbox', checked: clickThrough, click: (item) => toggleClickThrough(item.checked) },
    { label: 'Always on Top', type: 'checkbox', checked: alwaysOnTop, click: (item) => toggleAlwaysOnTop(item.checked) },
    { label: 'Anchor Location', type: 'checkbox', checked: anchorLocked, click: (item) => toggleAnchor(item.checked) },
    { type: 'separator' },
    { label: 'Opacity', submenu: [
      { label: '100%', type: 'radio', checked: currentOpacity === 1.0, click: () => setOpacity(1.0) },
      { label: '80%', type: 'radio', checked: currentOpacity === 0.8, click: () => setOpacity(0.8) },
      { label: '60%', type: 'radio', checked: currentOpacity === 0.6, click: () => setOpacity(0.6) },
      { label: '40%', type: 'radio', checked: currentOpacity === 0.4, click: () => setOpacity(0.4) },
    ] },
    { label: 'Size', submenu: [
      { label: '50%', type: 'radio', checked: currentScale === 0.5, click: () => setSize(0.5) },
      { label: '75%', type: 'radio', checked: currentScale === 0.75, click: () => setSize(0.75) },
      { label: '100%', type: 'radio', checked: currentScale === 1.0, click: () => setSize(1.0) },
      { label: '150%', type: 'radio', checked: currentScale === 1.5, click: () => setSize(1.5) },
      { label: '200%', type: 'radio', checked: currentScale === 2.0, click: () => setSize(2.0) },
    ] },
    { label: 'Skin', submenu: [
      { label: 'Auto', type: 'radio', checked: currentSkin === 'auto', click: () => changeSkin('auto'), enabled: !detectionInProgress || !userHasManuallyChangedSkin },
      { label: 'DualShock 4', type: 'radio', checked: currentSkin === 'ds4', click: () => changeSkin('ds4'), enabled: !detectionInProgress },
      { label: 'Xbox One', type: 'radio', checked: currentSkin === 'xbox-one', click: () => changeSkin('xbox-one'), enabled: !detectionInProgress },
      { label: 'Debug', type: 'radio', checked: currentSkin === 'debug', click: () => changeSkin('debug'), enabled: !detectionInProgress },
    ] },
    { label: 'Background', submenu: [
      { label: 'Transparent', type: 'radio', checked: currentBackground === 'transparent', click: () => changeBackground('transparent') },
      { label: 'Checkered', type: 'radio', checked: currentBackground === 'checkered', click: () => changeBackground('checkered') },
      { label: 'Grey', type: 'radio', checked: currentBackground === 'dimgrey', click: () => changeBackground('dimgrey') },
      { label: 'Black', type: 'radio', checked: currentBackground === 'black', click: () => changeBackground('black') },
      { label: 'White', type: 'radio', checked: currentBackground === 'white', click: () => changeBackground('white') },
      { label: 'Lime', type: 'radio', checked: currentBackground === 'lime', click: () => changeBackground('lime') },
      { label: 'Magenta', type: 'radio', checked: currentBackground === 'magenta', click: () => changeBackground('magenta') },
    ] },
    { label: 'Color', submenu: getColorSubmenu(currentSkin, currentColor), enabled: !detectionInProgress },
    { label: 'Triggers Meter', type: 'checkbox', checked: currentTriggersMeter, click: (item) => toggleTriggersMeter(item.checked) },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ];

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

function getColorSubmenu(skin, currentColor) {
  let colors = [''];
  if (identifiers[skin] && identifiers[skin].colors) {
    colors = colors.concat(identifiers[skin].colors);
  }
  return colors.map(c => ({
    label: c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Default',
    type: 'radio',
    checked: c === currentColor,
    click: () => changeColor(c)
  }));
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    transparent: true,
    alwaysOnTop: alwaysOnTop,
    skipTaskbar: false,
    resizable: true,
    show: false,  // start hidden to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false   // prevents disappearing
    }
  });

  mainWin.loadFile('index.html');
  mainWin.setMenu(null);

  // FULLY DRAGGABLE
  mainWin.webContents.executeJavaScript(`
    document.documentElement.style.cssText += ';-webkit-app-region: drag;';
    document.querySelectorAll('button, input, select, a, [onclick]').forEach(el => {
      el.style.cssText += ';-webkit-app-region: no-drag;';
    });
    const style = document.createElement('style');
    style.textContent = '#help-popout, #help-popout *, #overlay, #overlay * { -webkit-app-region: no-drag !important; }';
    document.head.appendChild(style);
  `);

  // Auto-detect controller and switch skin when first gamepad appears
  mainWin.webContents.executeJavaScript(`
    if (typeof gamepad !== 'undefined') {
      const originalSetActive = gamepad.setActiveGamepad;
      gamepad.setActiveGamepad = function(index) {
        originalSetActive.call(this, index);
        
        if (${!userHasManuallyChangedSkin} && this.gamepads[index]) {
          const id = this.gamepads[index].id.toLowerCase();
          let detectedSkin = 'auto';
          
          if (id.includes('dualsense') || id.includes('dualshock 4') || id.includes('ps5') || id.includes('ps4')) {
            detectedSkin = 'ds4';
          } else if (id.includes('xbox') || id.includes('xinput')) {
            detectedSkin = 'xbox-one';
          }
          
          if (detectedSkin !== 'auto') {
            this.changeSkin(detectedSkin);
            // Notify main process that detection is done
            window.postMessage('detection-complete', '*');
          }
        }
      };
    }

    // Listen for detection complete
    window.addEventListener('message', (e) => {
      if (e.data === 'detection-complete') {
        window.postMessage('request-menu-update', '*');
      }
    });
  `);

  // Receive detection complete from renderer
  mainWin.webContents.on('ipc-message', (event, channel) => {
    if (channel === 'request-menu-update') {
      detectionInProgress = false;
      rebuildTrayMenu();
    }
  });

  // Prevent minimize
  mainWin.on('minimize', (e) => e.preventDefault());

  // THIS IS THE ONLY CHANGE — show immediately when page finishes loading
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    mainWin.moveTop();
    if (alwaysOnTop) {
      mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
    }
  });

  // Fallback if ready-to-show somehow doesn't fire (very rare)
  mainWin.webContents.once('did-finish-load', () => {
    if (!mainWin.isVisible()) {
      mainWin.show();
      mainWin.moveTop();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'favicon.png'));
  tray.setToolTip('Gamepad Overlay');

  tray.on('click', () => {
    if (mainWin.isVisible()) {
      mainWin.hide();
    } else {
      mainWin.show();
      mainWin.moveTop();
      if (alwaysOnTop) {
        mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
      }
    }
  });
}

function toggleClickThrough(enabled) {
  mainWin.setIgnoreMouseEvents(enabled, { forward: true });
  clickThrough = enabled;
  rebuildTrayMenu();
}

function toggleAlwaysOnTop(enabled) {
  alwaysOnTop = enabled;
  
  if (enabled) {
    mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
    mainWin.moveTop();
  } else {
    mainWin.setAlwaysOnTop(false);
  }
  
  rebuildTrayMenu();
}

function toggleAnchor(enabled) {
  anchorLocked = enabled;
  if (enabled) {
    mainWin.webContents.executeJavaScript(`
      document.documentElement.style.webkitAppRegion = 'no-drag';
    `);
  } else {
    mainWin.webContents.executeJavaScript(`
      document.documentElement.style.webkitAppRegion = 'drag';
      document.querySelectorAll('button, input, select, a, [onclick]').forEach(el => {
        el.style.webkitAppRegion = 'no-drag';
      });
    `);
  }
  rebuildTrayMenu();
}

function setOpacity(val) {
  mainWin.setOpacity(val);
  currentOpacity = val;
  rebuildTrayMenu();
}

function setSize(scale) {
  const w = Math.round(600 * scale);
  const h = Math.round(450 * scale);
  mainWin.setSize(w, h);
  mainWin.center();
  currentScale = scale;
  rebuildTrayMenu();
}

async function changeSkin(skin) {
  if (detectionInProgress && skin !== 'auto') {
    // User is trying to change skin while detection is running → block it
    return;
  }

  if (skin !== 'auto') {
    userHasManuallyChangedSkin = true;  // user took control → stop auto-switching
  }

  const activeIndex = await mainWin.webContents.executeJavaScript('gamepad.activeGamepadIndex');

  await mainWin.webContents.executeJavaScript(`
    if (gamepad && typeof gamepad.changeSkin === 'function') {
      gamepad.changeSkin('${skin}');
    }
  `);

  if (activeIndex !== null && activeIndex !== undefined) {
    setTimeout(() => {
      mainWin.webContents.executeJavaScript(`
        if (gamepad && gamepad.gamepads[${activeIndex}]) {
          gamepad.setActiveGamepad(${activeIndex});
        }
      `);
    }, 50);
  }

  await rebuildTrayMenu();
}

async function changeBackground(bg) {
  await mainWin.webContents.executeJavaScript(`gamepad.changeBackgroundStyle('${bg}');`);
  await rebuildTrayMenu();
}

async function changeColor(color) {
  if (detectionInProgress) return;  // block color change during detection

  const activeIndex = await mainWin.webContents.executeJavaScript('gamepad.activeGamepadIndex');

  await mainWin.webContents.executeJavaScript(`
    if (gamepad && typeof gamepad.changeGamepadColor === 'function') {
      gamepad.changeGamepadColor('${color || ''}');
    }
  `);

  if (activeIndex !== null && activeIndex !== undefined) {
    setTimeout(() => {
      mainWin.webContents.executeJavaScript(`
        if (gamepad && gamepad.gamepads[${activeIndex}]) {
          gamepad.setActiveGamepad(${activeIndex});
        }
      `);
    }, 50);
  }

  await rebuildTrayMenu();
}

async function toggleTriggersMeter(enabled) {
  await mainWin.webContents.executeJavaScript(`gamepad.toggleTriggersMeter(${enabled});`);
  await rebuildTrayMenu();
}

app.whenReady().then(async () => {
  createWindow();
  createTray();
  await rebuildTrayMenu();

  globalShortcut.register('Control+Alt+G', () => {
    if (mainWin.isVisible()) {
      mainWin.hide();
    } else {
      mainWin.show();
      mainWin.moveTop();
      if (alwaysOnTop) {
        mainWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
      }
    }
  });
});

// === FIX 2: Prevent minimizing other windows ===
app.on('browser-window-will-move', () => {
  // Do nothing - prevents unwanted window behavior
});

app.on('window-all-closed', () => { /* Keep app running in tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());