import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guards for the tube console — the UI half of the tube role model. Each
 * mirrors a hugmesh-tube-bff-api path/@PreAuthorize gate (defence-in-depth;
 * the bff is authoritative):
 *
 *   tubeReadGuard   — TUBE_USE = ROLE_TUBE. Gates the "My Tube" user console
 *                     (my subscriptions, download queue, storage usage, enqueue,
 *                     in-platform viewing). A user WITHOUT ROLE_TUBE is sent to
 *                     /tube/forbidden. (The bff's TubeAccessGuard then enforces
 *                     the DEFAULT-DENY may-use grant at request time — ROLE_TUBE
 *                     alone is the floor, not a use grant.)
 *   tubeManageGuard — TUBE_MANAGE = ADMIN | SUPERADMIN. Gates the "Tube Access"
 *                     grant/timeout/ban console (/bff/tube/admin/access/**) AND
 *                     the "Storage Budgets" console (/bff/tube/admin/storage-budget).
 *                     A plain USER (even a ROLE_TUBE holder) is sent to
 *                     /tube/forbidden.
 *
 * A denied activation routes to the IN-REMOTE /tube/forbidden screen (NOT
 * '/forbidden', NOT '/login'): the host already authgated the user in
 * (route-access /tube=ROLE_TUBE), so a denial here is a within-tube privilege
 * boundary, not an auth failure. The screen explains the missing role + offers a
 * route back. SUPERADMIN sees everything; default-deny sends a wrong-role/plain
 * USER to /tube/forbidden.
 */
export const tubeReadGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.canUse() ? true : router.parseUrl('/tube/forbidden');
};

export const tubeManageGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.canManage() ? true : router.parseUrl('/tube/forbidden');
};
