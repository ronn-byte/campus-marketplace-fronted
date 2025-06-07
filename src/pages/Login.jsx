import React, { useState} from "react";
import axios from "axios";

const Login = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    const handleSubmit = (e) => {
        e.preventDefault();
        axios.post('http://localhost:5000/api/auth/login', { username, password })
      .then((res) => {
        console.log('Login successful:', res.data);
        // TODO: Store the authentication token (e.g., in localStorage)
        // TODO: Redirect the user to the home page or dashboard
      })

        .catch((err) => {
        console.error('Login failed:', err.response ? err.response.data : err.message);
        //TODO: Show an error message to the user(e.g "invalid credentials")
        });
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>Login to your Account</h2> {/*Added a header for better UX*/}
            <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username or Email" // Updated placeholder for clarity
            required
            />
            <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            />
            <button type="submit">Login</button>    
            <p>Don't have an account? <a href="/register">Register here</a></p> {/*Added a link to the registration page*/} 
        </form>
    );
};

export default Login;
// This code defines a simple login form using React.