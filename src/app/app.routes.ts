import { Routes } from '@angular/router';
import { TUBE_ROUTES } from './tube.routes';

/** Dev-shell routes: mount the exposed Tube routes at /tube so the remote is
 *  browsable standalone (`ng serve tube`) at the SAME path the host mounts it.
 *  That matters, not just for tidiness: the guards and the forbidden screen
 *  route to the absolute `/tube/forbidden`, which only resolves when the
 *  remote lives under /tube. The offline e2e lane (e2e/) drives this shell.
 *  The host ignores this file and loads the exposed `./Tube` module
 *  (TUBE_ROUTES) directly at /tube. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tube' },
  { path: 'tube', children: TUBE_ROUTES },
];
