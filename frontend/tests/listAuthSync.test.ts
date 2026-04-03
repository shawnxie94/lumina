import test from "node:test";
import assert from "node:assert/strict";

import { shouldRefreshListAfterAuthResolution } from "@/lib/listAuthSync";

test("refreshes after first auth resolve when SSR data was guest but client becomes admin", () => {
  assert.equal(
    shouldRefreshListAfterAuthResolution({
      hasResolvedBefore: false,
      previousAdminState: false,
      isAdmin: true,
      initialDataLoaded: true,
      initialIsAdmin: false,
    }),
    true,
  );
});

test("skips refresh after first auth resolve when SSR data already matched admin state", () => {
  assert.equal(
    shouldRefreshListAfterAuthResolution({
      hasResolvedBefore: false,
      previousAdminState: false,
      isAdmin: true,
      initialDataLoaded: true,
      initialIsAdmin: true,
    }),
    false,
  );
});

test("refreshes when admin state changes after initial auth resolution", () => {
  assert.equal(
    shouldRefreshListAfterAuthResolution({
      hasResolvedBefore: true,
      previousAdminState: false,
      isAdmin: true,
      initialDataLoaded: true,
      initialIsAdmin: false,
    }),
    true,
  );
});

test("skips refresh when unauthenticated state is unchanged", () => {
  assert.equal(
    shouldRefreshListAfterAuthResolution({
      hasResolvedBefore: true,
      previousAdminState: false,
      isAdmin: false,
      initialDataLoaded: true,
      initialIsAdmin: false,
    }),
    false,
  );
});
