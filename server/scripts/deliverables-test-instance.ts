/** HOST ONLY. Restores a backup into a brand-new, fixed isolated home. Never starts the app. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, ensurePostgresDatabase, runDatabaseRestore } from "../../packages/db/src/index.js";
import { paperclipConfigSchema } from "../../packages/shared/src/config-schema.js";
import { ensureEmbeddedPostgres, quarantineSeededWorktreeExecutionState, pauseSeededScheduledRoutines, rebindWorkspaceCwd } from "../../cli/src/commands/worktree.js";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const home = "/Volumes/AI-Models/pantheon-wt/deliverables-home";
const instance = path.join(home, "instances/default");
const backups = "/Volumes/AI-Models/paperclip/data/instances/default/data/backups";
assert.equal(process.env.PAPERCLIP_HOME, home, "Run with the documented clean environment");
assert.equal(process.env.PAPERCLIP_CONFIG, undefined);
assert.equal(process.env.DATABASE_URL, undefined);
assert.notEqual(checkout, "/Volumes/AI-Models/pantheon-app");
// Refuse reuse, symlink homes, or replacement of any existing instance.
await fs.mkdir(home);
const candidates = await Promise.all((await fs.readdir(backups, { recursive: true })).filter(name => /\.sql(?:\.gz)?$/.test(name)).map(async name => {
  const file = path.join(backups, name); return { file, mtime: (await fs.stat(file)).mtimeMs };
}));
const backup = candidates.sort((a, b) => b.mtime - a.mtime)[0];
assert(backup, "No SQL backup found");
await fs.mkdir(instance, { recursive: true });
const config = paperclipConfigSchema.parse({
  $meta: { version: 1, updatedAt: new Date().toISOString(), source: "configure" },
  database: { mode: "embedded-postgres", embeddedPostgresDataDir: path.join(instance, "db"), embeddedPostgresPort: 54339,
    backup: { enabled: false, dir: path.join(instance, "data/backups") } },
  logging: { mode: "file", logDir: path.join(instance, "logs") },
  server: { deploymentMode: "local_trusted", host: "127.0.0.1", port: 3300, serveUi: true },
  storage: { provider: "local_disk", localDisk: { baseDir: path.join(instance, "data/storage") } },
  secrets: { provider: "local_encrypted", localEncrypted: { keyFilePath: path.join(instance, "secrets/master.key") } },
  telemetry: { enabled: false }, updates: { checkEnabled: false },
});
for (const location of [config.database.embeddedPostgresDataDir, config.logging.logDir, config.storage.localDisk.baseDir, config.secrets.localEncrypted.keyFilePath]) {
  assert(location.startsWith(`${home}/`));
}
const handle = await ensureEmbeddedPostgres(config.database.embeddedPostgresDataDir, 54339, { allowExisting: false });
const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${handle.port}/paperclip`;
config.database.embeddedPostgresPort = handle.port;
let db: ReturnType<typeof createDb> | undefined;
try {
  await ensurePostgresDatabase(`postgres://paperclip:paperclip@127.0.0.1:${handle.port}/postgres`, "paperclip");
  await runDatabaseRestore({ connectionString, backupFile: backup.file });
  await applyPendingMigrations(connectionString);
  console.log(await quarantineSeededWorktreeExecutionState(connectionString));
  await pauseSeededScheduledRoutines(connectionString);
  db = createDb(connectionString);
  await db.execute(sql`
    update companies set status = 'paused';
    update agents set status = 'paused', runtime_config = jsonb_set(coalesce(runtime_config, '{}'), '{heartbeat}', '{"enabled":false,"wakeOnDemand":false}'::jsonb);
    update routines set status = 'paused';
    update routine_triggers set enabled = false;
    update heartbeat_runs set status = 'cancelled', finished_at = now() where status in ('queued','running');
    update agent_wakeup_requests set status = 'cancelled', finished_at = now() where status in ('queued','claimed');
    update environment_leases set status = 'released', released_at = now(), provider = null,
      provider_lease_id = null, cleanup_status = null, metadata = '{}';
    update tool_runtime_slots set status = 'stopped', process_id = null, provider_ref = null,
      stopped_at = now(), idle_expires_at = null, idle_deadline_at = null, metadata = '{}';
    update heartbeat_runs set process_pid = null;
    update native_run_finalizations set controller_pid = null;
    update tool_connections set enabled = false;
    update chat_endpoints set status = 'paused';
    update plugins set status = 'disabled';
    update workspace_runtime_services set exposure = null, exposure_handle = null, backend_url = null;
    create function deliverables_test_no_runs() returns trigger language plpgsql as $$
    begin
      if NEW.status in ('queued', 'running', 'claimed') then
        raise exception 'Deliverables test quarantine blocks agent execution';
      end if;
      return NEW;
    end $$;
    create trigger deliverables_test_no_runs before insert or update on heartbeat_runs
      for each row execute function deliverables_test_no_runs();
    create trigger deliverables_test_no_wakes before insert or update on agent_wakeup_requests
      for each row execute function deliverables_test_no_runs();
  `);
  const workspaces = await db.execute<{ id: string; cwd: string | null }>(sql`select id, cwd from project_workspaces`);
  for (const workspace of workspaces) {
    if (!workspace.cwd) continue;
    const rebound = rebindWorkspaceCwd({ sourceRepoRoot: "/Volumes/AI-Models/pantheon-app", targetRepoRoot: checkout, workspaceCwd: workspace.cwd });
    if (rebound) await db.execute(sql`update project_workspaces set cwd = ${rebound} where id = ${workspace.id}`);
  }
  // Exercise the database guard, even if an API admission gate were accidentally bypassed.
  const [agent] = await db.execute<{ id: string; company_id: string }>(sql`select id, company_id from agents limit 1`);
  assert(agent, "Copied company must contain an agent for the no-run proof");
  await assert.rejects(async () => await db!.execute(sql`insert into heartbeat_runs(company_id, agent_id, status, invocation_source)
    values (${agent.company_id}, ${agent.id}, 'queued', 'on_demand')`), (err: unknown) => {
    const error = err as { cause?: { message?: string }; message?: string };
    return /Deliverables test quarantine blocks agent execution/.test(error?.cause?.message ?? error?.message ?? "");
  });
  const [counts] = await db.execute(sql`select
    (select count(*) from agents where status <> 'paused')::int as active_agents,
    (select count(*) from heartbeat_runs where status in ('running','queued'))::int as active_runs,
    (select count(*) from routine_triggers where enabled)::int as enabled_triggers,
    (select count(*) from tool_connections where enabled)::int as enabled_connections,
    (select count(*) from workspace_runtime_services where status <> 'stopped')::int as active_services`);
  assert(Object.values(counts).every(n => n === 0));
  console.log({ quarantine: counts, noRunGuard: "PASS", backup: backup.file });
  await fs.mkdir(config.storage.localDisk.baseDir, { recursive: true });
  // Copy bytes, never symlink to live storage. Credentials and workspace trees are not copied.
  await fs.cp("/Volumes/AI-Models/paperclip/data/instances/default/data/storage", config.storage.localDisk.baseDir, { recursive: true, dereference: true });
  await fs.writeFile(path.join(instance, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log({ home, config: path.join(instance, "config.json"), database: config.database, storage: config.storage.localDisk, server: config.server });
} finally {
  await db?.$client.end({ timeout: 5 });
  await handle.stop();
}
