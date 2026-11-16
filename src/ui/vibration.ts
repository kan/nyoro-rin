/** The part of Navigator that vibrates. */
export interface VibrationDevice {
  vibrate?(pattern: VibratePattern): boolean;
}

/**
 * Asks the device to vibrate, and tells whether it accepted. A browser
 * without the API, or one that refuses the call (outside a user gesture, in
 * a frame without permission), throws or returns false; neither may break
 * the input that asked for it.
 */
export function requestVibration(
  pattern: VibratePattern,
  device: VibrationDevice | undefined = globalThis.navigator,
): boolean {
  if (typeof device?.vibrate !== "function") return false;
  try {
    // Called as a method, so that Navigator stays its receiver.
    return device.vibrate(pattern);
  } catch {
    return false;
  }
}
