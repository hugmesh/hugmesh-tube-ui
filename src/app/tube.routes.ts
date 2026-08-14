import { Routes } from '@angular/router';
import { TubeConsoleComponent } from './tube-console.component';
import { TubeMyComponent } from './tube-my.component';
import { TubeAccessComponent } from './tube-access.component';
import { TubeBudgetsComponent } from './tube-budgets.component';
import { TubeForbiddenComponent } from './tube-forbidden.component';
import { tubeReadGuard, tubeManageGuard } from './tube.guard';

/**
 * The exposed `./Tube` module — mounted by the hugmesh.net host at the
 * apex path /tube (the federation-api tube module row: mountAt '/tube',
 * remote_entry_url http://hugmesh-tube-ui:8080/remoteEntry.json,
 * requiresRole 'tube', visibility internal). The host gates the WHOLE /tube mount
 * behind route-access ROLE_TUBE; THESE child guards then enforce the per-VIEW
 * role boundary so a granted ROLE_TUBE user sees only "My Tube", while an
 * ADMIN/SUPERADMIN additionally sees the Tube Access + Storage Budgets consoles.
 *
 * View → role gate (mirrors hugmesh-tube-bff-api SecurityConfig path gates):
 *   ''         TubeConsole  — shell + role-aware nav (no extra gate beyond /tube)
 *   my         TubeMy       — my queue/subs/usage/enqueue/viewing (tubeReadGuard: TUBE_USE)
 *   access     TubeAccess   — grant/timeout/ban/restore + list/history (tubeManageGuard: TUBE_MANAGE)
 *   budgets    TubeBudgets  — set per-user storage budget (tubeManageGuard: TUBE_MANAGE)
 *   forbidden  TubeForbidden— the within-tube privilege-boundary screen
 *
 * The guard `false`-paths route to /tube/forbidden (the federated mount path —
 * NOT '/forbidden', NOT '/login'): the host already authgated the user in; a
 * denial here is a within-tube privilege boundary.
 */
export const TUBE_ROUTES: Routes = [
  {
    path: '',
    component: TubeConsoleComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'my' },
      { path: 'my', component: TubeMyComponent, canActivate: [tubeReadGuard] },
      { path: 'access', component: TubeAccessComponent, canActivate: [tubeManageGuard] },
      { path: 'budgets', component: TubeBudgetsComponent, canActivate: [tubeManageGuard] },
      { path: 'forbidden', component: TubeForbiddenComponent },
    ],
  },
];
