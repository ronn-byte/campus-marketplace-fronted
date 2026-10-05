import VerifyEmail from "./pages/VerifyEmail";
import VerifyStudent from "./pages/VerifyStudent.jsx";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import PostItem from "./pages/PostItem.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ListingDetails from "./pages/ListingDetails.jsx";
import MyListings from "./pages/MyListings.jsx";
import MyInquiries from "./pages/MyInquiries.jsx";
import Profile from "./pages/Profile.jsx";
import Settings from "./pages/Settings.jsx";
import Navbar from "./components/Navbar.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import ResetPassword from "./pages/ResetPassword";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/post-item" element={<PostItem />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
	    <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/listing/:id" element={<ListingDetails />} />
            <Route path="/my-listings" element={<MyListings />} />
            <Route path="/my-inquiries" element={<MyInquiries />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/verify-student" element={<VerifyStudent />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/verify-university-email" element={<VerifyEmail />} />
          </Routes>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
