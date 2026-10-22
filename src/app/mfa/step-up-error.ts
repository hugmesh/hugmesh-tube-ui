import { HttpErrorResponse } from '@angular/common/http';

/**
 * Recognises the platform's "step-up required" 403 so a privileged Tube console can
 * offer the inline MFA challenge instead of a bare error. Ported from
 * hugmesh-admin-ui `mfa/step-up-error.ts` (the fleet's reference detector), narrowed
 * to what Tube can actually receive.
 *
 * <h2>Who sends the signal here</h2>
 * The GATEWAY, not tube-bff. On an `mfa_required` route (the two tube admin rows of
 * the route-access seed: `/bff/tube/admin/access/**`, `/bff/tube/admin/storage-budget/**`)
 * hugmesh-gateway refuses an admin who has no fresh second factor with
 *
 *     HTTP/1.1 403 Forbidden
 *     X-Route-Denied: <gateway>:<path>
 *     X-Step-Up-Required: X-Mfa-StepUp
 *
 * and an EMPTY body. It only sends the header when a fresh second factor is the one
 * thing missing: a role denial or an explicit deny is the bare 403 and never matches
 * here, so no one is offered a challenge that could not let them through.
 *
 * <h2>Why there is no legacy-phrase fallback</h2>
 * admin-ui and forum-ui also match the free-text phrase "requires step-up" for a BFF
 * that predates the header. Tube never had such a BFF, and the gateway's body is
 * empty, so a phrase match could only ever fire on something that is NOT this contract.
 * Detection is the header alone.
 *
 * <h2>Why a blind retry is correct</h2>
 * The gateway reads freshness off the caller's own session, so after the challenge a
 * plain retry of the SAME call passes with no token. The header value is the name of
 * the retry header a token-carrying gate would use; the gateway floor has no token leg,
 * so the value is only validated, never sent.
 */

/** The response header the gateway stamps on (and only on) a step-up rejection. */
export const STEP_UP_SIGNAL_HEADER = 'X-Step-Up-Required';

/**
 * The shape a signal value must have to be trusted: an `X-<flavour>-StepUp` name,
 * byte-identical to admin-bff's `StepUpRequiredException.SAFE_HEADER_NAME`. A value that
 * is not one (a rogue proxy, a mangled header) is ignored rather than trusted.
 */
const SAFE_SIGNAL_VALUE = /^X-[A-Za-z0-9-]{1,60}-StepUp$/;

/**
 * True when `e` is a 403 carrying a well-formed {@link STEP_UP_SIGNAL_HEADER}. The 403
 * check matters: the platform only ever pairs the header with a 403, and a stray header
 * on some other status must not pop a dialog.
 */
export function isStepUpRequiredError(e: unknown): boolean {
  if (!(e instanceof HttpErrorResponse) || e.status !== 403) return false;
  const signal = e.headers?.get(STEP_UP_SIGNAL_HEADER) ?? null;
  return signal !== null && SAFE_SIGNAL_VALUE.test(signal);
}
