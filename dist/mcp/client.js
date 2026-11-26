import { getActiveCredential } from "../auth/credentials.js";
import { getDataExportTokenSingleProjectMessage, getNotSignedInMessage, getSignInEndedMessage, } from "../auth/messages.js";
import { CredentialKind } from "../auth/models.js";
import { oauthClient } from "../auth/oauth.js";
import { sendWithOAuth } from "../auth/request.js";
import { CLARITY_API_TOKEN } from "../config.js";
import { describeRequestFailure, SESSION_CHANGED_MESSAGE } from "../projects/service.js";
import { CLARITY_REQUEST_FAILED_MESSAGE, withRequestId } from "./messages.js";
import { textResult } from "./results.js";
/**
 * Calls a Clarity MCP endpoint using the active credentials.
 *
 * A Clarity sign-in takes precedence over a configured Data Export API token.
 * Project overrides apply only to this request, allowing parallel chats to query
 * different projects without changing the stored selection.
 *
 * @param url - The Clarity MCP endpoint URL.
 * @param body - The request payload to serialize as JSON.
 * @param options - Project-targeting options. Defaults to the selected project for OAuth.
 * @returns The response as formatted JSON text, or a message the assistant can
 * relay when credentials are unavailable or the request fails.
 */
export async function callClarityApi(url, body, options = {}) {
    const credential = await getActiveCredential();
    if (credential === CredentialKind.OAuth) {
        return callWithOAuth(url, body, options);
    }
    if (credential === CredentialKind.DataExportToken) {
        return callWithDataExportToken(url, body, CLARITY_API_TOKEN, options);
    }
    return textResult(getNotSignedInMessage(), true);
}
/**
 * Sends a JSON POST request using the current Clarity sign-in.
 *
 * Unless `noProject` is set, an explicit project ID takes precedence over the
 * stored selection. The OAuth sender handles token refresh and a single retry
 * on HTTP 401. An ended sign-in, unsuccessful response, or caught exception
 * produces an error result; caught exceptions are also logged.
 *
 * @param url - The Clarity MCP endpoint URL.
 * @param body - The request payload to serialize as JSON.
 * @param options - Options controlling the project attached to the request.
 * @returns The response as formatted JSON text, or an error message the assistant can relay.
 */
async function callWithOAuth(url, body, options) {
    try {
        const sessionId = await oauthClient.getSessionId();
        if (sessionId === null) {
            return textResult(getSignInEndedMessage(), true);
        }
        const projectId = options.noProject ? undefined : options.projectId ?? (await oauthClient.getSelectedProjectId(sessionId)) ?? undefined;
        const response = await sendWithOAuth(url, body, projectId, sessionId);
        if (!response) {
            return textResult(getSignInEndedMessage(), true);
        }
        if (await oauthClient.getSessionId() !== sessionId) {
            return textResult(withRequestId(response, SESSION_CHANGED_MESSAGE), true);
        }
        if (!response.ok) {
            return textResult(await describeRequestFailure(response, projectId, CredentialKind.OAuth, sessionId), true);
        }
        const data = await response.json();
        if (await oauthClient.getSessionId() !== sessionId) {
            return textResult(withRequestId(response, SESSION_CHANGED_MESSAGE), true);
        }
        return textResult(JSON.stringify(data, null, 2));
    }
    catch (error) {
        console.error("Microsoft Clarity API request failed:", error);
        return textResult(CLARITY_REQUEST_FAILED_MESSAGE, true);
    }
}
/**
 * Sends a JSON POST request using a project-scoped Data Export API token.
 *
 * An explicit project override is rejected because the token can query only its
 * own project. HTTP failures return status-specific error results, preserving
 * domain-verification guidance and the service's request ID when present.
 *
 * @param url - The Clarity MCP endpoint URL.
 * @param body - The request payload to serialize as JSON.
 * @param token - The Data Export API token used to authorize the request.
 * @param options - Request options; `projectId` is rejected and `noProject` is ignored.
 * @returns The response as formatted JSON text, or a request-failure message.
 */
async function callWithDataExportToken(url, body, token, options = {}) {
    if (options.projectId) {
        return textResult(getDataExportTokenSingleProjectMessage() + " Omit projectId to query the token's project.", true);
    }
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            return textResult(await describeRequestFailure(response, undefined, CredentialKind.DataExportToken), true);
        }
        return textResult(JSON.stringify(await response.json(), null, 2));
    }
    catch (error) {
        console.error("Microsoft Clarity API request failed:", error);
        return textResult(CLARITY_REQUEST_FAILED_MESSAGE, true);
    }
}
