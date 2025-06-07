import React from "react";
import { Link } from 'react-router-dom';

function Navbar() {
    return (
        <nav style={navbarStyle}>
            <ul style={ulStyle}>
                <li>
                    <Link to="/" style={linkStyle}>Home</Link>
                </li>
                <li>
                    <Link to="/login" style={linkStyle}>Login</Link>
                </li>
                <li>
                    <Link to="/register" style={linkStyle}>Register</Link>
                </li>
                <li>
                    <Link to="/post" style={linkStyle}>Post item</Link>
                </li>
            </ul>
        </nav>
    );
}

// These style objects MUST be defined outside the Navbar function,
// but within the same file, so they are accessible.
const navbarStyle = {
    background: '#333', // Corrected 'backgrouund' to 'background'
    color: '#fff',      // Added color for text within nav itself
    padding: '10px 0',
    textAlign: 'center',
};

const ulStyle = {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
};

const linkStyle = { // This definition was likely missing or misplaced
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 'bold',
};

export default Navbar;