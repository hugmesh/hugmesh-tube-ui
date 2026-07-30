/** Ambient declaration for the runtime-injected host override of the tube BFF
 *  base URL (see {@link TUBE_BASE_URL} in src/app/tube.service.ts). Declared
 *  here so reading it doesn't require an `any` escape hatch. */
export {};

declare global {
  // eslint-disable-next-line no-var
  var __HUG_TUBE_URL__: string | undefined;
}
