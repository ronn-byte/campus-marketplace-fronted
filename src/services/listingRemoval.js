export function getListingRemovalAction(status) {
  if (status === "DRAFT") {
    return {
      label: "Discard draft",
      confirmation: "Discard this draft? It will no longer be editable. Its listing record and saved images will be retained.",
      successMessage: "Draft discarded.",
    };
  }

  if (status === "PUBLISHED") {
    return {
      label: "Withdraw listing",
      confirmation: "Withdraw this listing from Explore? Buyers will no longer be able to view it or send new inquiries. Existing inquiries and saved images will be retained.",
      successMessage: "Listing withdrawn.",
    };
  }

  return null;
}
