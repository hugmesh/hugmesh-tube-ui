/**
 * Native-federation REMOTE entrypoint for hugmesh-tube-ui.
 *
 * `initFederation()` registers this remote with the native-federation runtime
 * so the host can resolve `loadRemoteModule('tube', './Tube')` at runtime.
 * Once federation wiring is complete, `./bootstrap` bootstraps the standalone
 * Angular dev-shell (AppComponent + TUBE_ROUTES). In production the
 * hugmesh.systems host federates `./Tube` (TUBE_ROUTES) directly at the
 * /tube mount without loading this shell.
 *
 * Errors are logged but NOT rethrown so a misconfigured federation init
 * does not hard-fail the dev shell.
 */
import { initFederation } from '@angular-architects/native-federation';

initFederation()
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
