import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionService } from './session.service';

/**
 * The within-tube privilege-boundary screen. Reached when a child guard denies
 * activation (a plain USER without ROLE_TUBE hitting My Tube; a ROLE_TUBE user or
 * a wrong-role principal hitting the ADMIN-only Tube Access / Storage Budgets
 * views). NOT an auth failure — the host already authgated the user in
 * (route-access /tube=ROLE_TUBE) — so this explains the MISSING role rather than
 * bouncing to /login, and offers a route back to "My Tube" when the user can use
 * Tube.
 *
 * It mirrors how the bff handles the authoritative denial (a 403 from the
 * @PreAuthorize / TubeAccessGuard): the UI gating only HIDES options; this screen
 * is the graceful landing when a deeper gate says no.
 */
@Component({
  selector: 'hug-tube-forbidden',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tube-forbidden.component.html',
  styleUrl: './tube-forbidden.component.scss',
})
export class TubeForbiddenComponent {
  private readonly session = inject(SessionService);

  /** Whether to offer the "Back to My Tube" link (only if the user can use Tube). */
  readonly canUse = this.session.canUse;
}
