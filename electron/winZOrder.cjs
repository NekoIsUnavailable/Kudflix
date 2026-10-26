/**
 * Place one top-level HWND directly above another (not globally always-on-top).
 * Windows only; no-op elsewhere.
 */

let setWindowAboveImpl = null;

if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const SetWindowPos = user32.func(
      'bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)',
    );
    const SWP_NOSIZE = 0x0001;
    const SWP_NOMOVE = 0x0002;
    const SWP_NOACTIVATE = 0x0010;

    setWindowAboveImpl = (hwndAbove, hwndBelow) => {
      if (!hwndAbove || !hwndBelow) return false;
      return SetWindowPos(
        hwndAbove,
        hwndBelow,
        0,
        0,
        0,
        0,
        SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
      );
    };
  } catch (err) {
    console.warn('[winZOrder] Failed to load user32 SetWindowPos:', err?.message || err);
  }
}

function hwndFromBuffer(handle) {
  if (!handle || handle.length === 0) return null;
  return handle.length >= 8 ? handle.readBigInt64LE(0) : BigInt(handle.readInt32LE(0));
}

/** @returns {boolean} */
function setWindowAbove(aboveWindow, belowWindow) {
  if (!setWindowAboveImpl || !aboveWindow || belowWindow?.isDestroyed?.()) return false;
  if (aboveWindow.isDestroyed()) return false;
  try {
    const above = hwndFromBuffer(aboveWindow.getNativeWindowHandle());
    const below = hwndFromBuffer(belowWindow.getNativeWindowHandle());
    if (above == null || below == null) return false;
    return setWindowAboveImpl(above, below);
  } catch {
    return false;
  }
}

module.exports = { setWindowAbove };
