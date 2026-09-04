import { runEmailDriverContract } from "./driver-contract.ts";
import { createMockEmailDriver } from "./mock-driver.ts";
import { createResendEmailDriver } from "./resend-driver.ts";

runEmailDriverContract(
  ({ repository }) => createMockEmailDriver({ repository }),
  "mock",
);

runEmailDriverContract(
  ({ repository, resolveOrgDisplayName }) =>
    createResendEmailDriver({
      apiKey: "contract-key",
      fetch: async () =>
        new Response(JSON.stringify({ id: "contract-provider-receipt" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      fromAddress: "contract@platform.test",
      repository,
      resolveOrgDisplayName,
    }),
  "resend",
);
