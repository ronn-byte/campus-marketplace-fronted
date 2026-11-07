export type InquiryPersistenceMode = "legacy" | "messaging" | "unavailable";

export function getInquiryPersistenceMode(schema: {
  hasMessageTable: boolean;
  hasLegacyMessageColumn: boolean;
}): InquiryPersistenceMode {
  if (schema.hasLegacyMessageColumn) return "legacy";
  if (schema.hasMessageTable) return "messaging";
  return "unavailable";
}
