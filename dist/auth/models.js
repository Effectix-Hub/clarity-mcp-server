// The credentials the Clarity tools use for a request.
export var CredentialKind;
(function (CredentialKind) {
    CredentialKind["OAuth"] = "oauth";
    CredentialKind["DataExportToken"] = "data-export-token";
    CredentialKind["None"] = "none";
})(CredentialKind || (CredentialKind = {}));
