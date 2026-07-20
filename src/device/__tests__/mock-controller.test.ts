import { describe, expect, test } from "vitest";
import { MockDeviceController } from "../mock-controller";

describe("MockDeviceController", () => {
  test("records feature reports in order", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await ctrl.sendFeatureReport({ reportId: 1, bytes: new Uint8Array([0xaa]) });
    await ctrl.sendFeatureReport({ reportId: 2, bytes: new Uint8Array([0xbb]) });
    expect(ctrl.sent).toEqual([
      { kind: "feature", reportId: 1, bytes: new Uint8Array([0xaa]) },
      { kind: "feature", reportId: 2, bytes: new Uint8Array([0xbb]) },
    ]);
  });

  test("records output reports separately", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await ctrl.sendReport({ reportId: 0, bytes: new Uint8Array([0x11]) });
    expect(ctrl.sent).toEqual([{ kind: "output", reportId: 0, bytes: new Uint8Array([0x11]) }]);
  });

  test("rejects sends when disconnected", async () => {
    const ctrl = new MockDeviceController();
    await expect(
      ctrl.sendFeatureReport({ reportId: 1, bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ name: "DeviceFailure" });
  });

  test("rejects output sends when disconnected", async () => {
    const ctrl = new MockDeviceController();
    await expect(ctrl.sendReport({ reportId: 0, bytes: new Uint8Array() })).rejects.toMatchObject({
      name: "DeviceFailure",
    });
  });

  test("emits disconnect event", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    let fired = 0;
    ctrl.onDisconnect(() => fired++);
    await ctrl.disconnect();
    expect(fired).toBe(1);
  });

  test("isConnected reflects state", async () => {
    const ctrl = new MockDeviceController();
    expect(ctrl.isConnected()).toBe(false);
    await ctrl.connect();
    expect(ctrl.isConnected()).toBe(true);
    await ctrl.disconnect();
    expect(ctrl.isConnected()).toBe(false);
  });

  test("onDisconnect returns an unsubscribe function", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    let fired = 0;
    const unsub = ctrl.onDisconnect(() => fired++);
    unsub();
    await ctrl.disconnect();
    expect(fired).toBe(0);
  });
});
