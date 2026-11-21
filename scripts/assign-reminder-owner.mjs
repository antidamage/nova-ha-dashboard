#!/usr/bin/env node
// Moves existing reminders under one home user (specs/private-reminders.md, section 8).
//
//   node scripts/assign-reminder-owner.mjs --base <dashboard url> --name <person> --dry-run
//   node scripts/assign-reminder-owner.mjs --base <dashboard url> --name <person> --backup <file>
//
// It is a system caller: it reads every reminder and writes `owner` onto the ones
// that have none. It names no household value; the dashboard address and the
// person come from the command line. Safe to repeat: a reminder that already has
// an owner is left alone.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** A washing reminder is household by rule and never takes an owner. */
export function isWashReminder(task) {
  const wash = task?.moduleData?.["washing-machine"];
  return Boolean(wash && typeof wash.sessionId === "string" && (wash.phase === "waiting" || wash.phase === "active"));
}

/**
 * The reminders to move to `ownerId`: those with no owner that are not household
 * or washing, and are local (a mirrored reminder is read-only and is reported, not
 * moved). With `reclaim`, also those whose owner is no longer a home user.
 */
export function selectReminders(tasks, userIds, { reclaim = false } = {}) {
  const ids = new Set(userIds);
  const move = [];
  const skippedMirrored = [];
  for (const task of tasks) {
    if (task.household === true || isWashReminder(task)) continue;
    const orphaned = Boolean(task.owner) && !ids.has(task.owner);
    if (task.owner && !(reclaim && orphaned)) continue;
    if (task.readOnly || (task.source && task.source !== "local")) {
      skippedMirrored.push(task);
      continue;
    }
    move.push(task);
  }
  return { move, skippedMirrored };
}

export function findUser(users, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  return users.find((user) => String(user.label ?? "").trim().toLowerCase() === wanted || user.id === name) ?? null;
}

function argsFrom(argv) {
  const out = { dryRun: false, reclaim: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") out.dryRun = true;
    else if (flag === "--reclaim") out.reclaim = true;
    else if (flag === "--base") out.base = argv[++i];
    else if (flag === "--name") out.name = argv[++i];
    else if (flag === "--backup") out.backup = argv[++i];
  }
  return out;
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (!args.base || !args.name || (!args.dryRun && !args.backup)) {
    console.error("usage: assign-reminder-owner.mjs --base <url> --name <person> (--dry-run | --backup <file>) [--reclaim]");
    process.exit(2);
  }
  const base = args.base.replace(/\/+$/, "");
  const system = { "x-nova-viewer": "system" };
  const usersResponse = await fetch(`${base}/api/home-users`);
  if (!usersResponse.ok) throw new Error(`home-users: ${usersResponse.status}`);
  const { users } = await usersResponse.json();
  const owner = findUser(users, args.name);
  if (!owner) throw new Error(`No home user named "${args.name}"`);

  const listResponse = await fetch(`${base}/api/tasks?command=list`, { headers: system });
  if (!listResponse.ok) throw new Error(`task list: ${listResponse.status}`);
  const { tasks } = await listResponse.json();
  const { move, skippedMirrored } = selectReminders(tasks, users.map((user) => user.id), { reclaim: args.reclaim });

  console.log(`${tasks.length} reminders, ${move.length} to move to ${owner.label}, ${skippedMirrored.length} mirrored left alone`);
  if (args.dryRun) {
    for (const task of move) console.log(`  would move ${task.id}  ${task.name}`);
    return;
  }
  await writeFile(args.backup, `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
  console.log(`backup of the full list written to ${args.backup}`);
  let moved = 0;
  for (const task of move) {
    const response = await fetch(`${base}/api/tasks?command=update`, {
      method: "POST",
      headers: { ...system, "content-type": "application/json" },
      body: JSON.stringify({ id: task.id, owner: owner.id }),
    });
    if (!response.ok) {
      console.error(`  FAILED ${task.id} ${task.name}: ${response.status} ${await response.text()}`);
      continue;
    }
    moved += 1;
    console.log(`  moved ${task.id}  ${task.name}`);
  }
  console.log(`moved ${moved} of ${move.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}