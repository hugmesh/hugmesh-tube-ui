import { Routes } from '@angular/router';
import { TUBE_ROUTES } from './tube.routes';

/** Dev-shell routes: mount the exposed Tube routes at the root so the remote is
 *  browsable standalone (`ng serve tube`). The host ignores this and loads the
 *  exposed `./Tube` module (TUBE_ROUTES) directly at /tube. */
export const routes: Routes = [{ path: '', children: TUBE_ROUTES }];
