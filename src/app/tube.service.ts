import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiConfiguration } from './api/api-configuration';
import { TubeDownloadsService } from './api/services/tube-downloads.service';
import { TubeSubscriptionsService } from './api/services/tube-subscriptions.service';
import { TubeGoogleConnectService } from './api/services/tube-google-connect.service';
import { TubeMediaSigningService } from './api/services/tube-media-signing.service';
import { TubeStorageBudgetAdminService } from './api/services/tube-storage-budget-admin.service';
import { TubeUseAccessService } from './api/services/tube-use-access.service';

/** Base URL of the tube BFF. The fe-gateway proxies same-origin /bff/tube/** to
 *  hugmesh-tube-bff-api (the download work-queue + storage-budget + use-access
 *  overlay), so the default is the empty string = same origin.
 *  `globalThis.__HUG_TUBE_URL__` lets the host override the target at runtime
 *  (mirrors the other remotes' __SNAP_*_URL__ globals). */
export const TUBE_BASE_URL = new InjectionToken<string>('TUBE_BASE_URL', {
  factory: () => globalThis.__HUG_TUBE_URL__ ?? '',
});

// ---------------------------------------------------------------------------
// Contract — mirrors hugmesh-tube-bff-api TubeDownloadDto + TubeAccessDto.
// These are the EXACT JSON shapes the bff returns. This service now DELEGATES
// to the generated, typed clients under src/app/api/ (regenerated from the
// committed openapi.json via `npm run gen:spec`, the standard HugMesh
// datastore pattern). It keeps its OWN public interfaces below so the consuming
// components keep their stable contract; the generated models are bridged at the
// delegation boundary (the wire calls are identical — generated rootUrl is '').
// ---------------------------------------------------------------------------

/** TubeDownloadDto.Job — a tube_download_job row as returned to its owner. The
 *  `state` is one of queued|claimed|downloading|done|failed|skipped; `contentPath`
 *  + `bytes` are populated once a worker reports the download done (the in-platform
 *  player reads contentPath). */
export interface DownloadJob {
  id: string;
  domain: string;
  userSubject: string;
  channelId: string;
  videoId: string;
  title: string | null;
  state: string;
  claimedBy: string | null;
  claimedAt: string | null;
  attempts: number;
  lastError: string | null;
  bytes: number | null;
  contentPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** TubeDownloadDto.JobList — the download-queue list wrapper. */
export interface JobList {
  jobs: DownloadJob[];
}

/** TubeGoogleDto.Subscription — one subscribed YouTube channel as returned to its
 *  owner by GET /bff/tube/subscriptions. The owner-scoped subscriptions list (the
 *  server derives subject+brand; no secret, no refresh token crosses the boundary). */
export interface Subscription {
  channelId: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  syncedAt: string | null;
}

/** TubeGoogleDto.SubscriptionList — the subscriptions list-response wrapper. */
export interface SubscriptionList {
  subscriptions: Subscription[];
}

/** TubeGoogleDto.ConnectStatus — the DISPLAY-SAFE Google connection status
 *  (GET /bff/tube/google-connect/status, and the response of disconnect). The
 *  refresh token is NEVER returned (the BFF stores it AES-256-GCM-encrypted);
 *  the UI only ever sees this envelope. `reauthRequired` is set server-side when
 *  a token refresh FAILED (the BFF stops a sync on it) — the UI must then offer
 *  a re-connect and never claim a sync will succeed. */
export interface ConnectStatus {
  connected?: boolean;
  connectedAt?: string | null;
  googleEmail?: string | null;
  reauthRequired?: boolean;
  scopes?: string | null;
}

/** TubeGoogleDto.AuthorizeUrl — GET /bff/tube/google-connect/authorize. The
 *  Google consent URL (access_type=offline&prompt=consent) carrying a signed
 *  CSRF state that binds THIS principal; the UI performs a full-page navigation
 *  to it (the OAuth hop leaves the SPA). `authorizeUrl` is optional in the wire
 *  schema — an absent/empty value means the BFF could not build a consent URL
 *  (unconfigured/stubbed) and the UI must disclose that, never navigate blind. */
export interface AuthorizeUrl {
  authorizeUrl?: string | null;
}

/** TubeGoogleDto.SyncResult — POST /bff/tube/subscriptions/sync. `synced` is the
 *  number of subscription rows upserted from Google. A failed token refresh
 *  server-side marks reauth_required and STOPS the sync (surfaced as an error,
 *  not a zero-count success). */
export interface SyncResult {
  synced?: number;
}

/** TubeMediaDto.SignedUrl — the response of GET /bff/tube/media/sign?path=<contentPath>.
 *  `url` is the short-TTL (5 min) HMAC-signed media URL ready for a `<video src>`
 *  (`/tube/content/<path>?sig=...&exp=...&sub=...&domain=...`); `expiresAt` is the
 *  absolute UTC expiry so the client can pre-emptively re-sign. */
export interface SignedUrl {
  url: string;
  expiresAt: string;
}

/** TubeDownloadDto.Usage — a storage-usage row (used/budget bytes). Returned by
 *  the admin budget set; the user storage bar derives used/budget from it. */
export interface Usage {
  domain: string;
  userSubject: string;
  usedBytes: number;
  budgetBytes: number;
  updatedAt: string;
}

/** TubeAccessDto.Access — a tube_access overlay row. accessType = 'use'|'banned';
 *  state = 'active'|'revoked'. expiresAt set (future) = a timeout; null = permanent. */
export interface TubeAccess {
  id: string;
  domain: string;
  userSubject: string;
  accessType: string;
  state: string;
  grantedBySubject: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** TubeAccessDto.AccessList. */
export interface AccessList {
  access: TubeAccess[];
}

/** TubeAccessDto.GrantOrBan — POST .../access/grant and .../access/ban. */
export interface GrantOrBan {
  userSubject: string;
  reason?: string;
}

/** TubeAccessDto.Timeout — POST .../access/timeout (banned override, future expiry). */
export interface TimeoutBody {
  userSubject: string;
  ttlSeconds: number;
  reason?: string;
}

/** TubeDownloadDto.BudgetRequest — POST /bff/tube/admin/storage-budget. */
export interface BudgetRequest {
  userSubject: string;
  budgetBytes: number;
}

/** A typed error the service raises so components can surface the EXACT failure
 *  the bff returned — the 403 the @PreAuthorize / TubeAccessGuard returns
 *  (default-deny use, or a wrong-role manage attempt) and a 404 are both
 *  rendered specifically. */
export class TubeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TubeApiError';
  }
  /** A 403 — the bff @PreAuthorize composite, the path gate, or the
   *  TubeAccessGuard default-deny use decision (no active grant / an active ban).
   *  The server-authoritative denial (the UI gating is only convenience). */
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Thin reactive wrapper over hugmesh-tube-bff-api /bff/tube/**. Auth piggybacks
 * on the shared-session HttpOnly `bff_` cookie (sent via the authInterceptor's
 * `withCredentials`, which the gateway turns into the Bearer server-side) — the
 * browser holds no BFF JWT and the module never renders a login form.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES every call to the
 * generated, typed clients under {@code src/app/api} (generated from the
 * tube-bff-api OpenAPI spec) instead of hand-rolling {@code fetch} URLs. The
 * generated clients call the SAME same-origin {@code /bff/tube/**} paths (their
 * {@code rootUrl} defaults to '' and is bound to {@link TUBE_BASE_URL} below), so
 * the wire behaviour — and the {@code HttpTestingController} URL assertions in the
 * spec — are unchanged. This service keeps its OWN public DTO types + Promise
 * method signatures + {@link TubeApiError} translation so the consuming components
 * need no change; the generated models are bridged at the delegation boundary, and
 * a {@link HttpErrorResponse} is mapped back to a {@link TubeApiError}.
 *
 * The methods map 1:1 to the bff endpoints (see each method):
 *   USER  (authenticated floor; default-deny use enforced by TubeAccessGuard):
 *     listQueue        GET  /bff/tube/downloads        → JobList (my own jobs)
 *     enqueue          POST /bff/tube/downloads        → JobList (enqueue from subs)
 *     getSubscriptions GET  /bff/tube/subscriptions    → SubscriptionList (my subs)
 *     syncSubscriptions POST /bff/tube/subscriptions/sync → SyncResult (mirror from Google)
 *     googleConnectStatus GET  /bff/tube/google-connect/status     → ConnectStatus
 *     googleAuthorizeUrl  GET  /bff/tube/google-connect/authorize  → AuthorizeUrl
 *     googleDisconnect    POST /bff/tube/google-connect/disconnect → ConnectStatus
 *     signMedia        GET  /bff/tube/media/sign?path= → SignedUrl (my own contentPath)
 *   ADMIN (/bff/tube/admin/** = ADMIN|SUPERADMIN):
 *     setBudget   POST   /bff/tube/admin/storage-budget          → Usage
 *     grant       POST   /bff/tube/admin/access/grant            → Access
 *     timeout     POST   /bff/tube/admin/access/timeout          → Access
 *     ban         POST   /bff/tube/admin/access/ban              → Access
 *     revoke      DELETE /bff/tube/admin/access/{type}/{user}    → { state }
 *   SUPERADMIN (/bff/tube/superadmin/** = SUPERADMIN):
 *     listActiveAccess GET /bff/tube/superadmin/access                   → AccessList
 *     accessHistory    GET /bff/tube/superadmin/access/{user}/history    → AccessList
 *
 * NOTE: the INTERNAL worker seam (/bff/tube/internal/** — claim/report,
 * ROLE_TUBE_WORKER) is a machine-only operation OUTSIDE the human hierarchy and
 * is DELIBERATELY NOT exposed here (its generated client exists but is never
 * injected).
 *
 * NOTE: GET /bff/tube/google-connect/callback (the generated
 * `googleConnectCallback`) is DELIBERATELY NOT exposed either — it is GOOGLE'S
 * browser-redirect target, not an XHR the SPA makes. Google navigates the
 * browser there with ?code&state after consent; the signed state (minted by
 * /authorize) binds the principal because that hop carries no bearer of its
 * own. The UI's half of the flow is only: fetch the authorizeUrl, then
 * full-page-navigate to it.
 *
 * The role gating is UI-convenience (the views are guarded; the controls are
 * role-shown) — the bff @PreAuthorize + TubeAccessGuard are the AUTHORITATIVE
 * gates, so every method surfaces a 403 as a TubeApiError(403) the caller renders
 * gracefully.
 */
@Injectable({ providedIn: 'root' })
export class TubeService {
  private readonly base = inject(TUBE_BASE_URL);
  private readonly downloads = inject(TubeDownloadsService);
  private readonly subscriptions = inject(TubeSubscriptionsService);
  private readonly google = inject(TubeGoogleConnectService);
  private readonly media = inject(TubeMediaSigningService);
  private readonly budgets = inject(TubeStorageBudgetAdminService);
  private readonly access = inject(TubeUseAccessService);

  constructor() {
    // Bind the generated clients' rootUrl to TUBE_BASE_URL so a host override
    // (__HUG_TUBE_URL__) still targets the right origin. Default '' = same
    // origin (the fe-gateway proxies /bff/tube/**), matching the generated
    // ApiConfiguration default.
    inject(ApiConfiguration).rootUrl = this.base;
  }

  /** Bridge a delegated Promise<T> to the Promise<R> contract this service
   *  exposes, translating an {@link HttpErrorResponse} into the {@link TubeApiError}
   *  the components key off (so a 403/404 stays distinguishable). */
  private async run<T, R>(p: Promise<T>): Promise<R> {
    try {
      return (await p) as unknown as R;
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const body: any = e.error;
        const detail =
          (body && typeof body === 'object' && (body.message ?? body.error)) ||
          (typeof body === 'string' ? body : '') ||
          e.message;
        throw new TubeApiError(e.status, detail || `request failed: ${e.status}`);
      }
      throw e;
    }
  }

  // ----- USER: download queue (authenticated; default-deny use enforced) --

  /** GET /bff/tube/downloads → TubeDownloadDto.JobList (the caller's OWN jobs;
   *  owner + brand server-derived). 403 when the user has no active tube_access
   *  use grant (or is banned) — the default-deny floor. */
  listQueue(): Promise<JobList> {
    return this.run<unknown, JobList>(this.downloads.listDownloadJobs());
  }

  /** POST /bff/tube/downloads → TubeDownloadDto.JobList (enqueue jobs from the
   *  caller's subscriptions; deduped; pause-on-full marks new work `skipped` when
   *  the storage budget is full). 403 on the default-deny floor. */
  enqueueFromSubscriptions(): Promise<JobList> {
    return this.run<unknown, JobList>(this.downloads.enqueueDownloadJobs());
  }

  /** GET /bff/tube/subscriptions → TubeGoogleDto.SubscriptionList (the caller's OWN
   *  mirrored YouTube subscriptions; owner + brand server-derived, no network call,
   *  no secret). The single source of truth for the user's subscribed channels.
   *  403 on the default-deny use floor (no active grant / a ban). */
  getSubscriptions(): Promise<SubscriptionList> {
    return this.run<unknown, SubscriptionList>(this.subscriptions.listSubscriptions());
  }

  // ----- USER: Google connect + subscription sync (use-gated, owner-scoped) --

  /** GET /bff/tube/google-connect/status → TubeGoogleDto.ConnectStatus — the
   *  caller's OWN display-safe connection status (never the refresh token).
   *  403 on the default-deny use floor. The My Tube surface treats ANY failure
   *  here as a DEGRADED connect panel (controls disabled + the real failure
   *  disclosed) — it never guesses a connection state it could not read. */
  googleConnectStatus(): Promise<ConnectStatus> {
    return this.run<unknown, ConnectStatus>(this.google.googleConnectStatus());
  }

  /** GET /bff/tube/google-connect/authorize → TubeGoogleDto.AuthorizeUrl — the
   *  Google consent URL (access_type=offline&prompt=consent) with a signed CSRF
   *  state binding THIS principal. The caller must FULL-PAGE-NAVIGATE to the
   *  returned URL (the OAuth hop leaves the SPA; Google then redirects the
   *  browser to GET /bff/tube/google-connect/callback?code&state — a hop this
   *  UI never makes itself). An absent/empty `authorizeUrl` means the BFF could
   *  not build a consent URL — the caller must disclose that, never navigate. */
  googleAuthorizeUrl(): Promise<AuthorizeUrl> {
    return this.run<unknown, AuthorizeUrl>(this.google.googleAuthorizeUrl());
  }

  /** POST /bff/tube/google-connect/disconnect → TubeGoogleDto.ConnectStatus —
   *  best-effort revoke at Google, then soft-revoke the stored connection
   *  (audit-retained). Returns the post-disconnect status. */
  googleDisconnect(): Promise<ConnectStatus> {
    return this.run<unknown, ConnectStatus>(this.google.googleDisconnect());
  }

  /** POST /bff/tube/subscriptions/sync → TubeGoogleDto.SyncResult — mirror the
   *  caller's OWN YouTube subscriptions into Tube (refresh → page
   *  subscriptions.list?mine=true → idempotent UPSERT). A failed token refresh
   *  marks reauth_required server-side and STOPS (an error, never a fake
   *  zero-count success), so the caller re-reads the connect status after a
   *  failure. 403 on the default-deny use floor. */
  syncSubscriptions(): Promise<SyncResult> {
    return this.run<unknown, SyncResult>(this.subscriptions.syncSubscriptions());
  }

  /** GET /bff/tube/media/sign?path=<contentPath> → TubeMediaDto.SignedUrl. Returns a
   *  short-TTL (5 min) HMAC-signed URL authorising the caller to stream THIS content.
   *
   *  OWNER SAFETY: `contentPath` MUST be a contentPath the caller received from their
   *  OWN owner-scoped download-queue (GET /bff/tube/downloads) — never a user-typed or
   *  cross-list path. The BFF independently re-checks the path embeds the caller's own
   *  /<domain>/<subject>/ prefix and returns 403 otherwise (the two-wall owner check),
   *  but the UI must not even attempt to sign anything but its own queue rows.
   *
   *  Errors surface as TubeApiError: 400 = malformed path, 403 = cross-user/cross-brand
   *  (or an expired/invalid token re-sign attempt). The caller renders these as an
   *  error/retry, never as a broken player. */
  signMedia(contentPath: string): Promise<SignedUrl> {
    return this.run<unknown, SignedUrl>(this.media.signMediaUrl({ path: contentPath }));
  }

  // ----- ADMIN: storage budget (TUBE_MANAGE = ADMIN|SUPERADMIN) ------------

  /** POST /bff/tube/admin/storage-budget → TubeDownloadDto.Usage. Sets a target
   *  user's download storage budget (bytes); brand is server-derived (own-brand). */
  setBudget(body: BudgetRequest): Promise<Usage> {
    return this.run<unknown, Usage>(this.budgets.setStorageBudget({ body }));
  }

  // ----- ADMIN: use-access overlay (TUBE_MANAGE = ADMIN|SUPERADMIN) --------

  /** POST /bff/tube/admin/access/grant → TubeAccessDto.Access (permanent may-use). */
  grant(body: GrantOrBan): Promise<TubeAccess> {
    return this.run<unknown, TubeAccess>(this.access.grantUseAccess({ body }));
  }

  /** POST /bff/tube/admin/access/timeout → TubeAccessDto.Access (bounded ban; auto-restores). */
  timeout(body: TimeoutBody): Promise<TubeAccess> {
    return this.run<unknown, TubeAccess>(this.access.timeoutUseAccess({ body }));
  }

  /** POST /bff/tube/admin/access/ban → TubeAccessDto.Access (permanent ban; ban>grant). */
  ban(body: GrantOrBan): Promise<TubeAccess> {
    return this.run<unknown, TubeAccess>(this.access.banUseAccess({ body }));
  }

  /** DELETE /bff/tube/admin/access/{accessType}/{userSubject} — revoke an active
   *  override (CAS active->revoked, row retained = audit). accessType = 'use'
   *  (remove a grant) | 'banned' (restore/lift a ban).
   *
   *  The generated endpoint returns an untyped {@code Mono<Map<String,Object>>}
   *  ({@code {[k:string]:{}}}), so the {@code { state }} shape is restored at the
   *  delegation boundary. */
  revoke(accessType: 'use' | 'banned', userSubject: string): Promise<{ state: string }> {
    return this.run<unknown, { state: string }>(
      this.access.revokeUseAccess({ accessType, userSubject }),
    );
  }

  // ----- SUPERADMIN: manage-all (TUBE_MANAGE = SUPERADMIN) -----------------

  /** GET /bff/tube/superadmin/access → TubeAccessDto.AccessList (all ACTIVE
   *  overrides, scoped to the caller's brand; SUPERADMIN sees all). */
  listActiveAccess(): Promise<AccessList> {
    return this.run<unknown, AccessList>(this.access.listActiveUseAccess());
  }

  /** GET /bff/tube/superadmin/access/{userSubject}/history → the full
   *  grant/timeout/ban HISTORY (active + revoked = audit) for a principal. */
  accessHistory(userSubject: string): Promise<AccessList> {
    return this.run<unknown, AccessList>(this.access.useAccessHistory({ userSubject }));
  }
}
