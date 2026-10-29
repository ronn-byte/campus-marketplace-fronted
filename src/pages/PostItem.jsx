
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { useAuth } from "../hooks/useAuth";
import { getApiErrorMessage } from "../services/apiClient";
import {
  createListing,
  getListingCategories,
  getListingForEdit,
  removeListingImage,
  updateListing,
  uploadListingImages,
  publishListing,
} from "../services/listingService";

const MAX_LISTING_IMAGES = 8;
const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LISTING_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CREATE_DRAFT_KEY = "mut-market:listing-draft-create-key";

function scopedCreateDraftKey(userId) {
  return `${CREATE_DRAFT_KEY}:${userId}`;
}

function legacyCreateDraftClaimKey(userId) {
  return `${CREATE_DRAFT_KEY}:legacy-claimed:${userId}`;
}

function readCreateDraftKey(userId) {
  if (!userId) return null;
  try {
    const storageKey = scopedCreateDraftKey(userId);
    const scopedKey = window.localStorage.getItem(storageKey);
    if (scopedKey) return scopedKey;

    // Older versions stored one unscoped key. Migrate it into this seller's
    // namespace without consuming it for other accounts sharing the browser.
    const legacyKey = window.localStorage.getItem(CREATE_DRAFT_KEY);
    if (
      legacyKey &&
      window.localStorage.getItem(legacyCreateDraftClaimKey(userId)) !== "true"
    ) {
      window.localStorage.setItem(storageKey, legacyKey);
      window.localStorage.setItem(legacyCreateDraftClaimKey(userId), "true");
      return legacyKey;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCreateDraftKey(key, userId) {
  if (!userId) return;
  try {
    window.localStorage.setItem(scopedCreateDraftKey(userId), key);
  } catch {
    // The in-memory key still protects retries until this page is reloaded.
  }
}

function clearCreateDraftKey(userId) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(scopedCreateDraftKey(userId));
  } catch {
    // A retained key only resumes this seller's existing draft.
  }
}

function uploadBatchStorageKey(listingId) {
  return `mut-market:listing-upload-batch:${listingId}`;
}

function readUploadBatchId(listingId) {
  try {
    return window.localStorage.getItem(uploadBatchStorageKey(listingId));
  } catch {
    return null;
  }
}

function saveUploadBatchId(listingId, batchId) {
  try {
    window.localStorage.setItem(uploadBatchStorageKey(listingId), batchId);
  } catch {
    // The in-memory retry key still protects retries for the current page.
  }
}

function clearUploadBatchId(listingId) {
  try {
    window.localStorage.removeItem(uploadBatchStorageKey(listingId));
  } catch {
    // A stale key can only cause a safe retry mismatch; it cannot authorize access.
  }
}

function mergeListingImages(...imageGroups) {
  const imagesById = new Map();
  for (const image of imageGroups.flat()) {
    imagesById.set(image.id ?? image.url, image);
  }
  return Array.from(imagesById.values());
}

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

function toPublishedListingPayload(form) {
  return {
    description: form.description.trim(),
    price: Number(form.price),
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
  const { user, isLoading: isAuthLoading } = useAuth();
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
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [operationLabel, setOperationLabel] = useState("");
  const [pendingImageId, setPendingImageId] = useState(null);
  const [uploadBatchConflict, setUploadBatchConflict] = useState(false);
  const [hasPendingCreateRetry, setHasPendingCreateRetry] = useState(() => Boolean(readCreateDraftKey(user?.id)));
  const [createRetryConflict, setCreateRetryConflict] = useState(false);
  const createDraftKeyRef = useRef(null);
  const uploadBatchIdRef = useRef(null);
  const publishInFlightRef = useRef(false);

  useEffect(() => {
    setHasPendingCreateRetry(Boolean(readCreateDraftKey(user?.id)));
    createDraftKeyRef.current = null;
  }, [user?.id]);

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
      uploadBatchIdRef.current = null;
      setUploadBatchConflict(false);
      setStatus({ loading: false, message: "", error: "" });
      return () => {
        active = false;
      };
    }

    setLoadingDraft(true);
    setUploadBatchConflict(false);
    setStatus({ loading: false, message: "", error: "" });

    getListingForEdit(editId)
      .then((listing) => {
        if (!active) return;

        if (listing.status !== "DRAFT" && listing.status !== "PUBLISHED") {
          throw new Error(
            "This listing is no longer editable. Return to My Listings to check its status.",
          );
        }

        setForm(toFormValues(listing));
        setPendingListing(listing);
        setSavedImages(listing.images ?? []);
        uploadBatchIdRef.current = readUploadBatchId(listing.id);
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
    if (uploadBatchIdRef.current && images.length > 0) {
      setStatus((current) => ({
        ...current,
        error: "Retry the saved upload with the same selected images, or reopen the draft to start a new upload.",
        message: "",
      }));
      input.value = "";
      return;
    }
    const validFiles = selectedFiles.filter((file) => (
      ALLOWED_LISTING_IMAGE_TYPES.has(file.type.toLowerCase()) &&
      file.size > 0 &&
      file.size <= MAX_LISTING_IMAGE_BYTES
    ));
    const remaining = retryingSavedBatch
      ? MAX_LISTING_IMAGES
      : Math.max(0, MAX_LISTING_IMAGES - savedImages.length - images.length);

    setImages((current) => [...current, ...validFiles.slice(0, remaining)]);
    setUploadBatchConflict(false);
    const invalidCount = selectedFiles.length - validFiles.length;
    const overLimitCount = Math.max(0, validFiles.length - remaining);
    if (invalidCount > 0 || overLimitCount > 0) {
      setStatus((current) => ({
        ...current,
        error: [
          invalidCount > 0
            ? `${invalidCount} file${invalidCount === 1 ? " was" : "s were"} rejected. Choose non-empty JPEG, PNG, or WebP images no larger than 5 MB each.`
            : "",
          overLimitCount > 0
            ? `A listing may contain up to ${MAX_LISTING_IMAGES} images. Only ${remaining} slot${remaining === 1 ? " was" : "s were"} available; extra files were not added.`
            : "",
        ].filter(Boolean).join(" "),
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

  const handleSavedImageRemoval = async (image) => {
    if (!pendingListing?.id || !image?.id || status.loading || pendingImageId) return;
    if (!window.confirm("Remove this image from the listing? The image record and stored file will be retained for recovery.")) return;
    setPendingImageId(image.id);
    setStatus((current) => ({ ...current, error: "", message: "" }));
    try {
      await removeListingImage(pendingListing.id, image.id);
      setSavedImages((current) => current.filter((saved) => saved.id !== image.id));
      setPendingListing((current) => current ? {
        ...current,
        images: (current.images ?? []).filter((saved) => saved.id !== image.id),
      } : current);
      setSubmittedListing((current) => current ? {
        ...current,
        images: (current.images ?? []).filter((saved) => saved.id !== image.id),
      } : current);
      setStatus({ loading: false, message: "Image removed from the listing. The stored file is retained for recovery.", error: "" });
    } catch (error) {
      setStatus((current) => ({ ...current, error: getApiErrorMessage(error), message: "" }));
    } finally {
      setPendingImageId(null);
    }
  };

  const refreshSavedImagesForNewBatch = async () => {
    const listingId = pendingListing?.id;
    if (!listingId || !uploadBatchConflict || pendingImageId) return;
    setPendingImageId("refreshing");
    try {
      const refreshed = await getListingForEdit(listingId);
      setSavedImages(refreshed.images ?? []);
      setPendingListing(refreshed);
      uploadBatchIdRef.current = null;
      clearUploadBatchId(listingId);
      setUploadBatchConflict(false);
      setStatus({
        loading: false,
        message: "Saved images are refreshed and your selected files are still available. Review for duplicates before saving another upload.",
        error: "",
      });
    } catch (error) {
      setStatus((current) => ({ ...current, error: getApiErrorMessage(error), message: "" }));
    } finally {
      setPendingImageId(null);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status.loading || loadingDraft || isAuthLoading) return;

    setStatus({ loading: true, message: "", error: "" });
    setProfileIncomplete(false);
    const isPublishedEdit = pendingListing?.status === "PUBLISHED";
    const initialOperation = isPublishedEdit ? "Saving listing changes..." : "Saving your draft...";
    setOperationLabel(initialOperation);
    setBlockingLabel(initialOperation);

    try {
      const payload = isPublishedEdit
        ? toPublishedListingPayload(form)
        : toListingPayload(form);

      let listing;

      if (pendingListing?.id) {
        // Update the existing listing rather than creating a duplicate.
        listing = await updateListing(pendingListing.id, payload);
      } else {
        // Create the draft first so a failed upload can be retried.
        if (user?.id) {
          createDraftKeyRef.current ??= readCreateDraftKey(user.id) ?? crypto.randomUUID();
          saveCreateDraftKey(createDraftKeyRef.current, user.id);
          setHasPendingCreateRetry(true);
        }
        listing = await createListing(payload, createDraftKeyRef.current);
        clearCreateDraftKey(user?.id);
        createDraftKeyRef.current = null;
        setHasPendingCreateRetry(false);
        setCreateRetryConflict(false);
      }

      setPendingListing(listing);

      let uploadedImages = [];

      if (images.length > 0) {
        setOperationLabel("Uploading images…");
        setBlockingLabel("Uploading images…");
        try {
          uploadBatchIdRef.current ??= readUploadBatchId(listing.id) ?? crypto.randomUUID();
          saveUploadBatchId(listing.id, uploadBatchIdRef.current);
          uploadedImages = await uploadListingImages(
            listing.id,
            images,
            uploadBatchIdRef.current,
          );
        } catch (error) {
          const errorCode = error?.response?.data?.error?.code;
          const retryMismatch = errorCode === "UPLOAD_RETRY_MISMATCH";
          setUploadBatchConflict(retryMismatch);
          if (
            !retryMismatch &&
            [
              "VALIDATION_ERROR",
              "INVALID_IMAGE_TYPE",
              "INVALID_IMAGE_CONTENT",
              "INVALID_IMAGE_SIZE",
              "PAYLOAD_TOO_LARGE",
            ].includes(errorCode)
          ) {
            // These server errors occur before the image batch is committed,
            // so the seller may safely replace invalid files with a new batch.
            uploadBatchIdRef.current = null;
            clearUploadBatchId(listing.id);
          }
          setStatus({
            loading: false,
            message: "",
            error:
              `Your ${isPublishedEdit ? "listing changes" : "draft"} have been saved, but the image upload failed. ` +
              `${getApiErrorMessage(error)} Your selected images and form details have been kept so you can retry.`,
          });
          setOperationLabel("");
          setBlockingLabel("");
          return;
        }

        uploadBatchIdRef.current = null;
        clearUploadBatchId(listing.id);
        setUploadBatchConflict(false);
        setSavedImages((current) => mergeListingImages(current, uploadedImages));
        setImages([]);
      }

      const updatedListing = {
        ...listing,
        images: mergeListingImages(savedImages, uploadedImages),
      };

      setPendingListing(updatedListing);
      setSubmittedListing(updatedListing);

      setStatus({
        loading: false,
        message: isPublishedEdit
          ? uploadedImages.length > 0
            ? "Your listing changes and images have been saved. Explore will show the updated listing."
            : "Your listing changes have been saved. Explore will show the updated listing."
          : uploadedImages.length > 0
            ? "Your draft and images have been saved. Review everything before publishing."
            : "Your draft has been saved. Review everything before publishing.",
        error: "",
      });
      setOperationLabel("");
      setBlockingLabel("");
    } catch (error) {
      setCreateRetryConflict(error?.response?.data?.error?.code === "LISTING_CREATION_RETRY_MISMATCH");
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
      loadingDraft ||
      publishInFlightRef.current
    ) {
      return;
    }

    if (images.length > 0) {
      setStatus({
        loading: false,
        message: "",
        error: "Save the draft and upload the selected images before publishing.",
      });
      return;
    }

    if (uploadBatchIdRef.current) {
      setStatus({
        loading: false,
        message: "",
        error: "Select the same files to finish the pending image upload before publishing.",
      });
      return;
    }

    if (!window.confirm("Publish this listing? Publishing makes it visible to marketplace users. Confirm only after reviewing its details and saved images.")) {
      return;
    }

    publishInFlightRef.current = true;
    setProfileIncomplete(false);
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
      setProfileIncomplete(error?.response?.data?.error?.code === "SELLER_PROFILE_INCOMPLETE");
      setStatus({
        loading: false,
        message: "",
        error: getApiErrorMessage(error),
      });
      setOperationLabel("");
      setBlockingLabel("");
    } finally {
      publishInFlightRef.current = false;
    }
  };

  const isPublished = pendingListing?.status === "PUBLISHED";
  const retryingSavedBatch = Boolean(uploadBatchIdRef.current && images.length === 0);
  const canPublish =
    Boolean(pendingListing?.id) &&
    pendingListing.status === "DRAFT" &&
    images.length === 0 &&
    !status.loading &&
    !loadingDraft &&
    !uploadBatchIdRef.current &&
    !categoryError &&
    categories.length > 0;
  const profileReturnPath = pendingListing?.id
    ? `/post-item?edit=${encodeURIComponent(pendingListing.id)}`
    : "/post-item";

  return (
    <div className="page-shell sell-layout">
      <section className="form-card" aria-labelledby="sell-heading">
        <p className="eyebrow">Sell around campus</p>

        <h1 id="sell-heading">
          {editId
            ? isPublished ? "Update your listing." : "Finish your draft."
            : "Give your item a useful next chapter."}
        </h1>

        <p className="form-card__intro">
          {isPublished
            ? "Published listings can update their price, description, and images. Other listing details stay locked."
            : "Clear details help another student decide quickly. Your listing status is controlled by the marketplace server."}
        </p>

        {user && !user.emailVerifiedAt && (
          <div className="form-alert" role="status">
            Confirm your email before creating, editing, or publishing listings. <Link to="/settings">Open Settings to resend the confirmation email.</Link>
          </div>
        )}

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

        {profileIncomplete && (
          <p className="form-alert" role="alert">
            <Link to={`/profile?returnTo=${encodeURIComponent(profileReturnPath)}`}>
              Complete your seller profile, then return here to publish.
            </Link>
          </p>
        )}

        {uploadBatchConflict && (
          <div className="preview-note">
            <p>The saved retry key belongs to a different image batch. Refresh saved images before starting another upload.</p>
            <Button type="button" onClick={refreshSavedImagesForNewBatch} disabled={Boolean(pendingImageId)}>
              {pendingImageId === "refreshing" ? "Refreshing saved images..." : "Refresh saved images"}
            </Button>
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

        {!editId && hasPendingCreateRetry && (
          <p className="preview-note" role="status">
            A previous draft save may have completed. Check your listings before retrying. If the earlier attempt was made from this account, retrying the same details will resume that draft.
            {" "}<Link to="/my-listings">Check My Listings</Link>
          </p>
        )}
        {!editId && createRetryConflict && (
          <p className="form-alert" role="alert">
            <Link
              to="/my-listings"
              onClick={() => {
                clearCreateDraftKey(user?.id);
                createDraftKeyRef.current = null;
                setHasPendingCreateRetry(false);
              }}
            >
              Open My Listings to continue editing the saved draft.
            </Link>
          </p>
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
              disabled={status.loading || loadingDraft}
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
              max="9999999999.99"
              step="1"
              required
              disabled={status.loading || loadingDraft}
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
              disabled={status.loading || loadingDraft || Boolean(uploadBatchIdRef.current && images.length > 0)}
            />
            <span className="muted">
              {retryingSavedBatch
                ? "Select the same files to safely resume the previous upload."
                : `Use JPEG, PNG, or WebP images up to 5 MB each. ${Math.max(0, MAX_LISTING_IMAGES - savedImages.length - images.length)} of ${MAX_LISTING_IMAGES} image slots remain.`}
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
                  <span className="muted">Saved image</span>
                  <button
                    type="button"
                    onClick={() => handleSavedImageRemoval(image)}
                    disabled={status.loading || Boolean(pendingImageId)}
                    aria-label={`Remove saved image ${index + 1}`}
                  >
                    {pendingImageId === image.id ? "Removing..." : "Remove image"}
                  </button>
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
              isAuthLoading ||
              (!isPublished && (Boolean(categoryError) || categories.length === 0))
            }
          >
            {status.loading
              ? <><InlineSpinner label={operationLabel} announce={false} /> {operationLabel.replace("…", "")}</>
              : images.length > 0
                ? isPublished ? "Save listing changes and upload images" : "Save draft and upload images"
                : pendingListing?.id
                  ? isPublished ? "Save listing changes" : "Save draft changes"
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
              {retryingSavedBatch && images.length === 0 && (
                <span className="muted" role="status">
                  Finish the pending image upload with the same files before publishing.
                </span>
              )}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
