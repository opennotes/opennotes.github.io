import { test, expect } from "@playwright/test";

import benchmark from "../scenarios/benchmark-switch.js";

test("Switching files keeps the existing tree and remains responsive", async ({ page }, testInfo) => {
  const result = await benchmark(page);
  expect(result.tree).toEqual([]);
  expect(Math.max(...result.switches.slice(1))).toBeLessThan(1000);
  await testInfo.attach("timings.json", { body: JSON.stringify(result), contentType: "application/json" });
});
