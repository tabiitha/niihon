/** Who the provider vouches for. Provider, issuer, and subject identify an account; nothing else does. */
export interface VerifiedIdentity {
  readonly provider: string;
  readonly issuer: string;
  /** The provider's stable identifier of the user, never an email address or a display name. */
  readonly subject: string;
}

export type ProviderFailureKind =
  /** The provider refused the authorization code (expired, already used, wrong return address). */
  | 'code_rejected'
  /** The provider answered, but the identity it returned does not pass verification. */
  | 'identity_unverified'
  /** The provider could not be reached or answered something unusable. */
  | 'unavailable';

export class ProviderError extends Error {
  override name = 'ProviderError';

  readonly kind: ProviderFailureKind;

  constructor(kind: ProviderFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface AuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  /** PKCE S256 challenge of the verifier the server keeps. */
  readonly codeChallenge: string;
  readonly redirectUri: string;
}

export interface CodeExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

/**
 * One external identity provider. The adapter owns the protocol details; the accounts module only
 * sees an authorization address to send the browser to and, afterwards, a verified identity.
 * Reused by sign-in (#76).
 */
export interface OAuthProvider {
  readonly id: string;
  authorizationUrl(request: AuthorizationRequest): string;
  /**
   * Exchanges the authorization code and verifies the identity. Provider tokens are used inside
   * this call and discarded: they are neither returned, stored, nor logged. Throws `ProviderError`.
   */
  verifyCode(exchange: CodeExchange): Promise<VerifiedIdentity>;
}
