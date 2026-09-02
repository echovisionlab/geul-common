import { z } from "zod";
import type { Block } from "../page/types.ts";

export type PostContent = Block[];

const postContentBlockSchema = z.custom<Block>(
  (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value),
);

export const postContentSchema: z.ZodType<PostContent> = z.array(
  postContentBlockSchema,
);
