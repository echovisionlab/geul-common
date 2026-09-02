import { z } from "zod";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Domain Member IDs cross service and durable-state boundaries in canonical form only. */
export const memberIdSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, "Expected a canonical Member UUID");
