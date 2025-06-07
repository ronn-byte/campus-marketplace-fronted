import React, { useState, useEffect }  from "react";

function Home () {
    const [items, setItems] = useState([]);

    useEffect(() => {

        const fetchItems = async () => {
            const dummyItems = [
                { id: 1, name: "Textbook", imageUrl: "https://imgs.search.brave.com/I0GdzLF-gnsILB99zu4lZe9kVURzSu9Zqw3hsIAIMqw/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9vY3cu/bWl0LmVkdS9jb3Vy/c2VzL3Jlcy0xOC0w/MDEtY2FsY3VsdXMt/ZmFsbC0yMDIzL21p/dHJlc18xOF8wMDFf/ZjIzX2NocC5qcGc", description: "A comprehensive textbook for learning.", price: 3000, category: "Books" },
                { id: 2, name: "Laptop", imageUrl: "https://imgs.search.brave.com/342GRooMeEQ9v7TGQCsPbQhYtkRO-tp8SKjDBozG8dU/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9zdGF0/aWMudmVjdGVlenku/Y29tL3N5c3RlbS9y/ZXNvdXJjZXMvdGh1/bWJuYWlscy8wMjQv/NjI2LzQ1Mi9zbWFs/bC9sYXB0b3AtY29t/cHV0ZXItaW4tZGFy/ay1waG90by5qcGc", description: "A high-performance laptop for professionals.", price: 150000, category: "Electronics" },
                { id: 3, name: "Smartphone", imageUrl: "https://imgs.search.brave.com/9qQkhyyiMyVbwan59jF2pgAQFxWiXIB5ZjBMdHZjTBE/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTQw/OTA4NDk0Ni9waG90/by9zbWFydHBob25l/LXdpdGgtYmxhbmst/c2NyZWVuLmpwZz9z/PTYxMng2MTImdz0w/Jms9MjAmYz1SalJO/UExhRkRQUjVyTjNw/ZDBSdnlranZPQXkw/VWlxX1ZIcXhPbmJC/V1I4PQ", description: "Latest smartphone with advanced features.", price: 80000, category: "Electronics" },
        ];
        setItems(dummyItems);
    };

    fetchItems();
}, []);

 return (

    <div style={{padding: '20px', maxWidth: '800px', margin: 'auto'}}>
        <h1>Campus Marketplace Feed</h1>
        <p>Discover items posted by your peers!</p>

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px', marginTop: '30px' }}>
            { items.map(item => (
                <div key={ item.id } style={{border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'}}>
                    <img src={ item.imageUrl } alt={ item.name } style={{width: '100%', height: '200px', objectFit: 'cover'}} /> 
                    <div style={{ padding: '15px' }}>
                        <h2 style={{ margin: '0 0 10px'}}>{ item.name }</h2>
                        <p style={{ fontSize: '0.9cm', color: '#555', marginBottom: '10px' }}>{ item.description }</p>
                        <p style={{ fontWeight: 'bold', color: '#333' }}>KSH{item.price}</p>
                        {/* Here you can add buttons for actions like "Contact Seller" or "Add to Cart" */}
                        <button style={{ background: '#007bff', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' }}>
                            View Details
                        </button>
                    </div>
                </div>
            )) }
        </div>
    </div>
    );
}

export default Home;
// This code defines a React component for the home page of a campus marketplace application.
