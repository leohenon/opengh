import { expect, test } from "bun:test"
import { assigneeChanges } from "../src/assignee-changes"

test("assignee changes contain only differences, ignore case and duplicates, and resend uncertain logins", () => {
  expect(assigneeChanges(["max", "jane"], ["max", "jane"])).toEqual({ add: [], remove: [] })
  expect(assigneeChanges(["max", "jane"], ["MAX", "john", "John"])).toEqual({ add: ["john"], remove: ["jane"] })
  expect(assigneeChanges(["max"], [])).toEqual({ add: [], remove: ["max"] })
  // A failed save left kate and john uncertain: kate stays chosen, so she is added again; john is removed again.
  expect(assigneeChanges(["max"], ["max", "kate"], ["kate", "john", "KATE"])).toEqual({ add: ["kate"], remove: ["john"] })
})
