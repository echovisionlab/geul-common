import { z } from "zod";
import type { PageBlockType } from "./block-fixtures.ts";

export interface InlineContent {
  type: string;
  text?: string;
  href?: string;
  styles?: Record<string, unknown>;
  props?: Record<string, unknown>;
  content?: InlineContent[];
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: InlineContent[];
  children?: Block[];
}

export interface SectionSettings {
  backgroundColor?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingRight?: string;
  maxWidth?: "full" | "container" | "narrow";
}

export interface Section {
  id: string;
  type: PageBlockType;
  settings: SectionSettings;
  props?: Record<string, unknown>;
  content?: Block[];
  columns?: ColumnData[];
}

export interface ColumnData {
  id: string;
  sections: Section[];
}

export interface PageContent {
  sections: Section[];
}

const pageContentSectionSchema = z.custom<Section>(
  (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value),
);

export const pageContentSchema: z.ZodType<PageContent> = z
  .object({
    sections: z.array(pageContentSectionSchema),
  })
  .strict();
