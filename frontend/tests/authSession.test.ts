import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAuthCheckFailure,
  isAuthProbePath,
  isCanceledRequestError,
  isTransientAuthNetworkError,
} from "@/lib/authSession";

test("identifies auth probe endpoints", () => {
  assert.equal(isAuthProbePath("/api/auth/verify"), true);
  assert.equal(isAuthProbePath("/backend/api/auth/status"), true);
  assert.equal(isAuthProbePath("/api/articles"), false);
});

test("treats canceled and network blips as transient auth failures", () => {
  assert.equal(
    isCanceledRequestError({ code: "ERR_CANCELED", name: "CanceledError" }),
    true,
  );
  assert.equal(
    isTransientAuthNetworkError({ message: "Network Error", isAxiosError: true }),
    true,
  );
  assert.equal(
    isTransientAuthNetworkError({
      response: { status: 500 },
      message: "Request failed",
    }),
    false,
  );
});

test("keeps previous admin state after a successful check hits a network blip", () => {
  const decision = decideAuthCheckFailure({
    error: { message: "Network Error" },
    hasSuccessfulCheck: true,
    previousIsAdmin: true,
    cachedSnapshot: null,
  });
  assert.deepEqual(decision, {
    keepPreviousAdmin: true,
    useCachedSnapshot: false,
    silenceNotification: true,
  });
});

test("uses cached admin session when first check network-fails", () => {
  const decision = decideAuthCheckFailure({
    error: { message: "Network Error" },
    hasSuccessfulCheck: false,
    previousIsAdmin: false,
    cachedSnapshot: {
      isAdmin: true,
      isInitialized: true,
      checkedAt: Date.now(),
    },
  });
  assert.deepEqual(decision, {
    keepPreviousAdmin: false,
    useCachedSnapshot: true,
    silenceNotification: true,
  });
});

test("clears admin only on hard auth failures", () => {
  const decision = decideAuthCheckFailure({
    error: {
      response: { status: 401, data: { detail: "unauthorized" } },
      message: "Request failed with status code 401",
    },
    hasSuccessfulCheck: true,
    previousIsAdmin: true,
    cachedSnapshot: {
      isAdmin: true,
      isInitialized: true,
      checkedAt: Date.now(),
    },
  });
  assert.deepEqual(decision, {
    keepPreviousAdmin: false,
    useCachedSnapshot: false,
    silenceNotification: false,
  });
});
