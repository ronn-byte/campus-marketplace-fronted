import apiClient from "./apiClient";

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

const listingImageFallback = "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80";

export async function getListings(params = {}) {
  const { data } = await apiClient.get("/listings", { params });
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.listings)
      ? data.listings
      : [];

  return items.map((listing) => ({
    ...listing,
    category: typeof listing.category === "string"
      ? listing.category
      : listing.category?.name || "General",
    imageUrl: typeof listing.imageUrl === "string" && /^https?:\/\//i.test(listing.imageUrl)
      ? listing.imageUrl
      : listingImageFallback,
    seller: listing.seller || { name: "MUT student", verified: true },
    condition: listing.condition || "Good",
    location: listing.location || "Main campus",
    price: Number(listing.price ?? 0),
  }));
}

export async function getListingById(id) {
  const { data } = await apiClient.get(`/listings/${encodeURIComponent(id)}`);
  const listing = data?.listing;

  if (!listing) {
    throw new Error("The listing response was empty.");
  }

  return {
    ...listing,
    category: listing.category?.name || "General",
    imageUrl: listingImageFallback,
    seller: {
      name: listing.seller?.name || "MUT student",
      verified: Boolean(listing.seller?.verified),
    },
    price: Number(listing.price ?? 0),
  };
}
