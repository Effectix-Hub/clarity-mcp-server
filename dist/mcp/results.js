// A text reply from an MCP tool; isError marks it as a failure the assistant should relay.
export const textResult = (text, isError = false) => ({
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
});
