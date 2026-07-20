import { CONTROL_REPORT_LEAD_BYTE, PACKET_LENGTH } from "./constants";
import type { ReportMessage } from "./types";

export const LightingSleepTime = {
  Never: 0,
  OneMinute: 1,
  FiveMinutes: 2,
  ThirtyMinutes: 3,
} as const;

export type LightingSleepTime = (typeof LightingSleepTime)[keyof typeof LightingSleepTime];

const CMD_SLEEP = 0x17;
const PAYLOAD_LENGTH = PACKET_LENGTH - 1;

export function buildLightingSleepPreambleReport(): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_SLEEP;
  bytes[1] = 0x01;
  bytes[7] = 0x01;
  return { reportId: CONTROL_REPORT_LEAD_BYTE, bytes };
}

export function buildLightingSleepDataReport(sleepTime: LightingSleepTime): ReportMessage {
  if (
    !Number.isInteger(sleepTime) ||
    sleepTime < LightingSleepTime.Never ||
    sleepTime > LightingSleepTime.ThirtyMinutes
  ) {
    throw new Error(`buildLightingSleepDataReport: invalid sleep time ${sleepTime}`);
  }

  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[7] = sleepTime;
  bytes[61] = 0xaa;
  bytes[62] = 0x55;
  return { reportId: 0x00, bytes };
}
