import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalFileWorkspaceOperationLogStore } from "./workspace-operation-log-store.js";
import {
  createWorkspaceOperationByteRangeScanner,
  createWorkspaceOperationUrlStreamRedactor,
  maskWorkspaceOperationUrlUserInfoBytes,
  redactTruncatedWorkspaceOperationOutput,
  redactWorkspaceOperationExcerpt,
  redactWorkspaceOperationUrlUserInfo,
} from "./workspace-operation-url-redaction.js";

describe("workspace operation URL redaction", () => {
  it("masks userinfo even when the scheme and credential arrive in separate chunks", () => {
    const redactor = createWorkspaceOperationUrlStreamRedactor();
    const output = [
      redactor.push("connected to post"),
      redactor.push("gresql://synthetic-user:sy"),
      redactor.push("nthetic-password@db.example.test:5432/app and done"),
      redactor.flush(),
    ].join("");
    expect(output).toContain("postgresql://[REDACTED]@db.example.test:5432/app");
    expect(output).not.toContain("synthetic-user");
    expect(output).not.toContain("synthetic-password");
    expect(redactWorkspaceOperationUrlUserInfo("postgres://reader:one@db.test/app"))
      .toBe("postgres://[REDACTED]@db.test/app");
    expect(redactWorkspaceOperationExcerpt("the tail synthetic-password@db.test/app"))
      .toContain("[REDACTED]@db.test/app");
    expect(redactWorkspaceOperationExcerpt("the tail synthetic-password@db.test/app"))
      .not.toContain("synthetic-password");
  });

  it("masks an unfinished URL when a stream ends before the @", () => {
    const redactor = createWorkspaceOperationUrlStreamRedactor();
    const output = redactor.push("connect post")
      + redactor.push("gresql://synthetic-user:synthetic-password")
      + redactor.flush();
    expect(output).toBe("connect postgresql://[REDACTED]");
  });

  it("accepts an apostrophe inside userinfo and hostless PostgreSQL excerpts", () => {
    const credential = "synthetic-reader:it's-a-password";
    const url = `postgresql://${credential}@db.example.test/app`;
    const redactor = createWorkspaceOperationUrlStreamRedactor();
    const output = redactor.push(`connect ${url}`) + redactor.flush();
    expect(output).toBe("connect postgresql://[REDACTED]@db.example.test/app");
    expect(redactWorkspaceOperationUrlUserInfo(url)).toBe("postgresql://[REDACTED]@db.example.test/app");
    for (const hostAndPath of ["/app", "?host=db.example.test/app"]) {
      expect(redactWorkspaceOperationExcerpt(`word tail'password@${hostAndPath}`))
        .toContain(`[REDACTED]@${hostAndPath}`);
      expect(redactWorkspaceOperationExcerpt(`word tail'password@${hostAndPath}`))
        .not.toContain("tail'password");
    }
  });

  it("masks URL-parser userinfo containing raw delimiters across all redactors", () => {
    for (const [credential, splitAt] of [
      ["synthetic-reader:pa@ssword", "synthetic-reader:pa@"],
      ['synthetic-reader:pa"ssword', "synthetic-reader:pa"],
      ["synthetic-reader:pa\\ssword", "synthetic-reader:pa\\"],
      ["synthetic-reader:pa<ssword", "synthetic-reader:pa<"],
      ["synthetic-reader:pa>ssword", "synthetic-reader:pa>"],
      ["synthetic-reader:pa ssword", "synthetic-reader:pa "],
      ["synthetic-reader:pa\tssword", "synthetic-reader:pa\t"],
      ["synthetic-reader:pa\nssword", "synthetic-reader:pa\n"],
    ]) {
      const url = `postgres://${credential}@db.example.test/app`;
      expect(new URL(url).hostname).toBe("db.example.test");
      const redactor = createWorkspaceOperationUrlStreamRedactor();
      const output = redactor.push(`connect postgres://${splitAt}`)
        + redactor.push(`${credential.slice(splitAt.length)}@db.example.test/app`)
        + redactor.flush();
      expect(output).toBe("connect postgres://[REDACTED]@db.example.test/app");
      expect(redactWorkspaceOperationUrlUserInfo(url)).toBe("postgres://[REDACTED]@db.example.test/app");
      expect(redactWorkspaceOperationExcerpt(`tail ${credential}@db.example.test/app`))
        .toContain("[REDACTED]@db.example.test/app");
      expect(redactWorkspaceOperationExcerpt(`tail ${credential}@db.example.test/app`))
        .not.toContain(credential);

      const raw = Buffer.from(JSON.stringify({ chunk: url }));
      const expected = Buffer.from(raw);
      const start = raw.indexOf("postgres://") + "postgres://".length;
      const hostSeparator = raw.indexOf("@db.example.test");
      expect(start).toBeGreaterThan(0);
      expect(hostSeparator).toBeGreaterThan(start);
      expected.fill(0x2a, start, hostSeparator);
      expect(maskWorkspaceOperationUrlUserInfoBytes(raw)).toEqual(expected);
    }
  });

  it("keeps an escaped quote together when it crosses the byte scanner's internal part boundary", () => {
    const prefix = "postgres://synthetic-reader:";
    const url = prefix + "a".repeat(8191 - prefix.length) + '"secret@db.example.test/app';
    const rawChunk = JSON.stringify(url).slice(1, -1);
    expect(rawChunk.charAt(8191)).toBe("\\");
    expect(rawChunk.charAt(8192)).toBe('"');
    const scanner = createWorkspaceOperationByteRangeScanner();
    scanner.feed("stdout", rawChunk, 0);
    const masked = Buffer.from(rawChunk);
    for (const range of scanner.finish()) masked.fill(0x2a, range.start, range.end);
    const expected = Buffer.from(rawChunk);
    expected.fill(0x2a, "postgres://".length, rawChunk.indexOf("@db.example.test"));
    expect(masked).toEqual(expected);
  });

  it("hides the first uncertain token of a truncated process capture", () => {
    for (const tail of ['thetic@pa"ssword@db.example.test/app', 'thetic"pa@ssword@db.example.test/app']) {
      const capturedWithSymbols = "[output truncated to last 262144 bytes; total 262200 bytes]\n" + tail;
      expect(redactTruncatedWorkspaceOperationOutput(capturedWithSymbols))
        .toContain("\n[REDACTED]@db.example.test/app");
    }
    const captured = "[output truncated to last 262144 bytes; total 262200 bytes]\n"
      + "thetic'password@db.example.test/app complete";
    expect(redactTruncatedWorkspaceOperationOutput(captured))
      .toContain("\n[REDACTED]@db.example.test/app complete");
    expect(redactWorkspaceOperationExcerpt(captured))
      .toContain("\n[REDACTED]@db.example.test/app complete");
    expect(redactTruncatedWorkspaceOperationOutput(captured)).not.toContain("thetic'password");
  });

  it("masks UTF-8 userinfo bytes in a complete metadata URL without moving offsets", () => {
    const credential = "synthetic-reader:paàssword";
    const input = Buffer.from('{"metadata":"postgresql://' + credential + '@db.example.test/app"}');
    const expected = Buffer.from(input);
    const start = input.indexOf(credential);
    expect(start).toBeGreaterThan(0);
    expected.fill(0x2a, start, start + Buffer.byteLength(credential));
    expect(maskWorkspaceOperationUrlUserInfoBytes(input)).toEqual(expected);
    expect(input.includes(Buffer.from(credential))).toBe(true);
  });

  describe("historical byte-range pages", () => {
    let logRoot: string;
    beforeAll(async () => {
      logRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-operation-url-redaction-"));
    });
    afterAll(async () => {
      await fs.rm(logRoot, { recursive: true, force: true });
    });

    it("masks every page across a credential and leaves the forensic file unchanged", async () => {
      const store = createLocalFileWorkspaceOperationLogStore(logRoot);
      const handle = await store.begin({ companyId: randomUUID(), operationId: randomUUID() });
      const credential = "synthetic-reader:synthetic-password";
      await store.append(handle, {
        stream: "stdout",
        chunk: `before postgres://${credential}@db.example.test/app after`,
        ts: new Date().toISOString(),
      });
      const filePath = path.join(logRoot, handle.logRef);
      const original = await fs.readFile(filePath);
      const userinfoStart = original.indexOf(credential);
      expect(userinfoStart).toBeGreaterThan(0);
      const expected = Buffer.from(original);
      expected.fill(0x2a, userinfoStart, userinfoStart + credential.length);

      let offset = 0;
      while (offset < original.length) {
        const page = await store.read(handle, { offset, limitBytes: 7 });
        const nextOffset = page.nextOffset ?? original.length;
        expect(page.content).toBe(expected.subarray(offset, nextOffset).toString("utf8"));
        offset = nextOffset;
      }
      expect(await fs.readFile(filePath)).toEqual(original);
    });

    it("masks a historical URL whose userinfo spans two NDJSON events", async () => {
      const store = createLocalFileWorkspaceOperationLogStore(logRoot);
      const handle = await store.begin({ companyId: randomUUID(), operationId: randomUUID() });
      const first = "synthetic-reader:pa";
      const second = "àssword";
      const ts = new Date().toISOString();
      await store.append(handle, { stream: "stdout", chunk: `postgres://${first}`, ts });
      await store.append(handle, { stream: "stderr", chunk: "unrelated output", ts });
      await store.append(handle, { stream: "stdout", chunk: `${second}@db.example.test/app`, ts });
      const filePath = path.join(logRoot, handle.logRef);
      const original = await fs.readFile(filePath);
      const expected = Buffer.from(original);
      const firstAt = original.indexOf(first);
      const secondAt = original.indexOf(second);
      expect(firstAt).toBeGreaterThan(0);
      expect(secondAt).toBeGreaterThan(firstAt);
      expected.fill(0x2a, firstAt, firstAt + first.length);
      expected.fill(0x2a, secondAt, secondAt + Buffer.byteLength(second));

      let offset = 0;
      while (offset < original.length) {
        const page = await store.read(handle, { offset, limitBytes: 9 });
        const nextOffset = page.nextOffset ?? original.length;
        expect(page.content).toBe(expected.subarray(offset, nextOffset).toString("utf8"));
        offset = nextOffset;
      }
      expect(await fs.readFile(filePath)).toEqual(original);
    });

    it("masks raw @ and escaped quote across historical NDJSON events and byte pages", async () => {
      for (const [first, second] of [
        ["synthetic-reader:pa@", "ssword"],
        ["synthetic-reader:pa", '"ssword'],
      ]) {
        const store = createLocalFileWorkspaceOperationLogStore(logRoot);
        const handle = await store.begin({ companyId: randomUUID(), operationId: randomUUID() });
        const ts = new Date().toISOString();
        await store.append(handle, { stream: "stdout", chunk: `postgres://${first}`, ts });
        await store.append(handle, { stream: "stdout", chunk: `${second}@db.example.test/app`, ts });
        const filePath = path.join(logRoot, handle.logRef);
        const original = await fs.readFile(filePath);
        const expected = Buffer.from(original);
        const escapedSecond = JSON.stringify(second).slice(1, -1);
        const firstAt = original.indexOf(first);
        const secondAt = original.indexOf(escapedSecond);
        expect(firstAt).toBeGreaterThan(0);
        expect(secondAt).toBeGreaterThan(firstAt);
        expected.fill(0x2a, firstAt, firstAt + Buffer.byteLength(first));
        expected.fill(0x2a, secondAt, secondAt + Buffer.byteLength(escapedSecond));

        let offset = 0;
        while (offset < original.length) {
          const page = await store.read(handle, { offset, limitBytes: 7 });
          const nextOffset = page.nextOffset ?? original.length;
          expect(page.content).toBe(expected.subarray(offset, nextOffset).toString("utf8"));
          offset = nextOffset;
        }
        expect(await fs.readFile(filePath)).toEqual(original);
      }
    });

    it("hides a damaged event and the remaining log when it may complete split userinfo", async () => {
      const store = createLocalFileWorkspaceOperationLogStore(logRoot);
      const handle = await store.begin({ companyId: randomUUID(), operationId: randomUUID() });
      const first = "synthetic-reader:synthetic-";
      const second = "password";
      const ts = new Date().toISOString();
      await store.append(handle, { stream: "stdout", chunk: `postgres://${first}`, ts });
      await store.append(handle, { stream: "stdout", chunk: `${second}@db.example.test/app`, ts });
      await store.append(handle, { stream: "stdout", chunk: "later record", ts });
      const filePath = path.join(logRoot, handle.logRef);
      const intact = await fs.readFile(filePath, "utf8");
      const damaged = intact.replace('"chunk":"password@', '"shunk":"password@');
      expect(damaged).not.toBe(intact);
      await fs.writeFile(filePath, damaged);
      const original = await fs.readFile(filePath);
      const expected = Buffer.from(original);
      const firstAt = original.indexOf(first);
      const damagedAt = original.indexOf(0x0a) + 1;
      expected.fill(0x2a, firstAt, firstAt + first.length);
      expected.fill(0x2a, damagedAt);

      let offset = 0;
      while (offset < original.length) {
        const page = await store.read(handle, { offset, limitBytes: 7 });
        const nextOffset = page.nextOffset ?? original.length;
        expect(page.content).toBe(expected.subarray(offset, nextOffset).toString("utf8"));
        offset = nextOffset;
      }
      expect(await fs.readFile(filePath)).toEqual(original);
    });

    it("masks apostrophes and a capture truncated inside userinfo without changing byte offsets", async () => {
      const store = createLocalFileWorkspaceOperationLogStore(logRoot);
      const handle = await store.begin({ companyId: randomUUID(), operationId: randomUUID() });
      const apostropheCredential = "synthetic-reader:it's-a-password";
      const truncatedCredential = "thetic'paàssword";
      await store.append(handle, {
        stream: "stdout",
        chunk: `postgresql://${apostropheCredential}@db.example.test/app`,
        ts: new Date().toISOString(),
      });
      await store.append(handle, {
        stream: "stdout",
        chunk: `[output truncated to last 262144 bytes; total 262200 bytes]\n${truncatedCredential}@db.example.test/app`,
        ts: new Date().toISOString(),
      });
      const filePath = path.join(logRoot, handle.logRef);
      const original = await fs.readFile(filePath);
      const expected = Buffer.from(original);
      for (const credential of [apostropheCredential, truncatedCredential]) {
        const offset = original.indexOf(credential);
        expect(offset).toBeGreaterThan(0);
        expected.fill(0x2a, offset, offset + Buffer.byteLength(credential));
      }
      let offset = 0;
      while (offset < original.length) {
        const page = await store.read(handle, { offset, limitBytes: 7 });
        const nextOffset = page.nextOffset ?? original.length;
        expect(page.content).toBe(expected.subarray(offset, nextOffset).toString("utf8"));
        offset = nextOffset;
      }
      expect(await fs.readFile(filePath)).toEqual(original);
    });
  });
});
