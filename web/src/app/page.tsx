import { redirect } from "next/navigation";

import { DemoApp } from "@/components/demo/demo-app";
import { SIGN_IN_PATH, surfacePathFor } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { featureFlag } from "@/lib/env";

/**
 * The flag check has to be the first statement, and that single structural
 * detail is the whole of AUTH-03. Reading `process.env` in a Server Component
 * leaves the route prerenderable; reaching a dynamic request API does not, and
 * `getSession()` reads the cookie store. With the flag off the branch returns
 * before anything dynamic runs, so `/` still prerenders and its served DOM
 * still matches the wave-1 baseline byte for byte.
 *
 * An `await` above the branch, a hoisted dynamic import, or a request API
 * touched at module scope all break that, and they break it silently: the route
 * flips from static to dynamic, the prerendered document stops existing, the
 * baseline comparison has nothing to compare, and nothing errors. Hence
 * `scripts/auth/diff-root-baseline.mjs` in the gate.
 *
 * `Home` itself stays synchronous, and that is load-bearing rather than
 * stylistic. Marking it `async` keeps the route static and keeps the DOM
 * identical, but React then emits the page subtree as a deferred row in the
 * flight stream — the baseline's `5:I[…,"DemoApp"]` becomes `"$L5"` resolved by
 * a later `5:["$","$Le",null,{}]`, and every row after it renumbers. Same
 * components, same props, same markup, a different hydration stream. Measured
 * on this tree; the session read therefore lives in the nested component below,
 * which the flag-off path never renders.
 *
 * The off path returns the same single `<DemoApp />` element it returned before
 * this lane touched the file — no wrapper, no fragment, no new JSX.
 */
export default function Home() {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return <DemoApp />;
  }

  return <AuthenticatedEntry />;
}

/**
 * `/` is a router, not a view, once real auth is on: signed in goes to that
 * role's surface, signed out goes to sign-in. Nothing renders on either path.
 */
async function AuthenticatedEntry(): Promise<never> {
  const session = await getSession();

  return redirect(session ? surfacePathFor(session.role) : SIGN_IN_PATH);
}
