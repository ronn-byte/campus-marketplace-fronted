export function getBuyerInquiryListingState(listing) {
  if (listing?.status === "PUBLISHED" && listing.id) {
    return { href: `/listing/${encodeURIComponent(listing.id)}`, message: null };
  }

  if (listing?.status === "SOLD" || listing?.status === "REMOVED") {
    return {
      href: null,
      message: `This listing is ${listing.status.toLowerCase()}; your inquiry history is still available.`,
    };
  }

  return { href: null, message: "This listing is not currently available to view." };
}
