import { mcpApiUrl } from "../../config.js";
import { callClarityApi } from "../../mcp/client.js";
import { SearchRequest } from "./schemas.js";
// --- Query Documentation Resources ---
export const DOCUMENTATION_TOOL = "query-documentation-resources";
export const DOCUMENTATION_URL = mcpApiUrl("/documentation/query");
export const DOCUMENTATION_DESCRIPTION = "Retrieve Microsoft Clarity documentation snippets for finding answers to user questions including step-by-step screenshots for setup guides, features, usage, troubleshooting, and integration instructions. The query should be focused on one specific documentation topic or question. Avoid complex multi-purpose queries.";
function registerQueryDocumentationResourcesTool(server) {
    server.tool(DOCUMENTATION_TOOL, /* Name */ DOCUMENTATION_DESCRIPTION, /* Description */ SearchRequest, /* Parameter Schema */ {
        title: "Query Documentation Resources",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
    }, async ({ query }) => {
        const requestBody = {
            query: query,
        };
        const callOptions = { noProject: true };
        return await callClarityApi(DOCUMENTATION_URL, requestBody, callOptions);
    });
}
// --- Registration ---
export function registerDocumentationTools(server) {
    registerQueryDocumentationResourcesTool(server);
}
