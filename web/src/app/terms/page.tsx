import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  description: "Terms governing use of the MostFundable funding-readiness platform.",
  title: "Terms of Service | MostFundable",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <section>
        <h2>Service scope</h2>
        <p>
          MostFundable provides educational funding-readiness software through your funding team. It is not a lender, consumer reporting agency, or law firm, and it does not guarantee approval, funding, rates, limits, or changes to a credit file.
        </p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>
          Keep your sign-in credentials confidential, provide accurate information, and tell your funding team promptly if you suspect unauthorized access. You are responsible for activity performed through your account until it is reported.
        </p>
      </section>
      <section>
        <h2>Permissions and third-party services</h2>
        <p>
          Features such as credit monitoring, payments, identity verification, electronic signatures, and lender applications may be supplied by third parties under their own terms. The product shows the permission requested before a regulated service begins, and you can revoke independently revocable permissions from the consumer portal.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not use the service to impersonate another person, submit false or unlawful material, probe another workspace, interfere with availability, bypass access controls, or seek tactics intended to falsify or manipulate furnished credit information.
        </p>
      </section>
      <section>
        <h2>Fees, cancellation, and records</h2>
        <p>
          Prices, renewal timing, fee agreements, and cancellation terms shown at purchase or in a signed agreement control the corresponding charge. Keep copies of agreements and receipts, and report a billing issue to your funding team as soon as possible so the underlying provider record can be reviewed.
        </p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>
          The service may be changed, suspended, or limited to protect users, comply with law, maintain providers, or address misuse. We will use reasonable care in operating the service, but no online system or third-party data source is continuously available or error-free.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          Contact the funding team identified in your workspace for account, billing, or legal questions. They can route platform-level requests to MostFundable support.
        </p>
      </section>
    </LegalPage>
  );
}
