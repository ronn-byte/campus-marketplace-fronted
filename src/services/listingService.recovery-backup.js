/**
 * Update an existing listing.
 * The backend remains responsible for authentication,
 * seller verification, ownership, and allowed listing status.
 */
export async function updateListing(listingId, payload) {
  const { data } = await apiClient.patch(
    `/listings/${encodeURIComponent(listingId)}`,
    payload,
  );

  if (!data?.listing?.id) {
    throw new Error("The listing update response was invalid.");
  }

  return data.listing;
}

/**
 * Publish a saved draft.
 * Publication is a separate server-side action, not part
 * of creating or editing a listing.
 */
export async function publishListing(listingId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/publish`,
  );

  if (!data?.listing?.id) {
    throw new Error("The publish response was invalid.");
  }

  return data.listing;
}

export async function getListingForEdit(listingId) {
  const { data } = await apiClient.get(
    `/listings/${encodeURIComponent(listingId)}/edit`,
  );

  if (!data?.listing?.id) {
    throw new Error("The draft response was invalid.");
  }

  return data.listing;
}