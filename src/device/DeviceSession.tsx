import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DeviceFailure } from "./errors";
import type { DeviceController } from "./types";

export type DeviceOperationName = "time sync" | "image upload" | "lighting" | "lighting sleep";
export type DeviceHealth = "disconnected" | "checking" | "responsive" | "unresponsive";

const HEALTH_CHECK_INTERVAL_MS = 5_000;
const HEALTH_CHECK_TIMEOUT_MS = 1_500;

type ActiveOperation = { id: number; generation: number; name: DeviceOperationName };

export type DeviceSessionValue = {
  controller: DeviceController;
  connected: boolean;
  health: DeviceHealth;
  lastResponseAt: Date | null;
  activeOperation: DeviceOperationName | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runOperation<T>(name: DeviceOperationName, work: () => Promise<T>): Promise<T>;
};

const DeviceSessionContext = createContext<DeviceSessionValue | null>(null);

export function DeviceSessionProvider({
  controller,
  children,
}: {
  controller: DeviceController;
  children: ReactNode;
}) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [health, setHealth] = useState<DeviceHealth>(
    controller.isConnected() ? "checking" : "disconnected",
  );
  const [lastResponseAt, setLastResponseAt] = useState<Date | null>(null);
  const [activeOperation, setActiveOperation] = useState<DeviceOperationName | null>(null);
  const activeRef = useRef<ActiveOperation | null>(null);
  const nextOperationId = useRef(0);
  const generation = useRef(0);
  const healthCheckRef = useRef<Promise<void> | null>(null);

  const clearForDisconnect = useCallback(() => {
    generation.current += 1;
    activeRef.current = null;
    setActiveOperation(null);
    setConnected(false);
    setHealth("disconnected");
    setLastResponseAt(null);
  }, []);

  useEffect(() => controller.onDisconnect(clearForDisconnect), [controller, clearForDisconnect]);

  const connect = useCallback(async () => {
    await controller.connect();
    setConnected(controller.isConnected());
    setHealth(controller.isConnected() ? "checking" : "disconnected");
  }, [controller]);

  const disconnect = useCallback(async () => {
    await controller.disconnect();
    clearForDisconnect();
  }, [controller, clearForDisconnect]);

  const probeDevice = useCallback((): Promise<void> => {
    if (!controller.isConnected() || activeRef.current) return Promise.resolve();
    if (healthCheckRef.current) return healthCheckRef.current;

    const probeGeneration = generation.current;
    setHealth((current) => (current === "disconnected" ? "checking" : current));
    const check = new Promise<DataView | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), HEALTH_CHECK_TIMEOUT_MS);
      controller.receiveFeatureReport(0).then(
        (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    })
      .then((response) => {
        if (generation.current !== probeGeneration || !controller.isConnected()) return;
        if (response) {
          setHealth("responsive");
          setLastResponseAt(new Date());
        } else {
          setHealth("unresponsive");
        }
      })
      .finally(() => {
        if (healthCheckRef.current === check) healthCheckRef.current = null;
      });
    healthCheckRef.current = check;
    return check;
  }, [controller]);

  useEffect(() => {
    if (!connected) return;
    void probeDevice();
    const interval = setInterval(() => void probeDevice(), HEALTH_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [connected, probeDevice]);

  const runOperation = useCallback(
    async <T,>(name: DeviceOperationName, work: () => Promise<T>): Promise<T> => {
      if (!controller.isConnected()) {
        throw new DeviceFailure({ kind: "device-disconnected" });
      }
      if (activeRef.current) {
        throw new DeviceFailure({
          kind: "operation-in-progress",
          operation: activeRef.current.name,
        });
      }

      const token: ActiveOperation = {
        id: ++nextOperationId.current,
        generation: generation.current,
        name,
      };
      activeRef.current = token;
      setActiveOperation(name);

      try {
        // A heartbeat may already be reading the control endpoint. Claim the
        // operation lock immediately, then let that read finish before any
        // transaction packets are sent.
        if (healthCheckRef.current) await healthCheckRef.current;
        if (!controller.isConnected()) {
          throw new DeviceFailure({ kind: "device-disconnected" });
        }
        const result = await work();
        setHealth("responsive");
        setLastResponseAt(new Date());
        return result;
      } finally {
        if (
          activeRef.current?.id === token.id &&
          activeRef.current.generation === token.generation
        ) {
          activeRef.current = null;
          setActiveOperation(null);
        }
      }
    },
    [controller],
  );

  const value = useMemo<DeviceSessionValue>(
    () => ({
      controller,
      connected,
      health,
      lastResponseAt,
      activeOperation,
      connect,
      disconnect,
      runOperation,
    }),
    [
      controller,
      connected,
      health,
      lastResponseAt,
      activeOperation,
      connect,
      disconnect,
      runOperation,
    ],
  );

  return <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>;
}

export function useDeviceSession(): DeviceSessionValue {
  const session = useContext(DeviceSessionContext);
  if (!session) throw new Error("useDeviceSession must be used within DeviceSessionProvider");
  return session;
}
