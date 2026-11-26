import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCredentialStore, FileCredentialStore } from "../dist/auth/credentialStore.js";

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "clarity-credentials-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("an empty directory has no sign-in and no access token", () => withDirectory(async (directory) => {
  const store = new FileCredentialStore(directory);
  assert.equal(store.persistent, true);
  assert.equal(await store.load(), null);
  assert.equal(await store.loadAccessToken(), null);
}));

test("the sign-in and access token round-trip in separate owner-only files", () => withDirectory(async (directory) => {
  const store = new FileCredentialStore(directory);
  await store.save({ sessionId: "s1", refreshToken: "r1", selectedProjectId: "p1" });
  await store.saveAccessToken({ sessionId: "s1", value: "a1", expiresAtMs: 123 });

  const reopened = new FileCredentialStore(directory);
  assert.deepEqual(await reopened.load(), { sessionId: "s1", refreshToken: "r1", selectedProjectId: "p1" });
  assert.deepEqual(await reopened.loadAccessToken(), { sessionId: "s1", value: "a1", expiresAtMs: 123 });

  assert.deepEqual((await readdir(directory)).sort(), ["access-token.json", "session.json"]);
  for (const name of ["access-token.json", "session.json"]) {
    assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
  }
}));

test("saving the sign-in keeps the access token and replaces the old sign-in", () => withDirectory(async (directory) => {
  const store = new FileCredentialStore(directory);
  await store.saveAccessToken({ sessionId: "s1", value: "a1", expiresAtMs: 1 });
  await store.save({ sessionId: "s1", refreshToken: "r1" });
  await store.save({ sessionId: "s1", refreshToken: "r2" });

  assert.equal((await store.load())?.refreshToken, "r2");
  assert.equal((await store.loadAccessToken())?.value, "a1");
}));

test("invalid stored JSON is treated as a missing sign-in", () => withDirectory(async (directory) => {
  await writeFile(join(directory, "session.json"), "{not json");
  await writeFile(join(directory, "access-token.json"), JSON.stringify({ sessionId: "s1", value: "" }));
  const store = new FileCredentialStore(directory);
  assert.equal(await store.load(), null);
  assert.equal(await store.loadAccessToken(), null);
}));

test("clear removes both files and tolerates missing ones", () => withDirectory(async (directory) => {
  const store = new FileCredentialStore(directory);
  await store.clear();
  await store.save({ sessionId: "s1", refreshToken: "r1" });
  await store.clear();
  assert.deepEqual(await readdir(directory), []);
}));

test("a configured directory selects the file store and is created if missing", () => withDirectory(async (parent) => {
  const directory = join(parent, "nested", "credentials");
  const store = await createCredentialStore("https://clarity.microsoft.com", directory);
  assert.ok(store instanceof FileCredentialStore);
  await store.save({ sessionId: "s1", refreshToken: "r1" });
  assert.equal(JSON.parse(await readFile(join(directory, "session.json"), "utf8")).refreshToken, "r1");
}));
