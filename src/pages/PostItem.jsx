
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { getApiErrorMessage } from "../services/apiClient";
import {
  createListing,
  getListingCategories,
  getListingForEdit,
  updateListing,
  uploadListingImages,
  publishListing,
} from "../services/listingService";

const MAX_LISTING_IMAGES = 8;

const initialForm = {
  title: "",
  description: "",
  price: "",
  category: "",
  condition: "",
  location: "",
};

const conditionValues = {
  New: "NEW",
  "Like new": "LIKE_NEW",
  Good: "GOOD",
  Fair: "FAIR",
  Used: "USED",
};

const conditionLabels = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  USED: "Used",
};

function toListingPayload(form) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    price: Number(form.price),
    categoryId: form.category,
    condition: conditionValues[form.condition],
    location: form.location.trim(),
  };
}

function toFormValues(listing) {
  return {
    title: listing.title ?? "",
    description: listing.description ?? "",
    price:
      listing.price === null || listing.price === undefined
        ? ""
        : String(listing.price),
    category: listing.category?.id ?? listing.categoryId ?? "",
    condition: conditionLabels[listing.condition] ?? "",
    location: listing.location ?? "",
  };
}

export default function PostItem() {
  const { setBlockingLabel } = useFeedback();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");

  const [form, setForm] = useState(initialForm);
  const [images, setImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [savedImages, setSavedImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState("");
  const [pendingListing, setPendingListing] = useState(null);
  const [submittedListing, setSubmittedListing] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(editId));
  const [status, setStatus] = useState({
    loading: false,
    message: "",
    error: "",
  });
  const [operationLabel, setOperationLabel] = useState("");
  const uploadBatchIdRef = useRef(null);

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
    let active = true;

    if (!editId) {
      setLoadingDraft(false);
      setForm(initialForm);
      setImages([]);
      setSavedImages([]);
      setPendingListing(null);
      setSubmittedListing(null);
      setStatus({ loading: false, message: "", error: "" });
      return () => {
        active = false;
      };
    }

    setLoadingDraft(true);
    setStatus({ loading: false, message: "", error: "" });

    getListingForEdit(editId)
      .then((listing) => {
        if (!active) return;

        if (listing.status !== "DRAFT") {
          throw new Error(
            "This listing is no longer a draft. Return to My Listings to check its status.",
          );
        }

        setForm(toFormValues(listing));
        setPendingListing(listing);
        setSavedImages(listing.images ?? []);
        setImages([]);
        setSubmittedListing(null);
      })
      .catch((error) => {
        if (!active) return;

        setStatus({
          loading: false,
          message: "",
          error: getApiErrorMessage(error),
        });
      })
      .finally(() => {
        if (active) setLoadingDraft(false);
      });

    return () => {
      active = false;
    };
  }, [editId]);

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

  const updateField = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleImageChange = (event) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const input = event.target;
    if (uploadBatchIdRef.current) {
      setStatus((current) => ({
        ...current,
        error: "Retry the saved upload with the same selected images, or reopen the draft to start a new upload.",
        message: "",
      }));
      input.value = "";
      return;
    }
    const remaining = Math.max(0, MAX_LISTING_IMAGES - savedImages.length - images.length);

    setImages((current) => [...current, ...selectedFiles.slice(0, remaining)]);
    if (selectedFiles.length > remaining) {
      setStatus((current) => ({
        ...current,
        error: `A listing may contain up to ${MAX_LISTING_IMAGES} images. You can add ${remaining} more.`,
        message: "",
      }));
    }

    // Allow choosing the same file again after removing it.
    input.value = "";
  };

  const removeSelectedImage = (indexToRemove) => {
    setImages((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status.loading || loadingDraft) return;

    setStatus({ loading: true, message: "", error: "" });
    const initialOperation = "Saving your draft…";
    setOperationLabel(initialOperation);
    setBlockingLabel(initialOperation);

    try {
      const payload = toListingPayload(form);

      let listing;

      if (pendingListing?.id) {
        // Update the existing draft rather than creating a duplicate.
        listing = await updateListing(pendingListing.id, payload);
      } else {
        // Create the draft first so a failed upload can be retried.
        listing = await createListing(payload);
      }

      setPendingListing(listing);

      let uploadedImages = [];

      if (images.length > 0) {
        setOperationLabel("Uploading images…");
        setBlockingLabel("Uploading images…");
        try {
          uploadBatchIdRef.current ??= crypto.randomUUID();
          uploadedImages = await uploadListingImages(
            listing.id,
            images,
            uploadBatchIdRef.current,
          );
        } catch (error) {
          setStatus({
            loading: false,
            message: "",
            error:
              `Your draft has been saved (ID: ${listing.id}), but the image upload failed. ` +
              `${getApiErrorMessage(error)} Your selected images and form details have been kept so you can retry.`,
          });
          setOperationLabel("");
          setBlockingLabel("");
          return;
        }

        uploadBatchIdRef.current = null;
        setSavedImages((current) => [...current, ...uploadedImages]);
        setImages([]);
      }

      const updatedListing = {
        ...listing,
        images: [...savedImages, ...uploadedImages],
      };

      setPendingListing(updatedListing);
      setSubmittedListing(updatedListing);

      setStatus({
        loading: false,
        message:
          uploadedImages.length > 0
            ? "Your draft and images have been saved. Review everything before publishing."
            : "Your draft has been saved. Review everything before publishing.",
        error: "",
      });
      setOperationLabel("");
      setBlockingLabel("");
    } catch (error) {
      setStatus({
        loading: false,
        message: "",
        error: getApiErrorMessage(error),
      });
      setOperationLabel("");
      setBlockingLabel("");
    }
  };

  const handlePublish = async () => {
    if (
      !pendingListing?.id ||
      pendingListing.status !== "DRAFT" ||
      status.loading ||
      loadingDraft
    ) {
      return;
    }

    setStatus({ loading: true, message: "", error: "" });
    setOperationLabel("Publishing listing…");
    setBlockingLabel("Publishing listing…");

    try {
      // Save the latest form values before asking the server to publish.
      const savedListing = await updateListing(
        pendingListing.id,
        toListingPayload(form),
      );

      setPendingListing(savedListing);

      // Do not publish if there are still local images waiting to upload.
      if (images.length > 0) {
        setStatus({
          loading: false,
          message: "",
          error: "Save the draft and upload the selected images before publishing.",
        });
        setOperationLabel("");
        setBlockingLabel("");
        return;
      }

      const published = await publishListing(savedListing.id);

      const finalListing = {
        ...savedListing,
        ...published,
        images: savedImages,
      };

      setPendingListing(finalListing);
      setSubmittedListing(finalListing);

      setStatus({
        loading: false,
        message:
          "Your listing has been published. It should now be eligible to appear in Explore.",
        error: "",
      });
      setOperationLabel("");
      setBlockingLabel("");
    } catch (error) {
      setStatus({
        loading: false,
        message: "",
        error: getApiErrorMessage(error),
      });
      setOperationLabel("");
      setBlockingLabel("");
    }
  };

  const isPublished = pendingListing?.status === "PUBLISHED";
  const canPublish =
    Boolean(pendingListing?.id) &&
    pendingListing.status === "DRAFT" &&
    images.length === 0 &&
    !status.loading &&
    !loadingDraft &&
    !categoryError &&
    categories.length > 0;

  return (
    <div className="page-shell sell-layout">
      <section className="form-card" aria-labelledby="sell-heading">
        <p className="eyebrow">Sell around campus</p>

        <h1 id="sell-heading">
          {editId
            ? "Finish your draft."
            : "Give your item a useful next chapter."}
        </h1>

        <p className="form-card__intro">
          Clear details help another student decide quickly. Your listing status
          is controlled by the marketplace server.
        </p>

        {loadingDraft && (
          <div className="preview-note" role="status">
            Loading your draft...
          </div>
        )}

        {status.error && (
          <div className="form-alert" role="alert">
            {status.error}
          </div>
        )}

        {categoryError && (
          <div className="form-alert" role="alert">
            {categoryError}
          </div>
        )}

        {status.message && (
          <div className="preview-note" role="status">
            {status.message}
          </div>
        )}

        {submittedListing && (
          <section className="listing-created" aria-label="Listing preview">
            <h2>{submittedListing.title}</h2>

            <p>
              {submittedListing.category?.name || "Listing"} · KSh{" "}
              {Number(submittedListing.price).toLocaleString()}
            </p>

            <p>{submittedListing.description}</p>
            <p>Meet around {submittedListing.location}</p>
            <p>
              Status:{" "}
              <strong>
                {submittedListing.status ?? "DRAFT"}
              </strong>
            </p>

            {submittedListing.images?.length > 0 && (
              <div className="listing-created__images">
                {submittedListing.images.map((uploadedImage, index) => (
                  <img
                    key={uploadedImage.id ?? uploadedImage.url ?? index}
                    src={uploadedImage.url}
                    alt={`${submittedListing.title}, image ${index + 1}`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="title">Item title</label>
            <input
              id="title"
              name="title"
              type="text"
              value={form.title}
              onChange={updateField}
              maxLength={120}
              placeholder="e.g. Engineering textbook"
              required
              disabled={status.loading || loadingDraft || isPublished}
            />
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={form.description}
              onChange={updateField}
              maxLength={4000}
              placeholder="What should another student know?"
              required
              disabled={status.loading || loadingDraft || isPublished}
            />
          </div>

          <div className="field">
            <label htmlFor="price">Price in KSh</label>
            <input
              id="price"
              name="price"
              type="number"
              value={form.price}
              onChange={updateField}
              min="0"
              step="1"
              required
              disabled={status.loading || loadingDraft || isPublished}
            />
          </div>

          <div className="field">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={updateField}
              required
              disabled={
                categories.length === 0 ||
                Boolean(categoryError) ||
                status.loading ||
                loadingDraft ||
                isPublished
              }
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="condition">Condition</label>
            <select
              id="condition"
              name="condition"
              value={form.condition}
              onChange={updateField}
              required
              disabled={status.loading || loadingDraft || isPublished}
            >
              <option value="">Choose condition</option>
              <option value="New">New</option>
              <option value="Like new">Like new</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Used">Used</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="location">Campus meeting location</label>
            <input
              id="location"
              name="location"
              type="text"
              value={form.location}
              onChange={updateField}
              maxLength={120}
              placeholder="e.g. Main campus"
              required
              disabled={status.loading || loadingDraft || isPublished}
            />
          </div>

          <div className="field">
            <label htmlFor="images">Listing images</label>
            <input
              id="images"
              name="images"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleImageChange}
              disabled={status.loading || loadingDraft || isPublished || Boolean(uploadBatchIdRef.current)}
            />
            <span className="muted">
              Use JPEG, PNG, or WebP images up to 5 MB each. {Math.max(0, MAX_LISTING_IMAGES - savedImages.length - images.length)} of {MAX_LISTING_IMAGES} image slots remain.
            </span>
          </div>

          {savedImages.length > 0 && (
            <div className="image-previews" aria-label="Saved listing images">
              {savedImages.map((image, index) => (
                <div
                  className="image-previews__item"
                  key={image.id ?? image.url ?? index}
                >
                  <img
                    src={image.url}
                    alt={`Saved listing image ${index + 1}`}
                  />
                  <span className="muted">Already uploaded</span>
                </div>
              ))}
            </div>
          )}

          {imagePreviews.length > 0 && (
            <div
              className="image-previews"
              aria-label="Selected image previews"
            >
              {imagePreviews.map(({ file, url }, index) => (
                <div
                  className="image-previews__item"
                  key={`${file.name}-${file.lastModified}-${index}`}
                >
                  <img
                    src={url}
                    alt={`Selected preview ${index + 1}: ${file.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeSelectedImage(index)}
                    disabled={status.loading || Boolean(uploadBatchIdRef.current)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            type="submit"
            disabled={
              status.loading ||
              loadingDraft ||
              Boolean(categoryError) ||
              categories.length === 0 ||
              isPublished
            }
          >
            {status.loading
              ? <><InlineSpinner label={operationLabel} announce={false} /> {operationLabel.replace("…", "")}</>
              : images.length > 0
                ? "Save draft and upload images"
                : pendingListing?.id
                  ? "Save draft changes"
                  : "Save as draft"}
          </Button>

          {pendingListing?.id && !isPublished && (
            <div className="field">
              <Button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish}
              >
                {status.loading ? <><InlineSpinner label="Publishing listing…" announce={false} /> Publishing…</> : "Publish listing"}
              </Button>

              {images.length > 0 && (
                <span className="muted">
                  Upload your selected images before publishing.
                </span>
              )}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
