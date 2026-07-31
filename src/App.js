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
import Documents from "./pages/Documents";
import Notifications from "./pages/Notifications";
import Marketplace from "./pages/Marketplace";
import Billing from "./pages/Billing";

function App() {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [appUser, setAppUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const { data } = await supabase
          .from("users")
          .select("*, businesses(*)")
          .eq("firebase_uid", currentUser.uid)
          .maybeSingle();

        if (data?.businesses) {
          setBusiness(data.businesses);
          setAppUser(data);
        }
      } else {
        setBusiness(null);
        setAppUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleOnboardingComplete = (newBusiness, newAppUser) => {
    setBusiness(newBusiness);
    if (newAppUser) setAppUser(newAppUser);
  };

  // Passed down to Marketplace/Billing so a plan switch or module
  // install/uninstall is reflected immediately across the app (e.g. the
  // Dashboard's module grid and plan strip) without a full reload.
  const handleBusinessUpdate = (updatedBusiness) => {
    setBusiness(updatedBusiness);
  };

  if (loading) return <p style={{ textAlign: "center", marginTop: "80px" }}>Loading...</p>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />

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

        <Route
          path="/onboarding"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : business ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Onboarding firebaseUser={user} onComplete={handleOnboardingComplete} />
            )
          }
        />

        <Route
          path="/dashboard"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Dashboard business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/customers"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Customers business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/quotes"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Quotes business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/invoices"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Invoices business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/inventory"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Inventory business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/staff"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Staff business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/bookings"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Bookings business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/documents"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Documents business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/notifications"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Notifications business={business} />
            )
          }
        />

        <Route
          path="/dashboard/marketplace"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Marketplace business={business} appUser={appUser} onBusinessUpdate={handleBusinessUpdate} />
            )
          }
        />

        <Route
          path="/dashboard/billing"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Billing business={business} appUser={appUser} onBusinessUpdate={handleBusinessUpdate} />
            )
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;