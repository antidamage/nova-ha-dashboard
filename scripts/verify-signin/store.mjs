/**
 * The result list every check records into, and the final report.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */



/* -------------------------------------------------------------------- checks */

const results = [];

export function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
}

export async function check(name, fn) {
  try {
    const { pass, evidence } = await fn();
    record(name, pass, evidence);
  } catch (err) {
    record(name, false, `threw: ${err.message}`);
  }
}

export function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.evidence}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log("");
  console.log(`${results.length - failed}/${results.length} checks passed.`);
  return failed;
}
