# User-reviewed agent instruction files

Plugins can read and update managed agent text files during an authenticated
human `performAction` invocation. Declare `agents.instructions.read` and, for
updates, `agents.instructions.write` in the manifest.

```ts
const input = { companyId, agentId, path: "AGENTS.md" };
const current = await ctx.agents.instructions.read(input);
const receipt = await ctx.agents.instructions.write({
  ...input,
  content: reviewedContent,
  baseHash: current.contentHash,
});
```

Read returns `path`, UTF-8 `content`, and its SHA-256 `contentHash`. A missing
file returns null content and hash. Write requires the observed hash, or null
when creating a file. A stale hash fails with conflict; it never overwrites a
newer edit. Read again to verify the saved content. Each file is independent;
this is not an atomic multi-file bundle operation.

The host derives the human identity from its active invocation registry. Worker
parameters cannot supply a user identity. Company mismatch, expired invocation,
background jobs, data handlers and agent/system actions cannot use this API.
Every operation rechecks native instruction permissions. Writes retain native
activity attribution, containment, symlink rejection and conditional-write
checks. Writes reject a currently running target agent under the agent row lock.

Only managed files are supported. The API does not migrate external instruction
paths, change the entry file, delete files, modify adapters, install dependencies
or execute scripts. Files are UTF-8 text without NUL bytes, at most 1 MiB each.
Supporting text files use contained paths such as `references/checklist.md`.

Plugins are trusted executable packages, not security sandboxes. A worker sees
its active invocation IDs; this binding is not isolation between malicious code
inside one plugin's concurrent actions. Install only trusted plugins. Keep file
contents out of logs and plugin state unless an explicit product requirement
and retention policy permit storage. This API does not fetch repositories or
provide automatic synchronization; those workflows belong in plugins.

Related runtime lifecycle hooks describe resource changes and runtime access.
This API instead performs explicit user-authorized conditional file writes.
