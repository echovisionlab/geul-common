import { randomUUID } from "node:crypto";

export function randomTestUuid(): string {
  return randomUUID();
}

export function randomTestId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
