import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import PostItem from './pages/PostItem.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Navbar from './components/Navbar.jsx';

function App() {
  return (
    <BrowserRouter>
      <Navbar /> {/* Navbar component for navigation */} 
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/post-item" element={<PostItem />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
// This code sets up the main application component using React Router for navigation.
// It defines routes for the home page, posting an item, login, and registration pages.
// The `App` component uses `BrowserRouter` to manage the routing and renders different components based on the URL path.