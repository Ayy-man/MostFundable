import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const globals = source("../../app/globals.css");

describe("shared motion system", () => {
  it("defines one token scale and semantic motion primitives", () => {
    for (const token of [
      "--duration-stagger",
      "--duration-quick",
      "--duration-fast",
      "--ease-smooth-out",
      "--page-slide-dur",
      "--dropdown-open-dur",
      "--modal-open-dur",
      "--panel-open-dur",
      "--tabs-dur",
      "--acc-expand",
      "--toast-open",
    ]) {
      assert.match(globals, new RegExp(`${token}:`), `${token} must remain centralized`);
    }

    for (const primitive of [
      ".t-dropdown",
      ".t-modal",
      ".t-sheet",
      ".t-acc-panel",
      ".t-tabs-pill",
      ".t-tt",
      ".t-toast",
    ]) {
      assert.match(globals, new RegExp(primitive.replace(".", "\\.")));
    }
  });

  it("keeps route, role, and in-surface navigation motion distinct", () => {
    assert.match(globals, /\[data-motion-route\][^{]*\{\s*animation: mf-route-enter/);
    assert.match(globals, /\[data-motion-page\]\s*\{\s*animation: mf-page-enter/);
    assert.match(globals, /\[data-motion-page\] > :nth-child\(7\)/);
    assert.doesNotMatch(globals, /\[data-motion-page\] > :nth-child\(8\)/);

    const demoShell = source("../../components/demo/demo-shell.tsx");
    const consumerShell = source("../../components/consumer/consumer-shell.tsx");
    const affiliate = source("../../components/surfaces/affiliate.tsx");
    for (const shell of [demoShell, consumerShell, affiliate]) {
      assert.match(shell, /data-motion-page/);
      assert.match(shell, /data-motion-nav-item/);
    }
  });

  it("wires every public route surface to the route entrance", () => {
    const routeSources = [
      source("../../app/sign-in/page.tsx"),
      source("../../app/(surfaces)/consumer/surface-client.tsx"),
      source("../../app/(surfaces)/operator/surface-client.tsx"),
      source("../../app/(surfaces)/admin/surface-client.tsx"),
      source("../../app/(surfaces)/affiliate/surface-client.tsx"),
    ];
    for (const route of routeSources) assert.match(route, /data-motion-route/);

    const demoApp = source("../../components/demo/demo-app.tsx");
    assert.match(demoApp, /data-motion-role=/);
  });

  it("uses shared lifecycle classes in the reusable interaction primitives", () => {
    const primitiveContracts = [
      ["../../components/ui/dropdown-menu.tsx", /t-dropdown/],
      ["../../components/ui/select.tsx", /t-dropdown/],
      ["../../components/ui/brand-select.tsx", /t-dropdown/],
      ["../../components/ui/dialog.tsx", /t-modal/],
      ["../../components/ui/sheet.tsx", /t-sheet/],
      ["../../components/ui/collapsible.tsx", /t-acc-panel/],
      ["../../components/ui/tabs.tsx", /t-tabs-pill/],
      ["../../components/ui/tooltip.tsx", /t-tt/],
    ] as const;

    for (const [path, contract] of primitiveContracts) assert.match(source(path), contract);

    const tooltip = source("../../components/ui/tooltip.tsx");
    assert.match(tooltip, /delay = 0/, "tooltip intent delay must come from the shared CSS token only");
  });

  it("provides a complete reduced-motion path and avoids transition-all", () => {
    assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
    for (const primitive of [".t-dropdown", ".t-modal", ".t-sheet", ".t-tabs-pill", ".t-toast"]) {
      const reducedMotion = globals.slice(globals.indexOf("@media (prefers-reduced-motion: reduce)"));
      assert.ok(reducedMotion.includes(primitive), `${primitive} needs a reduced-motion rule`);
    }

    for (const path of [
      "../../components/ui/button.tsx",
      "../../components/ui/input.tsx",
      "../../components/ui/switch.tsx",
      "../../components/ui/table.tsx",
      "../../components/ui/textarea.tsx",
    ]) {
      assert.doesNotMatch(source(path), /transition-all/);
    }

    for (const path of [
      "../../components/chat/composer.tsx",
      "../../components/chat/message-thread.tsx",
      "../../components/onboarding1.tsx",
      "../../components/surfaces/consumer.tsx",
    ]) {
      assert.doesNotMatch(
        source(path),
        /animate-spin(?![^"\n]*motion-reduce:animate-none)/,
        `${path} must stop loading-icon motion when reduced motion is requested`,
      );
    }
  });
});
