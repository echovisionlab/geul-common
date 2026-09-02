/**
 * Common types shared across apps
 * These are simplified versions of Kysely-generated types for apps that don't need full DB access
 */

// JSON types
export type JsonPrimitive = boolean | number | string | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [x: string]: JsonValue | undefined };
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type Json = JsonValue;

// Enum type consumed by form clients.
export type FormStatus = "draft" | "published";
