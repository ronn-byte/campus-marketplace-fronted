const LISTING_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeWhatsAppNumber = (value) => (
  typeof value === "string" ? value.replace(/\D/g, "") : ""
);

export const isValidWhatsAppNumber = (value) => value.length >= 7 && value.length <= 15;

export const isValidListingId = (value) => (
  typeof value === "string" && LISTING_ID_PATTERN.test(value)
);

export const buildWhatsAppUrl = ({ phoneNumber, listing, origin }) => {
  const phone = normalizeWhatsAppNumber(phoneNumber);
  if (!isValidWhatsAppNumber(phone)) return null;

  let message = "Hello! I'm interested in one of your listings on MUT Market.\n\nCould you please let me know what is currently available?";
  if (
    isValidListingId(listing?.id)
    && typeof listing.title === "string"
    && listing.title.trim()
  ) {
    const listingUrl = new URL(
      `/listing/${encodeURIComponent(listing.id)}`,
      origin || window.location.origin,
    ).toString();
    message = `Hello! I found your "${listing.title}" listing on MUT Market and I'm interested in it.\n\nCould you please confirm whether it is still available?\n\nItem link: ${listingUrl}`;
  }

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
};
