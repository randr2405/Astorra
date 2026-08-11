import { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./lib/firebase";
import { supabase } from "./lib/supabaseClient";
import { hasAiAccess } from "./lib/plans";
import CustomCursor from "./components/CustomCursor";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import PayInvoice from "./pages/PayInvoice";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Feedback from "./pages/Feedback";
import JoinTeam from "./pages/JoinTeam";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import Quotes from "./pages/Quotes";
import Jobs from "./pages/Jobs";
import Invoices from "./pages/Invoices";
import Inventory from "./pages/Inventory";
import Assets from "./pages/Assets";
import Suppliers from "./pages/Suppliers";
import Payroll from "./pages/Payroll";
import Leave from "./pages/Leave";
import Staff from "./pages/Staff";
import Bookings from "./pages/Bookings";
import Documents from "./pages/Documents";
import Notifications from "./pages/Notifications";
import Marketplace from "./pages/Marketplace";
import Billing from "./pages/Billing";
import Settings from "./pages/Settings";
import AIBuilder from "./pages/AIBuilder";
import Reports from "./pages/Reports";
import Expenses from "./pages/Expenses";
import Team from "./pages/Team";

// If the initial business fetch comes back empty (no row found), retry a
// few times with a short delay before trusting it. This covers transient
// Supabase hiccups — e.g. a cold start or dropped connection right as a
// PayFast/invite redirect lands on a protected route — instead of
// immediately treating "no business" as final and bouncing to onboarding.
const BUSINESS_FETCH_RETRIES = 3;
const BUSINESS_FETCH_RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchUserAndBusiness(firebaseUid) {
  for (let attempt = 0; attempt <= BUSINESS_FETCH_RETRIES; attempt++) {
    const { data, error } = await supabase
      .from("users")
      .select("*, businesses(*)")
      .eq("firebase_uid", firebaseUid)
      .maybeSingle();

    if (error) {
      console.error("fetchUserAndBusiness: query error", error);
    } else if (data?.businesses) {
      return data;
    }

    // No row yet (or a query error) — could be a genuinely new user with
    // no business, or a transient failure/race. Retry a few times before
    // accepting "no business" as the real answer.
    if (attempt < BUSINESS_FETCH_RETRIES) {
      await sleep(BUSINESS_FETCH_RETRY_DELAY_MS);
    }
  }

  return null;
}

function App() {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [appUser, setAppUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Mirrors `business` so the auth listener below can check the latest
  // value without needing `business` in its dependency array (which would
  // re-subscribe the listener on every business update).
  const businessRef = useRef(null);
  useEffect(() => {
    businessRef.current = business;
  }, [business]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // onAuthStateChanged fires again on silent token refresh (roughly
        // hourly) and other auth churn, not just sign-in. If we already
        // have a business loaded for this session, skip the Supabase
        // re-fetch so it can't overwrite fresher state (e.g. a module
        // just installed/uninstalled via Marketplace's onBusinessUpdate).
        if (!businessRef.current) {
          const data = await fetchUserAndBusiness(currentUser.uid);

          if (data?.businesses) {
            setBusiness(data.businesses);
            setAppUser(data);
          }
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

  // Passed down to Marketplace/Billing/Settings/AIBuilder so a plan switch,
  // module install/uninstall, or business detail update is reflected
  // immediately across the app (e.g. the Dashboard's module grid and plan
  // strip) without a full reload.
  const handleBusinessUpdate = (updatedBusiness) => {
    setBusiness(updatedBusiness);
  };

  if (loading) return <p style={{ textAlign: "center", marginTop: "80px" }}>Loading...</p>;

  return (
    <BrowserRouter>
      <CustomCursor />
      <Routes>
        <Route path="/" element={<Landing />} />

        {/* Public, unauthenticated route — the person paying an invoice is
            the business's customer, not an Astorra account holder. No
            Firebase/Supabase auth check here, same tier as Landing/Auth. */}
        <Route path="/pay/:token" element={<PayInvoice />} />

        {/* Public, unauthenticated legal pages — same tier as Landing/Auth. */}
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />

        {/* Public, unauthenticated feedback / recommendations page — same
            tier as Landing/Privacy/Terms. */}
        <Route path="/feedback" element={<Feedback />} />

        {/* Public, unauthenticated staff invite acceptance route — the
            invitee handles their own Firebase sign-up/sign-in here before
            accept_staff_invite links them to the inviting business. */}
        <Route path="/join/:token" element={<JoinTeam />} />

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
          path="/dashboard/jobs"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Jobs business={business} appUser={appUser} />
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
          path="/dashboard/expenses"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Expenses business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/suppliers"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Suppliers business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/payroll"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Payroll business={business} appUser={appUser} />
            )
          }
        />

        <Route
          path="/dashboard/leave"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Leave business={business} appUser={appUser} />
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
          path="/dashboard/assets"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Assets business={business} appUser={appUser} />
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

        <Route
          path="/dashboard/settings"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Settings business={business} appUser={appUser} onBusinessUpdate={handleBusinessUpdate} />
            )
          }
        />

        <Route
          path="/dashboard/reports"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Reports business={business} />
            )
          }
        />

        <Route
          path="/dashboard/ai-builder"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : !hasAiAccess(business.plan) ? (
              <Navigate to="/dashboard/billing" replace />
            ) : (
              <AIBuilder business={business} appUser={appUser} onBusinessUpdate={handleBusinessUpdate} />
            )
          }
        />

        <Route
          path="/dashboard/team"
          element={
            !user ? (
              <Navigate to="/auth" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Team business={business} appUser={appUser} />
            )
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;