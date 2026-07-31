import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import "./Landing.css";

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

const modules = [
  { name: "Customers", desc: "One record per customer, feeding everything else" },
  { name: "Quotes", desc: "Send a quote, know the moment it's viewed" },
  { name: "Invoices", desc: "Convert quotes to invoices, track what's paid" },
  { name: "Inventory", desc: "Stock levels that stay accurate on their own" },
  { name: "Staff / HR", desc: "Records and basics, without a separate system" },
  { name: "Bookings", desc: "Scheduling that updates the whole business" },
];

const steps = [
  {
    n: "01",
    title: "Tell us about your business",
    body: "A few guided questions — team size, and what you do day to day. No form with forty fields.",
  },
  {
    n: "02",
    title: "Astorra builds your workspace",
    body: "Your answers install exactly the modules you need. Nothing you'll never open.",
  },
  {
    n: "03",
    title: "One dashboard, everything in view",
    body: "Customers, quotes, invoices, bookings — in one place, not five different logins.",
  },
  {
    n: "04",
    title: "It grows as you describe it",
    body: "Need something new? Describe the problem in plain language and the right modules get installed.",
  },
];

const tiers = [
  { name: "Free", price: "R0", cadence: "/pm", modules: "Up to 2 modules", ai: "Not included", highlight: false },
  { name: "Starter", price: "R249", cadence: "/pm", modules: "Up to 5 modules", ai: "Basic AI included", highlight: false },
  { name: "Professional", price: "R799", cadence: "/pm", modules: "Up to 10 modules", ai: "Full AI included", highlight: true },
  { name: "Enterprise", price: "R1,499", cadence: "/pm", modules: "Unlimited modules", ai: "Full AI included", highlight: false },
];

function Landing() {
  const navigate = useNavigate();
  useScrollReveal();

  return (
    <div className="landing">
      <nav className="nav">
        <div className="nav-inner">
          <span className="wordmark">ASTORRA</span>
          <div className="nav-actions">
            <button className="link-btn" onClick={() => navigate("/auth")}>
              Log in
            </button>
            <button className="cta-btn cta-btn--small" onClick={() => navigate("/auth")}>
              Get started
            </button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-threads" aria-hidden="true">
          <svg viewBox="0 0 1200 400" preserveAspectRatio="none">
            <path className="thread thread-1" d="M0,320 C250,280 350,120 620,150 C850,175 950,60 1200,90" />
            <path className="thread thread-2" d="M0,220 C280,260 420,340 640,260 C860,185 980,260 1200,220" />
            <path className="thread thread-3" d="M0,120 C260,150 380,60 620,90 C880,125 1000,180 1200,150" />
          </svg>
        </div>
        <div className="hero-content">
          <p className="slogan slogan-reveal">One platform. Your way.</p>
          <p className="eyebrow eyebrow-reveal">For businesses running on spreadsheets and WhatsApp</p>
          <h1 className="headline-reveal">
            Your business, running
            <br />
            as one connected system.
          </h1>
          <p className="hero-sub sub-reveal">
            Astorra brings customers, quotes, invoices, stock, staff and bookings
            into a single workspace that adapts to how you already operate.
          </p>
          <div className="hero-actions actions-reveal">
            <button className="cta-btn" onClick={() => navigate("/auth")}>
              Get started free
            </button>
            <span className="hero-note">Free tier available. No card required.</span>
          </div>
        </div>
      </header>

      <section className="section problem">
        <div className="section-inner problem-grid reveal">
          <div>
            <h2>You didn't start a business to manage five apps.</h2>
            <p className="body-text">
              A quote lives in one place. The invoice lives in another. Stock is
              on a spreadsheet, staff details in a folder, and half of it is
              still tracked over WhatsApp. None of it talks to each other, so
              you're the one carrying it all in your head.
            </p>
          </div>
          <div className="problem-list">
            <div className="problem-item">
              <span className="dot dot-purple" />
              Disconnected tools that don't share data
            </div>
            <div className="problem-item">
              <span className="dot dot-blue" />
              Manual work that should update itself
            </div>
            <div className="problem-item">
              <span className="dot dot-teal" />
              No single view of how the business is actually doing
            </div>
          </div>
        </div>
      </section>

      <section className="section how">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">How it works</p>
          <h2 className="center reveal">From sign-up to a working business, in minutes.</h2>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step reveal" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section modules">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">Core modules</p>
          <h2 className="center reveal">Install what you need. Skip what you don't.</h2>
          <div className="module-grid">
            {modules.map((m, i) => (
              <div className="module-card reveal" style={{ transitionDelay: `${i * 70}ms` }} key={m.name}>
                <h3>{m.name}</h3>
                <p>{m.desc}</p>
              </div>
            ))}
          </div>
          <p className="modules-footnote">
            Plus a marketplace of more, and an AI Builder that installs the right
            ones just by describing your problem in plain language.
          </p>
        </div>
      </section>

      <section className="section pricing">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">Pricing</p>
          <h2 className="center reveal">Pay for what you use. Grow when you're ready.</h2>
          <div className="pricing-grid">
            {tiers.map((t, i) => (
              <div
                className={`pricing-card reveal ${t.highlight ? "pricing-card--highlight" : ""}`}
                style={{ transitionDelay: `${i * 70}ms` }}
                key={t.name}
              >
                {t.highlight && <span className="pricing-badge">Most popular</span>}
                <h3>{t.name}</h3>
                <div className="pricing-amount">
                  <span className="pricing-price">{t.price}</span>
                  <span className="pricing-cadence">{t.cadence}</span>
                </div>
                <p className="pricing-modules">{t.modules}</p>
                <p className="pricing-ai">{t.ai}</p>
                <button
                  className={t.highlight ? "cta-btn cta-btn--small" : "cta-btn cta-btn--ghost"}
                  onClick={() => navigate("/auth")}
                >
                  Get started
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section closing">
        <div className="section-inner closing-inner reveal">
          <h2>One platform. Your way.</h2>
          <p className="hero-sub">
            Answer a few questions and see the workspace Astorra builds for
            your business.
          </p>
          <button className="cta-btn" onClick={() => navigate("/auth")}>
            Get started free
          </button>
        </div>
      </section>

      <footer className="footer">
        <div className="section-inner footer-inner">
          <span className="wordmark wordmark-small">ASTORRA</span>
          <div className="footer-meta">
            <span>Owned and operated by R&amp;R Agencies</span>
            <span>info@rragencies.co.za · 081 336 5266</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;