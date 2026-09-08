import { useState } from "react";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

const initialForm = { title: "", description: "", price: "", category: "", condition: "", location: "" };

export default function PostItem() {
  const [form, setForm] = useState(initialForm);
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const handleImageChange = (event) => setImage(event.target.files?.[0] || null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, message: "", error: "" });
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    if (image) payload.append("image", image);

    try {
      await apiClient.post("/listings", payload);
      setForm(initialForm);
      setImage(null);
      event.target.reset();
      setStatus({ loading: false, message: "Your listing was submitted for review.", error: "" });
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
        {status.message && <div className="preview-note" role="status">{status.message}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="title">Item title</label><input id="title" name="title" type="text" value={form.title} onChange={updateField} maxLength="120" placeholder="e.g. Engineering textbook" required /></div>
          <div className="field"><label htmlFor="description">Description</label><textarea id="description" name="description" value={form.description} onChange={updateField} maxLength="4000" placeholder="What should another student know?" required /></div>
          <div className="field"><label htmlFor="price">Price in KSh</label><input id="price" name="price" type="number" value={form.price} onChange={updateField} min="0" step="1" required /></div>
          <div className="field"><label htmlFor="category">Category</label><select id="category" name="category" value={form.category} onChange={updateField} required><option value="">Choose a category</option><option>Books</option><option>Electronics</option><option>Furniture</option><option>Fashion</option><option>Services</option></select></div>
          <div className="field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" value={form.condition} onChange={updateField} required><option value="">Choose condition</option><option>New</option><option>Like new</option><option>Good</option><option>Fair</option></select></div>
          <div className="field"><label htmlFor="location">Campus meeting location</label><input id="location" name="location" type="text" value={form.location} onChange={updateField} maxLength="120" placeholder="e.g. Main campus" required /></div>
          <div className="field"><label htmlFor="image">Listing image</label><input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} /><span className="muted">Use a clear image. The backend must validate file type and size before publishing.</span></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? "Submitting listing..." : "Submit listing"}</Button>
        </form>
      </section>
    </div>
  );
}
