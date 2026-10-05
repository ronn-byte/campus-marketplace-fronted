import { useEffect, useState } from "react";
import Button from "../components/Button";
import { getApiErrorMessage } from "../services/apiClient";
import {
  createListing,
  getListingCategories,
  uploadListingImages,
} from "../services/listingService";

const initialForm = { title: "", description: "", price: "", category: "", condition: "", location: "" };
const conditionValues = {
  New: "NEW",
  "Like new": "LIKE_NEW",
  Good: "GOOD",
  Fair: "FAIR",
};

export default function PostItem() {
  const [form, setForm] = useState(initialForm);
  const [images, setImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState("");
  const [pendingListing, setPendingListing] = useState(null);
  const [submittedListing, setSubmittedListing] = useState(null);
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  useEffect(() => {
    let active = true;
    getListingCategories()
      .then((items) => {
        if (active) setCategories(items);
      })
      .catch((error) => {
        if (active) setCategoryError(getApiErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const previews = images.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setImagePreviews(previews);

    return () => {
      previews.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [images]);

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const handleImageChange = (event) => setImages(Array.from(event.target.files || []));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, message: "", error: "" });
    const formElement = event.currentTarget;

    try {
      let listing = pendingListing;
      if (!listing) {
        listing = await createListing({
          title: form.title,
          description: form.description,
          price: Number(form.price),
          categoryId: form.category,
          condition: conditionValues[form.condition],
          location: form.location,
        });
        setPendingListing(listing);
      }

      let uploadedImages = [];
      if (images.length > 0) {
        try {
          uploadedImages = await uploadListingImages(listing.id, images);
        } catch (error) {
          setStatus({
            loading: false,
            message: "",
            error: `The listing was created (ID: ${listing.id}), but its images were not uploaded. ${getApiErrorMessage(error)} You can retry the image upload without creating another listing.`,
          });
          return;
        }
      }

      setSubmittedListing({ ...listing, images: uploadedImages });
      setPendingListing(null);
      setForm(initialForm);
      setImages([]);
      formElement.reset();
      setStatus({
        loading: false,
        message: images.length > 0
          ? "Your listing and images were submitted for review."
          : "Your listing was submitted for review.",
        error: "",
      });
    } catch (error) {
      setStatus({ loading: false, message: "", error: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="page-shell sell-layout">
      <section className="form-card" aria-labelledby="sell-heading">
        <p className="eyebrow">Sell around campus</p>
        <h1 id="sell-heading">Give your item a useful next chapter.</h1>
        <p className="form-card__intro">Clear details help another student decide quickly. Your listing status is controlled by the marketplace server.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        {categoryError && <div className="form-alert" role="alert">{categoryError}</div>}
        {status.message && <div className="preview-note" role="status">{status.message}</div>}
        {submittedListing && (
          <section className="listing-created" aria-label="Created listing">
            <h2>{submittedListing.title}</h2>
            <p>{submittedListing.category?.name || "Listing"} · KSh {Number(submittedListing.price).toLocaleString()}</p>
            <p>{submittedListing.description}</p>
            <p>Meet around {submittedListing.location}</p>
            {submittedListing.images.length > 0 && (
              <div className="listing-created__images">
                {submittedListing.images.map((uploadedImage) => (
                  <img key={uploadedImage.id || uploadedImage.url} src={uploadedImage.url} alt={submittedListing.title} />
                ))}
              </div>
            )}
          </section>
        )}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="title">Item title</label><input id="title" name="title" type="text" value={form.title} onChange={updateField} maxLength="120" placeholder="e.g. Engineering textbook" required /></div>
          <div className="field"><label htmlFor="description">Description</label><textarea id="description" name="description" value={form.description} onChange={updateField} maxLength="4000" placeholder="What should another student know?" required /></div>
          <div className="field"><label htmlFor="price">Price in KSh</label><input id="price" name="price" type="number" value={form.price} onChange={updateField} min="0" step="1" required /></div>
          <div className="field"><label htmlFor="category">Category</label><select id="category" name="category" value={form.category} onChange={updateField} required disabled={categories.length === 0 || Boolean(categoryError)}><option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div className="field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" value={form.condition} onChange={updateField} required><option value="">Choose condition</option><option>New</option><option>Like new</option><option>Good</option><option>Fair</option></select></div>
          <div className="field"><label htmlFor="location">Campus meeting location</label><input id="location" name="location" type="text" value={form.location} onChange={updateField} maxLength="120" placeholder="e.g. Main campus" required /></div>
          <div className="field"><label htmlFor="images">Listing images</label><input id="images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageChange} disabled={status.loading} /><span className="muted">Use clear images. The backend validates file type and size before publishing.</span></div>
          {imagePreviews.length > 0 && (
            <div className="image-previews" aria-label="Selected image previews">
              {imagePreviews.map(({ file, url }, index) => (
                <div className="image-previews__item" key={`${file.name}-${file.lastModified}-${index}`}>
                  <img src={url} alt={`Selected preview ${index + 1}: ${file.name}`} />
                  <button type="button" onClick={() => setImages((selected) => selected.filter((_, selectedIndex) => selectedIndex !== index))} disabled={status.loading}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <Button type="submit" disabled={status.loading || Boolean(categoryError) || categories.length === 0}>
            {status.loading
              ? pendingListing ? "Uploading images..." : "Submitting listing..."
              : pendingListing ? "Retry image upload" : "Submit listing"}
          </Button>
        </form>
      </section>
    </div>
  );
}
