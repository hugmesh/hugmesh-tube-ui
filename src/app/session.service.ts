import { Injectable, signal, computed } from '@angular/core';

export interface HugSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  provider: 'google' | 'discord';
  roles: string[];
  registrationComplete: boolean;
}

/** Holds the logged-in session (persisted to localStorage) and derives the
 *  Casdoor-style role flags the tube console gates its views on.
 *
 *  This is the canonical HugMesh SessionService (copied from hugmesh-wiki-ui /
 *  hugmesh-admin-ui, the references with the full role-tier accessors) so this
 *  remote gates on the SAME JWT-derived signals as the other consoles. Roles are
 *  the lowercase Casdoor roles 'user'/'mod'/'admin'/'superadmin' (+ the per-service
 *  'tube' access role).
 *
 *  ── The tube role model (mirrors hugmesh-tube-bff-api SecurityConfig) ──
 *  TUBE_USE    = ROLE_TUBE            → the "My Tube" user console (my subscriptions,
 *                download queue, storage usage, enqueue, in-platform viewing). NOTE:
 *                ROLE_TUBE is only the route-access + connect floor; the BFF
 *                TubeAccessGuard enforces the DEFAULT-DENY may-use grant at request
 *                time (an active tube_access grant AND NOT a ban, SUPERADMIN exempt),
 *                so the user surface ALWAYS handles a 403 gracefully.
 *  TUBE_MANAGE = ADMIN | SUPERADMIN   → the "Tube Access" grant/timeout/ban console
 *                (/bff/tube/admin/access/**) AND the "Storage Budgets" console
 *                (/bff/tube/admin/storage-budget). A SUPERADMIN additionally reaches
 *                the list-all/history (/bff/tube/superadmin/access) surface.
 *
 *  The signals here are DEFENCE-IN-DEPTH (convenience gating). The tube-bff
 *  @PreAuthorize + TubeAccessGuard are authoritative; the UI never SHOWS an option
 *  the role cannot use, and still handles a 403 gracefully if the server disagrees. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = 'hug.session';
  private readonly channel = 'hug-session-change';
  readonly session = signal<HugSession | null>(this.load());
  readonly loggedIn = computed(() => this.session() !== null);

  /** The raw Casdoor roles of the current session (empty when logged out). */
  private readonly roles = computed(() => this.session()?.roles ?? []);

  /** USER tier: every authenticated user. Casdoor always grants 'user'; we treat
   *  any logged-in session as the USER tier. */
  readonly isUser = computed(() => this.loggedIn());

  /** ADMIN tier: a Casdoor 'admin' role. (A SUPERADMIN is NOT automatically an
   *  admin in the raw role set — the tube composites below add SUPERADMIN where
   *  the cascade requires it, matching the bff SpEL exactly.) */
  readonly isAdmin = computed(() => this.roles().includes('admin'));

  /** SUPERADMIN tier: a Casdoor 'superadmin' role. */
  readonly isSuperadmin = computed(() => this.roles().includes('superadmin'));

  /** MOD tier: a Casdoor 'mod' OR 'admin' role (matching the platform-wide
   *  defence-in-depth hasAnyRole('MOD','ADMIN')). NOT a tube gate (the tube model
   *  has no mod tier) — kept for parity with the canonical SessionService. */
  readonly isMod = computed(() => {
    const r = this.roles();
    return r.includes('mod') || r.includes('admin');
  });

  /** The per-service tube access role (ROLE_TUBE) — the gateway route-access floor
   *  for the /tube mount and the role a granted USER carries. */
  readonly hasTubeRole = computed(() => this.roles().includes('tube'));

  // ── Tube role composites (mirror the tube-bff SecurityConfig path gates) ──

  /** TUBE_USE = ROLE_TUBE. Gates the "My Tube" user console. A SUPERADMIN/ADMIN
   *  also carries the tube surface (they govern it), but the user console is
   *  specifically for a ROLE_TUBE holder; an admin/superadmin sees it too so they
   *  can self-serve. (The BFF TubeAccessGuard is the authoritative may-use gate;
   *  this only decides whether to OFFER the user console.) */
  readonly canUse = computed(
    () => this.hasTubeRole() || this.isAdmin() || this.isSuperadmin(),
  );

  /** TUBE_MANAGE = ADMIN | SUPERADMIN. Gates the "Tube Access" grant/timeout/ban
   *  console AND the "Storage Budgets" console (/bff/tube/admin/**). */
  readonly canManage = computed(() => this.isAdmin() || this.isSuperadmin());

  /** The SUPERADMIN-only manage-all surface (list-all active overrides + history,
   *  /bff/tube/superadmin/**). Shown inside the Tube Access console for a
   *  superadmin only. */
  readonly canManageAll = computed(() => this.isSuperadmin());

  constructor() {
    // The host shell and each federated remote each hold their OWN SessionService
    // instance over the same localStorage key. Re-read on a same-document broadcast
    // (dispatched by whichever instance wrote) and on cross-tab storage events, so
    // every nav/guard reading this signal stays in sync.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) this.session.set(this.load());
      });
    }
  }

  private load(): HugSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  set(s: HugSession): void {
    localStorage.setItem(this.key, JSON.stringify(s));
    this.session.set(s);
    this.broadcast();
  }

  patch(p: Partial<HugSession>): void {
    const s = this.session();
    if (s) this.set({ ...s, ...p });
  }

  clear(): void {
    localStorage.removeItem(this.key);
    this.session.set(null);
    this.broadcast();
  }

  /** Notify the other in-page SessionService instances (host + remotes) to re-read. */
  private broadcast(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel));
  }
}
