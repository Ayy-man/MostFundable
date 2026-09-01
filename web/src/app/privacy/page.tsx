import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  description: "How MostFundable handles personal and workspace information.",
  title: "Privacy Policy | MostFundable",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <h2>Who handles your information</h2>
        <p>
          Your funding team operates your workspace and handles the client relationship. MostFundable supplies the platform and processes information for that workspace. Contact the funding team shown in your portal first so it can verify your identity and route the request correctly.
        </p>
      </section>
      <section>
        <h2>Information collected</h2>
        <ul>
          <li>Account and profile details such as name, email address, phone number, role, and workspace membership.</li>
          <li>Business-readiness inputs, uploaded documents, applications, outcomes, fee records, tasks, support messages, and action history.</li>
          <li>Payment references and status supplied by the payment provider. Full card numbers are handled by the payment provider, not stored in the MostFundable application database.</li>
          <li>Security, consent, audit, and technical records needed to operate and protect the service.</li>
        </ul>
      </section>
      <section>
        <h2>Credit-data boundary</h2>
        <p>
          SecureView displays monitoring data inside its certified experience. MostFundable does not store raw bureau reports or bureau scores in its application database. When an authorized readiness analysis runs, raw provider data is processed in memory and discarded; the service may retain derived readiness factors, instructions, provenance, and workflow state. An operator score lookup is request-lifetime only and is not written locally.
        </p>
      </section>
      <section>
        <h2>How information is used</h2>
        <p>
          Information is used to authenticate users, deliver workspace features, coordinate funding-readiness work, process authorized payments and provider requests, communicate about the account, prevent abuse, keep an audit trail, and comply with legal obligations. It is not sold as a standalone consumer-data product.
        </p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          The platform may use hosting, database, authentication, payment, credit-monitoring, identity, email, electronic-signature, and AI infrastructure providers. Each receives only the information needed for its task. AI requests are limited to the approved funding-readiness scope and use derived or minimized context rather than raw bureau data.
        </p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>
          Records are retained while needed to provide the service, document permissions and transactions, resolve complaints, meet legal duties, and protect the platform. Ask your funding team to access, correct, export, or delete your information. Some records may be retained where law, fraud prevention, payment reconciliation, or an open legal claim requires it; the team will explain any exception that applies.
        </p>
      </section>
      <section>
        <h2>Security and choices</h2>
        <p>
          The platform uses tenant access controls, authenticated sessions, limited provider credentials, and audit records. You can update available profile fields, manage supported notification choices, and revoke independently revocable permissions in the portal. No security method eliminates all risk, so report suspected account access promptly.
        </p>
      </section>
    </LegalPage>
  );
}
