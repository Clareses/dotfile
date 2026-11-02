import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { comparisonRow, percentile, type Measurement } from "../scripts/bench-compare.ts";

const measurement = (samples: number[]): Measurement => ({ count: 100, mode: "folded", rows: 40, samples });

test("benchmark fixture renders real folded and expanded tool outputs", () => {
  const worker = fileURLToPath(new URL("../scripts/bench-render.ts", import.meta.url));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const [folded, expanded] = ["folded", "expanded"].map((mode) => JSON.parse(execFileSync(
    process.execPath, [worker, root, "10", mode], { encoding: "utf8", timeout: 30_000 },
  )) as Measurement);
  assert.ok(folded.rows > 0);
  assert.ok(expanded.rows > folded.rows);
  for (const run of [folded, expanded]) {
    assert.equal(run.count, 10);
    assert.equal(run.samples.length, 80);
    assert.ok(run.samples.every((value) => Number.isFinite(value) && value > 0));
  }
});

test("benchmark percentiles use nearest rank without mutating samples", () => {
  const samples = [4, 1, 3, 2];
  assert.equal(percentile(samples, 0.5), 2);
  assert.equal(percentile(samples, 0.95), 4);
  assert.deepEqual(samples, [4, 1, 3, 2]);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => percentile(invalid, 0.5));
});

test("benchmark comparison reports signed absolute and relative changes", () => {
  assert.match(comparisonRow(measurement([2]), measurement([3])), /\+1\.000 ms \(\+50\.0%\)/);
  assert.match(comparisonRow(measurement([2]), measurement([1])), /-1\.000 ms \(-50\.0%\)/);
  assert.match(comparisonRow(measurement([0]), measurement([1])), /n\/a/);
  const changed = { ...measurement([2]), rows: 50 };
  assert.match(comparisonRow(measurement([2]), changed), /40 → 50/);
  assert.throws(() => comparisonRow(measurement([1]), { ...changed, mode: "expanded" }));
  assert.throws(() => comparisonRow(measurement([1]), { ...changed, count: 500 }));
});
