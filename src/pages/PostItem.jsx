import React, { useState } from "react";
import axios from "axios";

function PostItem() {
    const[title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [image, setImage] = useState(null); // For image upload

    const handleSubmit = async (e) => { 
        e.preventDefault();

        //create a FormData object to send mixed data (text and file)
        const formData = new FormData();
        formData.append("title", title);
        formData.append("description", description);
        formData.append("price", price);
        if (image) {
            formData.append("image", image); // Append the image file
        }

        try {
            // we're  anticipating an endpoint like /api/items forposting new items
            const response = await axios.post('http://localhost:5000/api/items', formData, {
        headers: {
          'Content-Type': 'multipart/form-data', // Axios handles boundary, just specify type
          // You might need to add an Authorization header here later for protected routes
          // 'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
      });

            console.log("Item posted successfully:", response.data);
            // Reset form fields after successful submission
            setTitle("");
            setDescription("");
            setPrice("");
            setImage(null);
            // Optionally, you can redirect or show a success message here
            alert("Item posted successfully!");
        }
        catch (error) {
            console.error("Error posting item:", error);
            // Handle error appropriately, e.g., show an error message
            alert("Failed to post item. Please try again.");
        }
    };

    const handleImageChange = (e) => {
        setImage(e.target.files[0]); // Set the first selected file to state
    };

    return (
        <div style={ { padding: "20px", maxWidth: "600px", margin: "auto" }}>
            <h1>Post an Item</h1>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                <input
                    type="text"
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    style={{ padding: "10px", borderRadius: "5px", border: "1px solid #ddd" }}
                />
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description of the item"
                    rows={"5"}
                    required
                    style={{ padding: "10px", borderRadius: "5px", border: "1px solid #ddd", resize: "vertical" }}
                />
                <input
                    type="number"
                  value={price}
                    onChange={ (e) => setPrice(e.target.value) }
                    placeholder="Price"
                    min={"0"}
                    step={"0.01"}
                    required
                    style={{ padding: "10px", borderRadius: "5px", border: "1px solid #ddd" }}
                />
                <label htmlFor="image-upload" style={{ display: "block", marginBotom: "5px", frontWeight: "bold" }}>
                    Upload Image:
                </label>
                <input
                    id="image-upload" // Added id for label association
                    type="file"
                    accept="image/*" // Accept only image files
                    onChange={handleImageChange} // Use dedicated handler for image change
                    style={{ padding: "10px", border: "1px solid #ddd", borderRadius: "5px"}}
                />
                <button
                    type="submit"
                    style={{ padding: "12px 20px", background: "#007bff", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "16px" }}
                >
                    Post Item
                </button>
            </form>
        </div>
    );
}

export default PostItem;
// This code defines a React component for posting an item.