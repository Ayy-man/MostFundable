import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import path from "node:path";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../..");
const IMPORT = 'await import("./src/lib/email/bootstrap.ts");';

function run(env: Readonly<Record<string, string | undefined>>, source = IMPORT): string {
  return execFileSync(
    process.execPath,
    ["--import", "./scripts/ts-resolve-hook.mjs", "--input-type=module", "-e", source],
    { cwd: WEB_ROOT, env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" },
  );
}

describe("email bootstrap", () => {
  it("imports safely with an empty environment and explicit mock", () => {
    assert.doesNotThrow(() => run({}));
    assert.doesNotThrow(() => run({ EMAIL_DRIVER: "mock" }));
  });

  it("fails at import for explicit Resend without a usable key", () => {
    assert.throws(() => run({ EMAIL_DRIVER: "resend" }));
    assert.throws(() => run({ EMAIL_DRIVER: "resend", RESEND_API_KEY: "   " }));
  });

  // R4C-06. The driver refuses to construct without a from address, and the
  // refusal surfaces inside `ancillary/notifications.ts` as a generic failed
  // job that retries to exhaustion, so a preflight that only checks the API key
  // lets an operator silently miss a card-failure notice.
  it("fails at import for explicit Resend without a from address", () => {
    const KEY_SENTINEL = "re_sentinel_must_not_appear";
    const FROM_SENTINEL = "sentinel-mailbox@platform.test";
    for (const source of [
      { EMAIL_DRIVER: "resend", RESEND_API_KEY: KEY_SENTINEL },
      { EMAIL_DRIVER: "resend", RESEND_API_KEY: KEY_SENTINEL, EMAIL_FROM_ADDRESS: "  " },
      { EMAIL_DRIVER: "resend", EMAIL_FROM_ADDRESS: FROM_SENTINEL },
    ]) {
      let message = "";
      try {
        run(source);
      } catch (error) {
        message = String((error as { stderr?: unknown }).stderr ?? error);
      }
      assert.match(message, /EMAIL_DRIVER/);
      assert.match(message, /EMAIL_FROM_ADDRESS|RESEND_API_KEY/);
      // Key names only. Nothing the environment supplied may reach the log.
      assert.doesNotMatch(message, new RegExp(KEY_SENTINEL));
      assert.doesNotMatch(message, new RegExp(FROM_SENTINEL.replace(".", "\\.")));
    }
  });

  it("fails at import for an unsupported selector", () => {
    assert.throws(() => run({ EMAIL_DRIVER: "unsupported" }));
  });

  it("constructs the configured Resend arm without database or network activity", () => {
    const source = `
      const module = await import("./src/lib/email/bootstrap.ts");
      const repository = {
        claim: async () => { throw new Error("unexpected"); },
        accept: async () => { throw new Error("unexpected"); },
        fail: async () => { throw new Error("unexpected"); }
      };
      module.createEmailDriver(
        { RESEND_API_KEY: "configured", EMAIL_FROM_ADDRESS: "mail@platform.test" },
        { repository, fetch: async () => { throw new Error("unexpected"); }, resolveOrgDisplayName: async () => "Operator" }
      );
      process.stdout.write("constructed");
    `;
    assert.equal(
      run(
        {
          EMAIL_DRIVER: "resend",
          RESEND_API_KEY: "configured",
          EMAIL_FROM_ADDRESS: "mail@platform.test",
        },
        source,
      ),
      "constructed",
    );
  });
});
