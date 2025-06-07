import React, { useState } from "react";
import axios from "axios";

const Register = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [email, setEmail] = useState("");

    const handleSubmit = (e) => {
        e.preventDefault ();
         axios.post('http://localhost:5000/api/auth/register', { username, password, email })
      .then((res) => {
        console.log('Registration successful:', res.data);
      })
        .catch((err) => {
            console.error('Registration error:', err);
        });
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>Register</h2>{/*added a heading for clarity*/}
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
            <button type="submit">Register</button>
            <p>Already have an account? <a href="/Login">Login here</a></p>
        </form>
    ); 
}

export default Register;
// This code defines a simple registration form using React.
// It includes fields for username, email, and password, and handles form submission with Axios to send a POST request to the server.