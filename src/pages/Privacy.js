import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";

// Public, unauthenticated page — no Firebase/Supabase checks needed.
// Route this at /privacy in App.jsx (see routing note).

const LAST_UPDATED = "6 August 2026";

export default function Privacy() {
  return (
    <div style={styles.page}>
      <Helmet>
        <title>Privacy Policy | Astorra</title>
        <meta
          name="description"
          content="Astorra's privacy policy — what personal information we collect, why, and your rights under South Africa's POPIA."
        />
        <link rel="canonical" href="https://www.astorra.co.za/privacy" />
      </Helmet>
      <div style={styles.container}>
        <Link to="/" style={styles.backLink}>
          ← Back to Astorra
        </Link>

        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.meta}>Last updated: {LAST_UPDATED}</p>
        <p style={styles.intro}>
          Astorra is owned and operated by R&amp;R Agencies ("Astorra", "we", "us", "our").
          This policy explains what personal information we collect through the Astorra
          platform, why we collect it, and the rights you have over it under South
          Africa's Protection of Personal Information Act (POPIA).
        </p>

        <Section title="1. Who this applies to">
          <p>
            This policy covers two groups of people: business owners and their staff who
            sign up to use Astorra ("account users"), and the customers of those
            businesses whose details are entered into Astorra by an account user (for
            example, to send a quote or invoice) or who pay an invoice through Astorra's
            public payment page.
          </p>
        </Section>

        <Section title="2. What we collect">
          <List
            items={[
              "Account details: name, email address, and authentication data, handled by Firebase Authentication (email/password or Google sign-in).",
              "Business details: business name, industry, team size, contact details, banking details (for invoice payment instructions), and registration/VAT numbers, where provided.",
              "Operational data entered into the modules you install: customer records, quotes, invoices, jobs, expenses, inventory, staff records, leave requests, bookings, assets, purchase orders, and payroll data (including tax numbers, pay rates, and PAYE/UIF calculations).",
              "Uploaded files: documents, receipts, asset photos, and business logos.",
              "Payment data: processed by PayFast for subscription billing and invoice payments. We store a payment reference and status, not full card or banking credentials.",
              "Usage data sent to the AI Builder: when you use the AI Builder, the text of your request and relevant business data is sent to the Claude API (Anthropic) to generate a response.",
            ]}
          />
        </Section>

        <Section title="3. Why we collect it">
          <List
            items={[
              "To provide the core functionality of the modules you install.",
              "To authenticate your account and keep your business's data separate from every other business on Astorra.",
              "To process subscription payments and invoice payments via PayFast.",
              "To send in-app notifications (e.g. an overdue invoice or upcoming booking).",
              "To power the AI Builder's module recommendations and business-data answers.",
              "To meet our own legal, tax, and accounting obligations.",
            ]}
          />
        </Section>

        <Section title="4. Where your data is stored">
          <p>
            Account authentication is handled by Firebase Authentication. Business data,
            documents, and file attachments are stored in Supabase (Postgres database and
            file storage). Every table enforces row-level security scoped to your
            business, so one business cannot see another's data.
          </p>
        </Section>

        <Section title="5. Who we share it with">
          <List
            items={[
              "PayFast — to process subscription and invoice payments.",
              "Anthropic (Claude API) — to power the AI Builder, when you choose to use that feature.",
              "Firebase (Google) and Supabase — as our authentication and data-hosting infrastructure providers.",
              "We do not sell personal information, and we do not share it with third parties for their own marketing purposes.",
            ]}
          />
        </Section>

        <Section title="6. Payroll data">
          <p>
            If you use the Payroll module, PAYE and UIF figures are calculated by Astorra
            as an estimate based on SARS tax brackets and the UIF earnings ceiling, for
            your own business's convenience. This is not a substitute for a registered
            payroll provider, accountant, or tax practitioner, and Astorra is not
            responsible for the accuracy of statutory submissions made on the basis of
            these figures.
          </p>
        </Section>

        <Section title="7. Data retention">
          <p>
            We retain your business's data for as long as your account is active. If you
            cancel your subscription, your data remains accessible for a reasonable
            period to allow export, after which it may be deleted from active systems.
            Backups may persist for a limited period afterward for disaster-recovery
            purposes.
          </p>
        </Section>

        <Section title="8. Your rights under POPIA">
          <p>You have the right to:</p>
          <List
            items={[
              "Request access to the personal information we hold about you.",
              "Request correction of inaccurate or outdated information.",
              "Request deletion of your personal information, subject to our legal and legitimate business retention needs.",
              "Object to processing of your information in certain circumstances.",
              "Lodge a complaint with the Information Regulator of South Africa.",
            ]}
          />
          <p>
            To exercise any of these rights, contact us using the details below.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            Data in transit is encrypted (HTTPS/TLS). Access to your business's data is
            restricted by authentication and row-level security policies enforced at the
            database level, so only authenticated users belonging to your business can
            read or write your business's records.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this policy from time to time. Material changes will be
            reflected by updating the "Last updated" date above.
          </p>
        </Section>

        <Section title="11. Contact us">
          <p>
            R&amp;R Agencies (trading as Astorra)
            <br />
            Phone: 081 336 5266
            <br />
            Email: info@rragencies.co.za
          </p>
        </Section>

        <p style={styles.disclaimer}>
          This policy is provided as general information and does not constitute legal
          advice. We recommend having it reviewed by a South African attorney or POPIA
          compliance specialist before relying on it.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

function List({ items }) {
  return (
    <ul style={styles.list}>
      {items.map((item, i) => (
        <li key={i} style={styles.listItem}>
          {item}
        </li>
      ))}
    </ul>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0B0F1A",
    color: "#F3F4F6",
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: "60px 24px",
  },
  container: {
    maxWidth: 760,
    margin: "0 auto",
  },
  backLink: {
    color: "#14B8A6",
    textDecoration: "none",
    fontSize: 14,
    display: "inline-block",
    marginBottom: 32,
  },
  h1: {
    fontSize: 36,
    fontWeight: 600,
    margin: "0 0 8px",
  },
  meta: {
    color: "#6B7280",
    fontSize: 14,
    marginBottom: 24,
  },
  intro: {
    fontSize: 16,
    lineHeight: 1.7,
    color: "#F3F4F6",
    marginBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  h2: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 12,
    color: "#F3F4F6",
  },
  list: {
    paddingLeft: 20,
    margin: 0,
  },
  listItem: {
    fontSize: 15,
    lineHeight: 1.7,
    color: "#D1D5DB",
    marginBottom: 8,
  },
  disclaimer: {
    fontSize: 13,
    color: "#6B7280",
    borderTop: "1px solid #1F2937",
    paddingTop: 24,
    marginTop: 40,
    lineHeight: 1.6,
  },
};