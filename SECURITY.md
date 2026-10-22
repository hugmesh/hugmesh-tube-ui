# Security Policy

## Scope

This repository is the HugMesh **Tube management UI**: a native-federation remote
that the host shell mounts at `/tube`, served by nginx from this repo's image. It
holds no authority of its own. The gateway's `/tube/**` route-access rule and the
`hugmesh-tube-bff-api` role checks decide who may do what; the role checks in this
UI only hide controls a user could not use anyway.

Report issues in this repository here, for example:

- the nginx response headers and Content-Security-Policy in `nginx.conf`,
- the theme entrypoint script in `docker-entrypoint.d/`,
- anything in `src/` that leaks data across users, renders untrusted content
  unsafely, or sends a request the user did not intend.

Report problems in the gateway, the BFF or the login flow against those
repositories instead.

## Supported versions

There is no release train. The supported version is the latest commit on `main`.
Fixes land on `main`; there are no maintenance branches.

## Reporting a vulnerability

Report it **privately**. Do **not** open a public issue, pull request or
discussion for a vulnerability that is not fixed yet.

Use GitHub's private vulnerability reporting on this repository: the **Security**
tab, then **Report a vulnerability**. That opens a private security advisory that
only you and the maintainers can see.

Please include the commit you tested, the steps to reproduce, and what an attacker
gains. We will acknowledge the report, agree a fix and a disclosure date with you,
and tell you when the fix is on `main`.
