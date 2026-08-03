import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
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

function useHeroParallax() {
  const heroRef = useRef(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const handleMove = (e) => {
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      hero.style.setProperty("--mx", x.toFixed(3));
      hero.style.setProperty("--my", y.toFixed(3));
    };

    hero.addEventListener("mousemove", handleMove);
    return () => hero.removeEventListener("mousemove", handleMove);
  }, []);

  return heroRef;
}

function useTilt() {
  const handleMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--rx", (-y * 8).toFixed(2));
    card.style.setProperty("--ry", (x * 8).toFixed(2));
    card.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
    card.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
  };

  const handleLeave = (e) => {
    const card = e.currentTarget;
    card.style.setProperty("--rx", 0);
    card.style.setProperty("--ry", 0);
  };

  return { onMouseMove: handleMove, onMouseLeave: handleLeave };
}

function Counter({ value, label }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(value.startsWith("<") || isNaN(parseInt(value)) ? value : "0");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const numeric = parseInt(value.replace(/[^0-9]/g, ""), 10);
    const prefix = value.match(/^[^0-9]*/)[0];
    const suffix = value.match(/[^0-9]*$/)[0];

    if (isNaN(numeric)) {
      setDisplay(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            let start = 0;
            const duration = 1200;
            const startTime = performance.now();

            const tick = (now) => {
              const progress = Math.min((now - startTime) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              start = Math.round(eased * numeric);
              setDisplay(`${prefix}${start}${suffix}`);
              if (progress < 1) requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="stat reveal" ref={ref}>
      <span className="stat-value">{display}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

const modules = [
  { name: "Customers", desc: "One record per customer, feeding everything else" },
  { name: "Quotes", desc: "Create and send quotes to customers, ready to convert" },
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

const stats = [
  { value: "5", label: "core modules ready on day one" },
  { value: "<10", label: "minutes from sign-up to working workspace" },
  { value: "1", label: "dashboard instead of five logins" },
  { value: "24/7", label: "your business, always in view" },
];

function Landing() {
  const navigate = useNavigate();
  useScrollReveal();
  const heroRef = useHeroParallax();
  const tilt = useTilt();

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

      <header className="hero" ref={heroRef}>
        <div className="hero-spotlight" aria-hidden="true"></div>
        <div className="hero-glow hero-glow-1" aria-hidden="true"></div>
        <div className="hero-glow hero-glow-2" aria-hidden="true"></div>
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
            <button className="cta-btn cta-btn--large cta-magnetic" onClick={() => navigate("/auth")}>
              Get started free
            </button>
            <span className="hero-note">Free tier available. No card required. Live in under 10 minutes.</span>
          </div>
        </div>
      </header>

      <section className="stats-strip">
        <div className="section-inner stats-inner">
          {stats.map((s) => (
            <Counter key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

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
              <div
                className="module-card reveal tilt-card"
                style={{ transitionDelay: `${i * 70}ms` }}
                key={m.name}
                {...tilt}
              >
                <div className="tilt-glow"></div>
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
                className={`pricing-card reveal tilt-card ${t.highlight ? "pricing-card--highlight" : ""}`}
                style={{ transitionDelay: `${i * 70}ms` }}
                key={t.name}
                {...tilt}
              >
                <div className="tilt-glow"></div>
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
        <div className="closing-glow" aria-hidden="true"></div>
        <div className="section-inner closing-inner reveal">
          <p className="eyebrow eyebrow-center">Ready when you are</p>
          <h2>One platform. Your way.</h2>
          <p className="hero-sub">
            Answer a few questions and see the workspace Astorra builds for
            your business — free, and ready before your coffee's cold.
          </p>
          <button className="cta-btn cta-btn--large cta-magnetic" onClick={() => navigate("/auth")}>
            Get started free
          </button>
          <span className="hero-note">No card required. Cancel anytime.</span>
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