# Gamepad Viewer

Clean, lightweight, always-on-top gamepad viewer on your screen.

### Features
- Auto-detects and switches to correct skin (PS4, Xbox)
- Left-click tray icon to temporally hide the gamepad viewer. Click again to show it again
- Right-click tray icon for all settings
- Full drag anywhere, anchor lock, true always-on-top
- Click-through, opacity, size, background, color control
- Ctrl+Alt+G to toggle visibility

### Requirements
- Node.js installed

### Install & Run
```bash
git clone https://github.com/KanDr01d/gamepad-viewer
cd gamepad-overlay
npm install
npm start
```

### For building the app
```bash
git clone https://github.com/KanDr01d/gamepad-viewer
cd gamepad-overlay
npm run build
```

-> Compiled files will be in /dist folder


### Run in debug mode
```bash
npm start -- --gv-debug
```
