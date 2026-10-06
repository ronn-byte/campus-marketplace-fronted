import axios from "axios";

const apiClient = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 10000,
  headers: {
    Accept: "application/json",
  },
});

export const getApiErrorMessage = (error, context = "request") => {
  if (error.response?.status === 401 && context === "session") {
    return "Your session has expired. Please sign in again.";
  }

  if (error.response?.status === 401 && context === "login") {
    return "Unable to sign in with those credentials.";
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
