import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./lib/firebase";
import { supabase } from "./lib/supabaseClient";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import Quotes from "./pages/Quotes";
import Invoices from "./pages/Invoices";
import Inventory from "./pages/Inventory";
import Staff from "./pages/Staff";
import Bookings from "./pages/Bookings";

function App() {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // No manual token minting or session refresh needed here --
        // supabaseClient.js's accessToken callback fetches a fresh
        // Firebase ID token on every request automatically, and Supabase
        // verifies it directly via the Firebase Third Party Auth provider.
        const { data } = await supabase
          .from("users")
          .select("*, businesses(*)")
          .eq("firebase_uid", currentUser.uid)
          .maybeSingle();

        if (data?.businesses) setBusiness(data.businesses);
      } else {
        setBusiness(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) return <p style={{ textAlign: "center", marginTop: "80px" }}>Loading...</p>;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public landing page - always accessible */}
        <Route path="/" element={<Landing />} />

        {/* Auth page - redirect to onboarding/dashboard if already logged in */}
        <Route
          path="/auth"
          element={
            !user ? (
              <Auth />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />

        {/* Onboarding - only for logged-in users without a business yet */}
        <Route
          path="/onboarding"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : business ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Onboarding firebaseUser={user} onComplete={setBusiness} />
            )
          }
        />

        {/* Dashboard - only for logged-in users with a business */}
        <Route
          path="/dashboard"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Dashboard business={business} />
            )
          }
        />

        {/* Customers module - only for logged-in users with a business */}
        <Route
          path="/dashboard/customers"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Customers business={business} />
            )
          }
        />

        {/* Quotes module - only for logged-in users with a business */}
        <Route
          path="/dashboard/quotes"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Quotes business={business} />
            )
          }
        />

        {/* Invoices module - only for logged-in users with a business */}
        <Route
          path="/dashboard/invoices"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Invoices business={business} />
            )
          }
        />

        {/* Inventory module - only for logged-in users with a business */}
        <Route
          path="/dashboard/inventory"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Inventory business={business} />
            )
          }
        />

        {/* Staff module - only for logged-in users with a business */}
        <Route
          path="/dashboard/staff"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Staff business={business} />
            )
          }
        />

        {/* Bookings module - only for logged-in users with a business */}
        <Route
          path="/dashboard/bookings"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Bookings business={business} />
            )
          }
        />

        {/* Catch-all: send unknown routes back home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;