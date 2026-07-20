import { useDeviceSession } from "../device/DeviceSession";

export function OperationStatus() {
  const { activeOperation } = useDeviceSession();
  if (!activeOperation) return null;
  return <p className="operation-status">Device operation: {activeOperation}</p>;
}
