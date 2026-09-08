import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1",
  withCredentials: true,
  timeout: 10000,
  headers: {
    Accept: "application/json",
  },
});

export const getApiErrorMessage = (error) => {
  if (error.response?.status === 401) {
    return "Your session has expired. Please sign in again.";
  }

  if (error.response?.status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }

  if (!error.response) {
    return "We could not reach the marketplace. Check your connection and try again.";
  }

  return error.response.data?.error?.message || "Something went wrong. Please try again.";
};

export default apiClient;
