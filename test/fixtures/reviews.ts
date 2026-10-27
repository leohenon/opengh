import { createPullReviewSession } from "../../src/pull-review-session"

// Root tests that don't exercise reviews must never prefetch the real GitHub API.
export function createTestReviewSession() {
  return createPullReviewSession({ transport: {
    async json<T>(): Promise<T> { throw new Error("Reviews are unavailable in this test") },
    async text(): Promise<string> { throw new Error("Reviews are unavailable in this test") },
  } })
}
