import axios from "axios";
import { getApiErrorMessage } from "./apiErrors";

const apiClient = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 10000,
  headers: {
    Accept: "application/json",
  },
});

export { getApiErrorMessage };

export default apiClient;
