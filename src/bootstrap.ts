/**
 * Angular bootstrap for the tube-ui DEV SHELL. Mounts {@link AppComponent}
 * with the TUBE_ROUTES at the root so the remote is browsable standalone
 * via `ng serve tube`.
 *
 * In production this file is NOT loaded — the hugmesh.net host
 * federates `./Tube` (TUBE_ROUTES) directly at the /tube mount.
 *
 * {@link provideHttpClient} with `withFetch()` is present for parity with
 * the owncast remote and to support any future typed API-client wiring via
 * `npm run gen` (ng-openapi-gen); TubeService currently uses native `fetch`
 * directly via the {@link TUBE_BASE_URL} injection token.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/auth.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
}).catch((err) => console.error(err));
