import { HttpInterceptorFn } from '@angular/common/http';

/** Sends the HttpOnly `bff_` session cookie (credentials) on every outgoing
 *  HttpClient request so the gateway's BffCookieToBearerWebFilter can mint the
 *  `Authorization: Bearer` server-side. The browser no longer holds or attaches
 *  the BFF JWT itself — only the cookie crosses the boundary, applied centrally so
 *  the generated `/bff/tube/**` clients carry it unchanged. Requests made while
 *  the session is null (not logged in) carry no cookie and the BFF rejects them
 *  with 401. Mirrors the canonical hugmesh-user-ui authInterceptor. */
export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
