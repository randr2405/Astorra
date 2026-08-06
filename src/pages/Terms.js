import { Link } from "react-router-dom";

// Public, unauthenticated page — no Firebase/Supabase checks needed.
// Route this at /terms in App.jsx (see routing note).

const LAST_UPDATED = "6 August 2026";

export default function Terms() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <Link to="/" style={styles.backLink}>
          ← Back to Astorra
        </Link>

        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Last updated: {LAST_UPDATED}</p>
        <p style={styles.intro}>
          These terms govern your use of Astorra, a business management platform owned
          and operated by R&amp;R Agencies ("Astorra", "we", "us", "our"). By creating an
          account, you agree to these terms.
        </p>

        <Section title="1. The service">
          <p>
            Astorra is a modular platform that lets a business install the tools it
            needs — Customers, Quotes, Invoices, Jobs, Expenses, Inventory, Staff/HR,
            Leave, Bookings, Assets, Purchase Orders/Suppliers, Payroll, Documents, and
            Reports — from a single dashboard, with an AI Builder available on paid
            plans to recommend modules based on a plain-language description of your
            business's needs.
          </p>
        </Section>

        <Section title="2. Accounts">
          <List
            items={[
              "You must provide accurate information when creating your account and keep your login credentials secure.",
              "You are responsible for all activity that happens under your account, including actions taken by staff members you invite.",
              "We may suspend or terminate an account that we reasonably believe is being used fraudulently, abusively, or in violation of these terms.",
            ]}
          />
        </Section>

        <Section title="3. Plans and billing">
          <List
            items={[
              "Astorra offers Free, Starter, Professional, and Enterprise plans, each with a different number of includable modules and AI Builder request allowance.",
              "Paid plans are billed on a recurring monthly basis via PayFast. By subscribing to a paid plan, you authorise Astorra to charge your chosen payment method each billing cycle until you cancel.",
              "If a payment fails, we may restrict access to paid features until the outstanding amount is settled.",
              "You can cancel or downgrade your plan at any time; changes take effect as described at the point of cancellation. Modules beyond your new plan's cap may be uninstalled.",
              "Prices are in South African Rand (ZAR) and may change with reasonable notice.",
            ]}
          />
        </Section>

        <Section title="4. Your data and content">
          <List
            items={[
              "You retain ownership of all data you enter into Astorra — customer records, quotes, invoices, staff and payroll data, documents, and everything else.",
              "You are responsible for the accuracy of the data you enter, including customer contact details, invoice amounts, and payroll information.",
              "You grant us a limited licence to store, process, and display your data solely for the purpose of operating the platform on your behalf.",
              "See our Privacy Policy for how we collect, use, and protect personal information.",
            ]}
          />
        </Section>

        <Section title="5. Payroll disclaimer">
          <p>
            The Payroll module calculates PAYE and UIF as an estimate based on SARS tax
            brackets and the UIF earnings ceiling, for your convenience. It is not a
            substitute for a registered payroll provider, accountant, or tax
            practitioner. You are responsible for verifying figures before making
            statutory submissions or payments, and Astorra is not liable for penalties,
            interest, or losses arising from reliance on these calculations.
          </p>
        </Section>

        <Section title="6. Customer payment pages">
          <p>
            When you send a quote or invoice through Astorra, your customer may receive
            a link to a public payment page. Astorra facilitates this via PayFast but is
            not a party to the underlying transaction between you and your customer, and
            is not responsible for disputes arising from it.
          </p>
        </Section>

        <Section title="7. Acceptable use">
          <p>You agree not to use Astorra to:</p>
          <List
            items={[
              "Store or send unlawful, fraudulent, or infringing content.",
              "Attempt to access another business's data or circumvent access controls.",
              "Reverse-engineer, resell, or white-label the platform without our written agreement.",
              "Overload or disrupt the platform's infrastructure.",
            ]}
          />
        </Section>

        <Section title="8. AI Builder">
          <p>
            The AI Builder uses the Claude API to recommend modules and answer
            business-specific questions based on data you provide. Recommendations and
            answers are generated automatically and may occasionally be inaccurate or
            incomplete — you remain responsible for reviewing and confirming any module
            installation or business decision made using it. AI Builder usage is subject
            to the monthly request allowance of your plan.
          </p>
        </Section>

        <Section title="9. Availability">
          <p>
            We aim to keep Astorra available and reliable but do not guarantee
            uninterrupted access. We may perform maintenance, and features may change as
            the platform is developed further.
          </p>
        </Section>

        <Section title="10. Limitation of liability">
          <p>
            To the extent permitted by law, Astorra is provided "as is" without
            warranties of any kind. We are not liable for indirect, incidental, or
            consequential losses arising from your use of the platform, including but
            not limited to lost revenue, lost data, or errors in figures calculated by
            the platform (including Payroll estimates). Nothing in these terms limits
            liability that cannot be excluded under South African law.
          </p>
        </Section>

        <Section title="11. Custom development">
          <p>
            For businesses needing functionality beyond the standard modules, Astorra
            (via R&amp;R Agencies) also offers custom software development as a separate,
            individually scoped and contracted service, outside of these subscription
            terms.
          </p>
        </Section>

        <Section title="12. Termination">
          <p>
            You may close your account at any time from Settings. We may suspend or
            terminate access for breach of these terms. On termination, your right to
            access the platform ends, subject to the data-export and retention terms in
            our Privacy Policy.
          </p>
        </Section>

        <Section title="13. Changes to these terms">
          <p>
            We may update these terms from time to time. Continued use of Astorra after
            an update constitutes acceptance of the revised terms.
          </p>
        </Section>

        <Section title="14. Governing law">
          <p>
            These terms are governed by the laws of the Republic of South Africa.
          </p>
        </Section>

        <Section title="15. Contact us">
          <p>
            R&amp;R Agencies (trading as Astorra)
            <br />
            Phone: 081 336 5266
            <br />
            Email: info@rragencies.co.za
          </p>
        </Section>

        <p style={styles.disclaimer}>
          These terms are provided as general information and do not constitute legal
          advice. We recommend having them reviewed by a South African attorney before
          relying on them.
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