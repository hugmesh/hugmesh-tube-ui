# hugmesh-tube-ui — builds the Tube (LocalTube) management native-federation
# REMOTE (src → dist/tube/browser) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
#
# Serves on :8080 to MATCH the federation-api tube module registration:
#   remote_entry_url = http://hugmesh-tube-ui:8080/remoteEntry.json
# The remoteEntry.json the production build emits exposes ./Tube (the host
# loadRemoteModule('tube','./Tube') mounts TUBE_ROUTES at the apex path /tube).
#
# visibility=internal: the tube remote is reachable only behind the gateway's
# /tube=ROLE_TUBE route-access gate (admin|superadmin, plus a granted USER with
# ROLE_TUBE) — it is NOT a public surface. Deployed to hugmesh-frontend.
# Consumes same-origin /bff/tube/** (the hugmesh-tube-bff-api download queue +
# storage-budget + use-access overlay). Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:tube -- --base-href=/tube/

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/tube/browser /usr/share/nginx/html
EXPOSE 8080

#### Runtime THEME injection (the fleet-wide login-ui 50-snap-theme.sh
#### mechanism; see hugmesh-host-shell PR #11 for the full rationale). The hook
#### writes $SNAP_THEME_CSS verbatim at container start; nginx serves it via
#### the exact-match /snap-theme.css alias. /tmp, NOT the docroot: on the
#### nginx-unprivileged images uid 101 cannot write the docroot, and on the
#### root images /tmp is equally correct — ONE stanza for the whole fleet.
#### COPY --chmod, NOT COPY + RUN chmod: unprivileged final stages run as
#### uid 101 and a RUN chmod on root-owned COPY output exits 1 (BuildKit is
#### always on for this stack: Makefile DOCKER_BUILDKIT=1).
COPY --chmod=0755 docker-entrypoint.d/50-snap-theme.sh /docker-entrypoint.d/50-snap-theme.sh
ENV SNAP_THEME_OUT=/tmp/snap-theme.css
