/**
 * Represents an OAuth error returned by the token endpoint.
 *
 * Preserves the error code for programmatic handling, such as `invalid_grant`
 * when a refresh token is no longer valid.
 */
export class OAuthTokenError extends Error {
    code;
    /**
     * Creates an error whose message includes the code and any non-empty description.
     *
     * @param code - The OAuth error code returned by the token endpoint.
     * @param description - Optional explanation provided by the token endpoint.
     */
    constructor(code, description) {
        super(description ? `${code}: ${description}` : code);
        this.code = code;
        this.name = "OAuthTokenError";
    }
}
