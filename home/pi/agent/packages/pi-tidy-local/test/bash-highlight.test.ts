/**
 * Regression tests for the bash tokenizer freeze reported on 2026-09-18.
 *
 * pi-toolbox 0.2.2 and earlier treated a `#` that was neither at word start nor
 * inside quotes (`fill:#242f60`, `a#b`, `url#frag`) as a word break that no
 * branch handled. The scanner could not advance, so it pushed empty strings
 * forever. Because the call row is re-rendered on every tool-argument delta, a
 * single such command froze the whole TUI: 100% CPU, no repaint, `ctrl+c`
 * unresponsive, session file frozen.
 *
 * `highlightBashCommand` is synchronous and pure, so a runaway loop cannot be
 * interrupted from the same thread. Every case therefore runs in a worker that
 * gets killed once the deadline passes — a hang fails the test instead of
 * hanging the test run.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

const MODULE_URL = new URL("../bash-highlight.ts", import.meta.url).href;

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.moduleUrl).then(
  (mod) => {
    const run = (input) => {
      const tokens = [];
      const text = mod.highlightBashCommand(input, (token, value) => {
        tokens.push([token, value]);
        return value;
      });
      return { text, tokens };
    };
    const results = workerData.inputs ? workerData.inputs.map(run) : [run(workerData.input)];
    parentPort.postMessage({ ok: true, results });
  },
  (error) => parentPort.postMessage({ ok: false, error: String(error) }),
);
`;

interface TokenizeResult {
  /** Highlighted text; with an identity color callback this must equal the input. */
  text: string;
  /** [tokenName, text] for every colored span, in order. */
  tokens: Array<[string, string]>;
}

function tokenize(inputs: string[], timeoutMs = 5000): Promise<TokenizeResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { moduleUrl: MODULE_URL, inputs },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        new Error(
          `highlightBashCommand did not terminate within ${timeoutMs}ms (${inputs.length} input(s)); ` +
            `first: ${JSON.stringify(inputs[0]?.slice(0, 80))}`,
        ),
      );
    }, timeoutMs);
    worker.once("message", (message) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!message.ok) reject(new Error(message.error));
      else resolve(message.results as TokenizeResult[]);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Highlight one command and assert it both terminates and loses no characters. */
async function highlight(input: string): Promise<TokenizeResult> {
  const [result] = await tokenize([input]);
  assert.equal(result.text, input, "tokenizer must not drop or rewrite characters");
  return result;
}

// Inputs that spun forever before the fix. The first four are the reported
// shapes; `\r` is the second dead end (same bug class: a word-break character
// with no handling branch).
const REGRESSIONS: Array<[string, string]> = [
  ["# right after a colon", "echo fill:#242f60"],
  ["# between letters", "echo repro-a#b"],
  ["# in a sed replacement", "sed s/a#b/c/"],
  ["# in a URL fragment", "curl https://example.test/page#fragment"],
  ["bare carriage return", "echo a\rb"],
  ["non-breaking space", "echo a\u00a0b"],
  [
    "heredoc with a hex colour (the 2026-09-18 freeze)",
    "cat > render.mjs <<'EOF'\nconst out = svg.replace(/fill:#242f60/gi, `fill:${color}`);\nEOF",
  ],
];

for (const [label, input] of REGRESSIONS) {
  test(`terminates on ${label}`, async () => {
    await highlight(input);
  });
}

test("mid-word # stays inside the word", async () => {
  // A `#` treated as a word break would split `1#2` and color `1` as a number.
  const { tokens } = await highlight("echo 1#2");
  assert.deepEqual(
    tokens.map(([token]) => token),
    ["syntaxFunction"],
    "`1#2` must be one plain word, not a number followed by a stray break",
  );
});

test("a real comment still colorizes", async () => {
  const { tokens } = await highlight("# note\necho hi # trailing");
  const comments = tokens.filter(([token]) => token === "syntaxComment").map(([, text]) => text);
  assert.deepEqual(comments, ["# note", "# trailing"]);
});

test("a quoted # still colorizes as a string", async () => {
  const { tokens } = await highlight('grep -n "^#" file');
  const strings = tokens.filter(([token]) => token === "syntaxString");
  assert.ok(
    strings.some(([, text]) => text.includes("#")),
    "the quoted # belongs to the string token",
  );
});

test("randomized inputs terminate and are lossless", async () => {
  // Seeded so a failure is reproducible.
  let seed = 987654321;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ALPHABET = [
    ..."abcXYZ019#:'\"`$|&;<>(){}[]\\-./=+*,!@%^~_",
    "\n", "\r", "\t", " ", "\u00a0", "\u000b", "\u000c",
  ];
  const inputs = Array.from({ length: 400 }, () =>
    Array.from({ length: 1 + Math.floor(random() * 90) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join(""),
  );
  const results = await tokenize(inputs, 10000);
  assert.equal(results.length, inputs.length);
  for (const [index, result] of results.entries()) {
    assert.equal(result.text, inputs[index], `lossy output for input #${index}: ${JSON.stringify(inputs[index])}`);
  }
});
