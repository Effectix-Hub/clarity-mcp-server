import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CLARITY_CREDENTIALS_DIR } from "../config.js";
const KEYRING_SERVICE = "microsoft-clarity-mcp";
const KEYRING_ACCOUNT = "oauth-session";
// Kept apart from the sign-in because a credential is size-limited (1280 characters on Windows): the access token's size
// is set by the service (signing key, claims), so it must not be able to crowd out the refresh token.
const KEYRING_ACCESS_TOKEN_ACCOUNT = "oauth-access-token";
/**
 * Keeps credentials in memory for a single server process.
 *
 * Values are retained and returned by reference without serialization or
 * validation. Used when the OS credential store is unavailable.
 */
export class MemoryCredentialStore {
    /** In-memory credentials are not retained after the server process exits. */
    persistent = false;
    session = null;
    accessToken = null;
    /** {@inheritDoc ICredentialStore.load} */
    async load() {
        return this.session;
    }
    /** {@inheritDoc ICredentialStore.save} */
    async save(session) {
        this.session = session;
    }
    /** {@inheritDoc ICredentialStore.loadAccessToken} */
    async loadAccessToken() {
        return this.accessToken;
    }
    /** {@inheritDoc ICredentialStore.saveAccessToken} */
    async saveAccessToken(token) {
        this.accessToken = token;
    }
    /** {@inheritDoc ICredentialStore.clear} */
    async clear() {
        this.session = null;
        this.accessToken = null;
    }
}
/**
 * Persists JSON-serialized credentials in separate OS credential-store entries.
 *
 * Read and write failures propagate to the caller. Invalid stored JSON or record
 * shapes are treated as missing credentials.
 */
export class KeyringCredentialStore {
    entry;
    accessTokenEntry;
    /** Credentials are persisted by the OS credential store. */
    persistent = true;
    /**
     * @param entry - The credential-store entry containing the sign-in.
     * @param accessTokenEntry - The separate entry containing the access token.
     */
    constructor(entry, accessTokenEntry) {
        this.entry = entry;
        this.accessTokenEntry = accessTokenEntry;
    }
    /** {@inheritDoc ICredentialStore.load} */
    async load() {
        const value = await this.entry.getPassword();
        return value ? parseSession(value) : null;
    }
    /** {@inheritDoc ICredentialStore.save} */
    async save(session) {
        await this.entry.setPassword(JSON.stringify(session));
    }
    /** {@inheritDoc ICredentialStore.loadAccessToken} */
    async loadAccessToken() {
        const value = await this.accessTokenEntry.getPassword();
        return value ? parseAccessToken(value) : null;
    }
    /** {@inheritDoc ICredentialStore.saveAccessToken} */
    async saveAccessToken(token) {
        await this.accessTokenEntry.setPassword(JSON.stringify(token));
    }
    /**
     * Deletes the access-token entry before deleting the sign-in entry.
     *
     * Access-token deletion errors are ignored; sign-in deletion errors propagate.
     */
    async clear() {
        // The access token may never have been saved, so a missing entry is not an error.
        await this.accessTokenEntry.deletePassword().catch(() => undefined);
        await this.entry.deletePassword();
    }
}
/**
 * Persists JSON-serialized credentials as two files in one directory.
 *
 * For hosts without an OS credential store, such as containers and servers. Files are
 * written with mode 0600 and replaced atomically, so a reader never sees a partial file.
 * Read and write failures other than a missing file propagate to the caller. Invalid
 * stored JSON or record shapes are treated as missing credentials.
 */
export class FileCredentialStore {
    /** Credentials are persisted in files. */
    persistent = true;
    sessionPath;
    accessTokenPath;
    /**
     * @param directory - The directory that holds the sign-in and access-token files.
     */
    constructor(directory) {
        this.sessionPath = join(directory, "session.json");
        this.accessTokenPath = join(directory, "access-token.json");
    }
    /** {@inheritDoc ICredentialStore.load} */
    async load() {
        const value = await readIfExists(this.sessionPath);
        return value ? parseSession(value) : null;
    }
    /** {@inheritDoc ICredentialStore.save} */
    async save(session) {
        await writeAtomically(this.sessionPath, JSON.stringify(session));
    }
    /** {@inheritDoc ICredentialStore.loadAccessToken} */
    async loadAccessToken() {
        const value = await readIfExists(this.accessTokenPath);
        return value ? parseAccessToken(value) : null;
    }
    /** {@inheritDoc ICredentialStore.saveAccessToken} */
    async saveAccessToken(token) {
        await writeAtomically(this.accessTokenPath, JSON.stringify(token));
    }
    /** Deletes the access-token file before the sign-in file; missing files are not an error. */
    async clear() {
        await rm(this.accessTokenPath, { force: true });
        await rm(this.sessionPath, { force: true });
    }
}
/**
 * Reads a UTF-8 file.
 *
 * @returns The file content, or `null` when the file does not exist.
 */
async function readIfExists(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
/**
 * Writes a file readable only by its owner, replacing any existing file in one rename.
 */
async function writeAtomically(path, data) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, data, { mode: 0o600 });
    try {
        await rename(temporaryPath, path);
    }
    catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
    }
}
/**
 * Parses a stored access token and validates its required fields.
 *
 * @param value - The JSON read from the access-token entry.
 * @returns A token with a string session ID, non-empty token value, and finite
 * numeric expiration, or `null` for invalid JSON or fields. Does not check expiry.
 */
function parseAccessToken(value) {
    try {
        const token = JSON.parse(value);
        if (typeof token?.sessionId !== "string" || typeof token.value !== "string" || !token.value) {
            return null;
        }
        if (typeof token.expiresAtMs !== "number" || !Number.isFinite(token.expiresAtMs)) {
            return null;
        }
        return {
            sessionId: token.sessionId,
            value: token.value,
            expiresAtMs: token.expiresAtMs
        };
    }
    catch {
        return null;
    }
}
/**
 * Parses a stored sign-in, retaining only supported fields.
 *
 * Requires a non-empty refresh token, defaults a missing or invalid session ID
 * to an empty string, and omits an empty or invalid selected project ID.
 *
 * @param value - The JSON read from the sign-in entry.
 * @returns The normalized sign-in, or `null` for invalid JSON or a missing or
 * invalid refresh token.
 */
function parseSession(value) {
    try {
        const session = JSON.parse(value);
        if (typeof session?.refreshToken !== "string" || !session.refreshToken) {
            return null;
        }
        const sessionId = typeof session.sessionId === "string" ? session.sessionId : "";
        const selectedProjectId = typeof session.selectedProjectId === "string" && session.selectedProjectId ? session.selectedProjectId : undefined;
        return {
            sessionId: sessionId,
            refreshToken: session.refreshToken,
            selectedProjectId: selectedProjectId,
        };
    }
    catch {
        return null;
    }
}
/**
 * Creates the credential store for the sign-in.
 *
 * When a credentials directory is configured (`--clarity_credentials_dir` or
 * `CLARITY_CREDENTIALS_DIR`), returns a file-backed store in that directory and creates
 * the directory if needed. Otherwise creates an OS-backed store, falling back to
 * process-local memory.
 *
 * Loads the native keyring module on demand and probes the sign-in entry to check
 * availability. If initialization or the probe fails, logs the failure and
 * returns an in-memory store. Later operations on an OS-backed store do not
 * automatically fall back to memory.
 *
 * @param origin - The Clarity service origin used to namespace both credential
 * entries and keep credentials for different service origins separate.
 * @param credentialsDirectory - The configured credentials directory, if any.
 * @returns A file-backed store when a directory is configured, an OS-backed store when
 * initialization succeeds, otherwise a non-persistent in-memory store.
 */
export async function createCredentialStore(origin, credentialsDirectory = CLARITY_CREDENTIALS_DIR) {
    if (credentialsDirectory) {
        await mkdir(credentialsDirectory, { recursive: true, mode: 0o700 });
        return new FileCredentialStore(credentialsDirectory);
    }
    try {
        // Loaded on demand: the native binary may be missing for this platform (e.g. a bundle built on another OS), which
        // must not stop the server, so existing Data Export token users are unaffected.
        const { AsyncEntry } = await import("@napi-rs/keyring");
        const entry = new AsyncEntry(KEYRING_SERVICE, `${KEYRING_ACCOUNT}:${origin}`);
        // A read proves the secret service is reachable; a missing entry is not an error.
        await entry.getPassword();
        return new KeyringCredentialStore(entry, new AsyncEntry(KEYRING_SERVICE, `${KEYRING_ACCESS_TOKEN_ACCOUNT}:${origin}`));
    }
    catch (error) {
        console.error("OS credential store unavailable; the Clarity sign-in will only last until the server stops:", error);
        return new MemoryCredentialStore();
    }
}
