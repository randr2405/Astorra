import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import AppNav from "../components/AppNav";
import GradientBlinds from "./GradientBlinds";
import "./Reports.css";

const currency = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const shortCurrency = (n) => {
  if (n >= 1000000) return `R${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `R${(n / 1000).toFixed(1)}k`;
  return `R${Math.round(n)}`;
};

// Aging buckets for overdue invoices, in days past due_date.
const AGING_BUCKETS = [
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: Infinity },
];

function daysPastDue(dueDate) {
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / 86400000);
}

// Builds the last `count` calendar months as {key: "2026-01", label: "Jan"} ascending,
// ending with the current month. Used to bucket invoices/staff by month without
// depending on there being any data in every month.
function lastNMonths(count) {
  const months = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { month: "short" });
    months.push({ key, label });
  }
  return months;
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- Small inline chart primitives (no chart library dependency) ----------

function BarChart({ data, valueFormatter = (v) => v, height = 180 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rep-barchart" style={{ height }}>
      {data.map((d) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <div className="rep-bar-col" key={d.key}>
            <div className="rep-bar-track">
              <div
                className="rep-bar-fill"
                style={{ height: `${pct}%` }}
                title={valueFormatter(d.value)}
              />
            </div>
            <span className="rep-bar-value">{d.value > 0 ? valueFormatter(d.value) : ""}</span>
            <span className="rep-bar-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data, valueFormatter = (v) => v, height = 140 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - (d.value / max) * (height - 24) - 4;
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1]?.x || 0},${height} L0,${height} Z`;

  return (
    <div className="rep-linechart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="rep-linechart-svg">
        <path d={areaD} className="rep-linechart-area" />
        <path d={pathD} className="rep-linechart-line" fill="none" />
        {points.map((p) => (
          <circle key={p.key} cx={p.x} cy={p.y} r="3.5" className="rep-linechart-dot">
            <title>{`${p.label}: ${valueFormatter(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="rep-linechart-labels">
        {data.map((d) => (
          <span key={d.key}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function Reports({ business }) {
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(6); // months shown in the time-series charts

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const [{ data: invoicesData }, { data: quotesData }, { data: staffData }] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, customer_id, status, total, due_date, created_at, customers(name)")
        .eq("business_id", business.id),
      supabase
        .from("quotes")
        .select("id, status, total, created_at")
        .eq("business_id", business.id),
      supabase
        .from("staff")
        .select("id, employment_status, created_at")
        .eq("business_id", business.id),
    ]);

    setInvoices(invoicesData || []);
    setQuotes(quotesData || []);
    setStaff(staffData || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---------- Top-line stats ----------
  const stats = useMemo(() => {
    const totalRevenue = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const outstanding = invoices
      .filter((i) => i.status !== "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const overdueTotal = invoices
      .filter((i) => i.status === "overdue")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const quoteWinRate = (() => {
      const decided = quotes.filter((q) => q.status === "accepted" || q.status === "declined");
      if (decided.length === 0) return null;
      const accepted = decided.filter((q) => q.status === "accepted").length;
      return Math.round((accepted / decided.length) * 100);
    })();
    const activeStaff = staff.filter((s) => (s.employment_status || "active") === "active").length;

    return { totalRevenue, outstanding, overdueTotal, quoteWinRate, activeStaff };
  }, [invoices, quotes, staff]);

  // ---------- Revenue over time (paid invoices, by month) ----------
  const revenueByMonth = useMemo(() => {
    const months = lastNMonths(range);
    const totals = Object.fromEntries(months.map((m) => [m.key, 0]));
    invoices
      .filter((i) => i.status === "paid")
      .forEach((i) => {
        const key = monthKey(i.created_at);
        if (key in totals) totals[key] += Number(i.total || 0);
      });
    return months.map((m) => ({ key: m.key, label: m.label, value: totals[m.key] }));
  }, [invoices, range]);

  // ---------- Top customers by total invoiced ----------
  const topCustomers = useMemo(() => {
    const byCustomer = {};
    invoices.forEach((i) => {
      if (!i.customer_id) return;
      const name = i.customers?.name || "Unknown customer";
      if (!byCustomer[i.customer_id]) {
        byCustomer[i.customer_id] = { name, total: 0, count: 0, outstanding: 0 };
      }
      byCustomer[i.customer_id].total += Number(i.total || 0);
      byCustomer[i.customer_id].count += 1;
      if (i.status !== "paid") byCustomer[i.customer_id].outstanding += Number(i.total || 0);
    });
    return Object.values(byCustomer)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices]);

  // ---------- Overdue aging ----------
  const agingBuckets = useMemo(() => {
    const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { total: 0, count: 0 }]));
    invoices
      .filter((i) => i.status === "overdue" && i.due_date)
      .forEach((i) => {
        const days = daysPastDue(i.due_date);
        const bucket = AGING_BUCKETS.find((b) => days >= b.min && days <= b.max);
        if (bucket) {
          buckets[bucket.key].total += Number(i.total || 0);
          buckets[bucket.key].count += 1;
        }
      });
    return AGING_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      value: buckets[b.key].total,
      count: buckets[b.key].count,
    }));
  }, [invoices]);

  // ---------- Staff headcount trend (cumulative, by month) ----------
  const headcountTrend = useMemo(() => {
    const months = lastNMonths(range);
    return months.map((m) => {
      // Count everyone whose start-of-record (created_at) falls on or before
      // the end of this month — a running headcount, not new-hires-per-month.
      const [y, mo] = m.key.split("-").map(Number);
      const monthEnd = new Date(y, mo, 0, 23, 59, 59);
      const count = staff.filter((s) => new Date(s.created_at) <= monthEnd).length;
      return { key: m.key, label: m.label, value: count };
    });
  }, [staff, range]);

  const hasAnyData = invoices.length > 0 || quotes.length > 0 || staff.length > 0;

  return (
    <div className="rep-page">
      <div className="rep-bg">
        <GradientBlinds
          gradientColors={["#7c3aed", "#3b82f6", "#14b8a6"]}
          angle={20}
          noise={0.5}
          blindCount={16}
          blindMinWidth={60}
          spotlightRadius={0.5}
          spotlightSoftness={1}
          spotlightOpacity={1}
          mouseDampening={0.15}
          distortAmount={0}
          shineDirection="left"
          mixBlendMode="lighten"
        />
      </div>

      <AppNav business={business} />

      <div className="rep-body">
        <div className="rep-header">
          <div>
            <p className="rep-eyebrow">Reports</p>
            <h1 className="rep-heading">How your business is doing</h1>
          </div>
          <div className="rep-range-toggle">
            {[3, 6, 12].map((n) => (
              <button
                key={n}
                className={`rep-range-btn ${range === n ? "rep-range-btn--active" : ""}`}
                onClick={() => setRange(n)}
              >
                {n} mo
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="rep-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="rep-skeleton-card" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : !hasAnyData ? (
          <div className="rep-empty">
            <p>No data yet.</p>
            <p className="rep-empty-sub">
              Once you've sent a few quotes or invoices, this page will fill in with your revenue,
              top customers, and overdue tracking automatically.
            </p>
          </div>
        ) : (
          <>
            <div className="rep-stats">
              <div className="rep-stat-card">
                <p className="rep-stat-label">Revenue (paid)</p>
                <p className="rep-stat-value">{currency.format(stats.totalRevenue)}</p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Outstanding</p>
                <p className="rep-stat-value">{currency.format(stats.outstanding)}</p>
              </div>
              <div className={`rep-stat-card ${stats.overdueTotal > 0 ? "rep-stat-card--warn" : ""}`}>
                <p className="rep-stat-label">Overdue</p>
                <p className="rep-stat-value">{currency.format(stats.overdueTotal)}</p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Quote win rate</p>
                <p className="rep-stat-value">
                  {stats.quoteWinRate === null ? "—" : `${stats.quoteWinRate}%`}
                </p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Active staff</p>
                <p className="rep-stat-value">{stats.activeStaff}</p>
              </div>
            </div>

            <div className="rep-grid">
              <div className="rep-panel rep-panel--wide">
                <h2 className="rep-panel-title">Revenue over time</h2>
                <p className="rep-panel-sub">Paid invoices, by month</p>
                <BarChart data={revenueByMonth} valueFormatter={shortCurrency} />
              </div>

              <div className="rep-panel">
                <h2 className="rep-panel-title">Top customers</h2>
                <p className="rep-panel-sub">By total invoiced</p>
                {topCustomers.length === 0 ? (
                  <p className="rep-panel-empty">No invoiced customers yet.</p>
                ) : (
                  <div className="rep-top-customers">
                    {topCustomers.map((c, i) => (
                      <div className="rep-top-customer-row" key={c.name + i}>
                        <span className="rep-top-customer-rank">{i + 1}</span>
                        <div className="rep-top-customer-main">
                          <span className="rep-top-customer-name">{c.name}</span>
                          <span className="rep-top-customer-sub">
                            {c.count} invoice{c.count === 1 ? "" : "s"}
                            {c.outstanding > 0 && ` · ${currency.format(c.outstanding)} outstanding`}
                          </span>
                        </div>
                        <span className="rep-top-customer-total">{currency.format(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rep-panel">
                <h2 className="rep-panel-title">Overdue aging</h2>
                <p className="rep-panel-sub">How late your unpaid invoices are</p>
                {stats.overdueTotal === 0 ? (
                  <p className="rep-panel-empty">Nothing overdue right now.</p>
                ) : (
                  <div className="rep-aging-list">
                    {agingBuckets.map((b) => (
                      <div className="rep-aging-row" key={b.key}>
                        <span className="rep-aging-label">{b.label}</span>
                        <div className="rep-aging-track">
                          <div
                            className="rep-aging-fill"
                            style={{
                              width: `${
                                stats.overdueTotal > 0
                                  ? Math.max(2, Math.round((b.value / stats.overdueTotal) * 100))
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="rep-aging-value">
                          {b.value > 0 ? currency.format(b.value) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rep-panel rep-panel--wide">
                <h2 className="rep-panel-title">Staff headcount</h2>
                <p className="rep-panel-sub">Active team size, by month</p>
                {staff.length === 0 ? (
                  <p className="rep-panel-empty">No staff records yet.</p>
                ) : (
                  <LineChart data={headcountTrend} valueFormatter={(v) => `${v}`} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Reports;