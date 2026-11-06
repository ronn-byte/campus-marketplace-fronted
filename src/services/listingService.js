import apiClient from "./apiClient";

export const INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT = "inquiry-unread-summary-updated";

export function getUnreadInquiryCounts(summary) {
  const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
  return {
    threads: count(summary?.buyer?.threads) + count(summary?.seller?.threads),
    messages: count(summary?.buyer?.messages) + count(summary?.seller?.messages),
  };
}

export function subscribeToInquiryUnreadSummary(isAuthenticated, onSummary) {
  let active = true;
  let requestSequence = 0;

  if (!isAuthenticated) {
    onSummary(null);
    return () => {
      active = false;
      requestSequence += 1;
    };
  }

  const refresh = async () => {
    const sequence = ++requestSequence;
    try {
      const summary = await getInquiryUnreadSummary();
      if (active && sequence === requestSequence) onSummary(summary);
    } catch {
      if (active && sequence === requestSequence) onSummary(null);
    }
  };

  void refresh();
  window.addEventListener(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT, refresh);
  return () => {
    active = false;
    requestSequence += 1;
    window.removeEventListener(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT, refresh);
  };
}

export const previewListings = [
  {
    id: "preview-textbook",
    title: "Calculus II textbook",
    description: "Well-kept copy with useful notes from last semester.",
    price: 1800,
    category: "Books",
    condition: "Good",
    location: "Main campus",
    seller: { name: "MUT student", verified: true },
    imageUrl: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "preview-laptop",
    title: "Lenovo ThinkPad T480",
    description: "Reliable study laptop with a fresh battery and charger.",
    price: 42000,
    category: "Electronics",
    condition: "Good",
    location: "Kahawa hostels",
    seller: { name: "MUT student", verified: true },
    imageUrl: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "preview-chair",
    title: "Study chair and desk lamp",
    description: "A compact setup for a hostel room or study corner.",
    price: 3500,
    category: "Furniture",
    condition: "Like new",
    location: "MUT town campus",
    seller: { name: "MUT student", verified: false },
    imageUrl: "https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=900&q=80",
  },
];

export async function getListings(params = {}) {
  const { data } = await apiClient.get("/listings", {
    params: { page: 1, pageSize: 20, ...params },
  });
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.listings)
      ? data.listings
      : [];

  return {
    items: items.map((listing) => {
      const imageUrl = Array.isArray(listing.images) && typeof listing.images[0]?.url === "string"
        ? listing.images[0].url
        : typeof listing.imageUrl === "string" && /^https?:\/\//i.test(listing.imageUrl)
          ? listing.imageUrl
          : null;

      return {
        ...listing,
        category: typeof listing.category === "string"
          ? listing.category
          : listing.category?.name || "General",
        imageUrl,
        seller: {
          id: listing.seller?.id,
          name: listing.seller?.name || "MUT student",
          verified: listing.seller?.verified === true,
          avatarUrl: listing.seller?.avatarUrl || null,
        },
        condition: listing.condition || null,
        location: listing.location || null,
        price: Number(listing.price ?? 0),
      };
    }),
    meta: data?.meta || null,
  };
}

export async function getListingById(id) {
  const { data } = await apiClient.get(`/listings/${encodeURIComponent(id)}`);
  const listing = data?.listing;

  if (!listing) {
    throw new Error("The listing response was empty.");
  }

  const imageUrl = Array.isArray(listing.images) && typeof listing.images[0]?.url === "string"
    ? listing.images[0].url
    : "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80";

  return {
    ...listing,
    category: listing.category?.name || "General",
    imageUrl,
    isOwner: Boolean(listing.isOwner),
    seller: {
      id: listing.seller?.id,
      name: listing.seller?.name || "MUT student",
      verified: Boolean(listing.seller?.verified),
      avatarUrl: listing.seller?.avatarUrl || null,
    },
    price: Number(listing.price ?? 0),
  };
}

export async function getListingCategories() {
  const { data } = await apiClient.get("/categories");
  if (!Array.isArray(data?.categories)) {
    throw new Error("The category response was invalid.");
  }
  return data.categories;
}

export async function createListing(payload, idempotencyKey) {
  const { data } = await apiClient.post("/listings", payload, {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  });
  if (!data?.listing?.id) {
    throw new Error("The listing response did not include an ID.");
  }
  return data.listing;
}

export async function uploadListingImages(id, files, idempotencyKey) {
  const payload = new FormData();
  files.forEach((file) => payload.append("images", file));

  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(id)}/images`,
    payload,
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  if (
    !Array.isArray(data?.images) ||
    data.images.some((image) => typeof image?.url !== "string")
  ) {
    throw new Error("The image upload response did not include image URLs.");
  }
  return data.images;
}

export async function removeListingImage(listingId, imageId) {
  const { data } = await apiClient.delete(
    `/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(imageId)}`,
  );
  if (!data?.image?.id) {
    throw new Error("The image removal response was invalid.");
  }
  return data.image;
}

export async function createListingInquiry(id, message) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(id)}/inquiries`,
    { message },
  );
  return data?.inquiry;
}

const normalizePage = (data, collectionKey) => {
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.[collectionKey])
      ? data[collectionKey]
      : [];

  return {
    items,
    meta: data?.meta || null,
  };
};

const availableImageUrl = (record) => (
  Array.isArray(record?.images) && typeof record.images[0]?.url === "string"
    ? record.images[0].url
    : typeof record?.imageUrl === "string"
      ? record.imageUrl
      : null
);

export async function getMyListings(params = {}) {
  const { data } = await apiClient.get("/listings/me", { params });
  const result = normalizePage(data, "listings");

  return {
    ...result,
    items: result.items.map((listing) => ({
      ...listing,
      category: typeof listing.category === "string"
        ? listing.category
        : listing.category?.name || "General",
      imageUrl: availableImageUrl(listing),
      price: Number(listing.price ?? 0),
    })),
  };
}

export async function getMyInquiries(params = {}) {
  const { data } = await apiClient.get("/inquiries/me", { params });
  const result = normalizePage(data, "inquiries");

  return {
    ...result,
    items: result.items.map((inquiry) => ({
      ...inquiry,
      listing: inquiry.listing
        ? {
            ...inquiry.listing,
            category: typeof inquiry.listing.category === "string"
              ? inquiry.listing.category
              : inquiry.listing.category?.name || "General",
            imageUrl: availableImageUrl(inquiry.listing),
          }
        : null,
    })),
  };
}

export async function getInquiryInbox(params = {}) {
  const { data } = await apiClient.get("/inquiries/inbox", { params });
  if (!Array.isArray(data?.items) || !data?.page) {
    throw new Error("The inquiry inbox response was invalid.");
  }
  return {
    items: data.items,
    page: {
      pageSize: Number(data.page.pageSize) || 20,
      hasMore: data.page.hasMore === true,
      nextCursor: typeof data.page.nextCursor === "string" ? data.page.nextCursor : null,
    },
  };
}

export async function getListingInquiries(listingId) {
  const { data } = await apiClient.get(
    `/listings/${encodeURIComponent(listingId)}/inquiries`,
  );
  if (!Array.isArray(data?.inquiries)) {
    throw new Error("The inquiry response was invalid.");
  }
  return data.inquiries;
}

export async function getInquiryMessages(listingId, inquiryId) {
  const { data } = await apiClient.get(
    `/listings/${encodeURIComponent(listingId)}/inquiries/${encodeURIComponent(inquiryId)}/messages`,
  );
  if (!Array.isArray(data?.thread?.messages)) {
    throw new Error("The inquiry conversation response was invalid.");
  }
  return data.thread;
}

export async function sendInquiryMessage(listingId, inquiryId, content) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/inquiries/${encodeURIComponent(inquiryId)}/messages`,
    { content },
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT));
  }
  return data;
}

export async function markInquiryMessagesRead(listingId, inquiryId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/inquiries/${encodeURIComponent(inquiryId)}/read`,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT));
  }
  return data;
}

export async function getInquiryUnreadSummary() {
  const { data } = await apiClient.get("/inquiries/unread-summary");
  if (!data?.summary?.buyer || !data?.summary?.seller) {
    throw new Error("The inquiry unread summary response was invalid.");
  }
  return data.summary;
}

export async function updateListingInquiryStatus(listingId, inquiryId, status) {
  if (status !== "RESPONDED" && status !== "CLOSED") {
    throw new Error("The requested inquiry status is not supported.");
  }
  const { data } = await apiClient.patch(
    `/listings/${encodeURIComponent(listingId)}/inquiries/${encodeURIComponent(inquiryId)}`,
    { status },
  );
  return data?.inquiry;
}

export async function reserveListing(listingId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/reserve`,
  );
  return data?.listing;
}

export async function markListingSold(listingId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/sold`,
  );
  return data?.listing;
}

export async function releaseListingReservation(listingId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/release-reservation`,
  );
  return data?.listing;
}

export async function removeListing(listingId) {
  const { data } = await apiClient.delete(
    `/listings/${encodeURIComponent(listingId)}`,
  );

  if (!data?.listing?.id) {
    throw new Error("The removal response was invalid.");
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

export async function publishListing(listingId) {
  const { data } = await apiClient.post(
    `/listings/${encodeURIComponent(listingId)}/publish`,
  );

  if (!data?.listing?.id) {
    throw new Error("The publish response was invalid.");
  }

  return data.listing;
}
