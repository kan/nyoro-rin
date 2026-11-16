import { describe, expect, it } from "vitest";
import { requestVibration } from "../src/ui/vibration";

describe("vibration", () => {
  it("passes the pattern to a device that vibrates", () => {
    const patterns: VibratePattern[] = [];
    const device = {
      vibrate(pattern: VibratePattern) {
        // Called as a method: Navigator needs itself as the receiver.
        expect(this).toBe(device);
        patterns.push(pattern);
        return true;
      },
    };
    expect(requestVibration(12, device)).toBe(true);
    expect(patterns).toEqual([12]);
  });

  it("does nothing without the API", () => {
    expect(requestVibration(12, {})).toBe(false);
    expect(requestVibration(12, undefined)).toBe(false);
  });

  it("keeps a refusal or an exception from reaching the caller", () => {
    expect(requestVibration(12, { vibrate: () => false })).toBe(false);
    expect(
      requestVibration(12, {
        vibrate: () => {
          throw new DOMException("not allowed", "NotAllowedError");
        },
      }),
    ).toBe(false);
  });
});
