import { z } from "zod";

export const campaignRecipientScopeSchema = z.enum([
  "SUBSCRIBED_USERS",
  "ALL_MATCHING_USERS",
]);

export type CampaignRecipientScope = z.infer<
  typeof campaignRecipientScopeSchema
>;

export const campaignCollabFieldsSchema = z
  .object({
    segmentId: z.string().nullable().optional(),
    layoutId: z.string().nullable().optional(),
    recipientScope: campaignRecipientScopeSchema.default("SUBSCRIBED_USERS"),
  })
  .strict();

export type CampaignCollabFields = z.infer<typeof campaignCollabFieldsSchema>;
export type CampaignFieldValue = string | null;

export function extractCampaignFields(fieldsMap: {
  get(key: string): CampaignFieldValue | undefined;
}): CampaignCollabFields {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(campaignCollabFieldsSchema.shape)) {
    const value = fieldsMap.get(key);

    if (value !== undefined) {
      raw[key] = value;
    }
  }

  return campaignCollabFieldsSchema.parse(raw);
}
