import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { AuthContext } from "./authContext";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionState, setSessionState] = useState("loading");

  useEffect(() => {
    let isMounted = true;

    apiClient.get("/auth/session")
      .then(({ data }) => {
        if (isMounted) {
          setUser(data.user || null);
          setSessionState(data.user ? "authenticated" : "unauthenticated");
        }
      })
      .catch((error) => {
        if (isMounted) {
          setUser(null);
          setSessionState(error.response?.status === 401 ? "unauthenticated" : "error");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated: Boolean(user),
    sessionState,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
