import type { ReportMessage } from "./types";

const CONTROL_LEAD = 0x04;
const CMD_START = 0x18;
const CMD_TIME = 0x28;
const CMD_SAVE = 0x02;
const ENABLE_FLAG_BYTE_INDEX = 7; // packet byte 8 → bytes[7] after stripping reportId
const TIME_DATA_REPORT_ID = 0x00;
const TIME_MAGIC_MARKER = 0x5a;
const TIME_DATA_TRAILER_HI = 0xaa;
const TIME_DATA_TRAILER_LO = 0x55;
const PAYLOAD_LENGTH = 63; // 64-byte packet minus the leading report-ID byte

function controlPacket(command: number, enableFlag: number): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = command;
  bytes[ENABLE_FLAG_BYTE_INDEX] = enableFlag;
  return { reportId: CONTROL_LEAD, bytes };
}

function timeDataPacket(date: Date): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = 0x01;
  bytes[1] = TIME_MAGIC_MARKER;
  bytes[2] = date.getFullYear() - 2000;
  bytes[3] = date.getMonth() + 1;
  bytes[4] = date.getDate();
  bytes[5] = date.getHours();
  bytes[6] = date.getMinutes();
  bytes[7] = date.getSeconds();
  bytes[8] = 0x00;
  bytes[9] = 0x04;
  bytes[PAYLOAD_LENGTH - 2] = TIME_DATA_TRAILER_HI;
  bytes[PAYLOAD_LENGTH - 1] = TIME_DATA_TRAILER_LO;
  return { reportId: TIME_DATA_REPORT_ID, bytes };
}

export function buildTimeSyncReports(date: Date): ReportMessage[] {
  if (Number.isNaN(date.getTime())) {
    throw new Error("buildTimeSyncReports: invalid date");
  }
  return [
    controlPacket(CMD_START, 0x01),
    controlPacket(CMD_TIME, 0x01),
    timeDataPacket(date),
    controlPacket(CMD_SAVE, 0x00),
  ];
}
