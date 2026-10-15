import { Component, ElementRef, QueryList, ViewChildren, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SessionService } from './session.service';
import { TubeStepUpComponent } from './mfa/tube-step-up.component';

interface TubeNavItem {
  path: string;
  label: string;
  /** accessibleName — the screen-reader announce for the link. */
  aria: string;
  /** the inline help text (sighted) linked via aria-describedby (no-sight). */
  help: string;
  show: () => boolean;
}

/**
 * The tube console shell — a role-aware menubar (roving tabindex, WAI-ARIA APG)
 * over the role-gated child views, plus the swappable content outlet.
 *
 * The nav items are SHOWN BY ROLE (defence-in-depth; the child guards + the bff
 * are authoritative):
 *   My Tube         (my)      — shown to TUBE_USE (ROLE_TUBE, or an admin/superadmin).
 *   Tube Access     (access)  — shown to TUBE_MANAGE (admin|superadmin).
 *   Storage Budgets (budgets) — shown to TUBE_MANAGE (admin|superadmin).
 * So a granted ROLE_TUBE user sees only My Tube; an ADMIN/SUPERADMIN additionally
 * sees Tube Access + Storage Budgets. A user with NONE of the tube roles sees an
 * empty menubar and the My-Tube read-guard sends them to /tube/forbidden.
 *
 * a11y: <nav role="menubar"> with roving tabindex + Arrow/Home/End keyboard
 * navigation; routerLinkActive marks the current view aria-current="page"; every
 * link carries an accessibleName + an aria-describedby help hint.
 */
@Component({
  selector: 'hug-tube-console',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TubeStepUpComponent],
  templateUrl: './tube-console.component.html',
  styleUrl: './tube-console.component.scss',
})
export class TubeConsoleComponent {
  private readonly session = inject(SessionService);

  @ViewChildren('navlink') navLinks!: QueryList<ElementRef<HTMLAnchorElement>>;

  /** Index of the roving-tabindex'd item that currently holds tabindex=0. */
  active = 0;

  readonly items: TubeNavItem[] = [
    {
      path: 'my',
      label: 'My Tube',
      aria: 'My Tube — subscriptions, download queue, and viewing',
      help: 'Your subscribed channels, your download queue, your storage usage, and in-platform viewing of completed downloads.',
      show: () => this.session.canUse(),
    },
    {
      path: 'access',
      label: 'Tube Access',
      aria: 'Tube access — grant, time out, ban, restore',
      help: 'Grant a user Tube access, time them out, ban them, or restore access. Requires the admin or superadmin role.',
      show: () => this.session.canManage(),
    },
    {
      path: 'budgets',
      label: 'Storage Budgets',
      aria: 'Storage budgets — set a per-user download budget',
      help: 'Set a per-user download storage budget (bytes) and review current usage. Requires the admin or superadmin role.',
      show: () => this.session.canManage(),
    },
  ];

  /** The items actually rendered for this role. */
  visibleItems(): TubeNavItem[] {
    return this.items.filter((i) => i.show());
  }

  /** Roving-tabindex helper — only the active item is tabbable; the rest are -1
   *  and reached with Arrow keys (WAI-ARIA menubar pattern). */
  tabindexFor(i: number): number {
    return i === this.active ? 0 : -1;
  }

  /** Arrow/Home/End keyboard navigation across the menubar. */
  onKey(event: KeyboardEvent, i: number): void {
    const count = this.visibleItems().length;
    if (count === 0) return;
    let next = i;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (i + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (i - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.active = next;
    const links = this.navLinks?.toArray() ?? [];
    links[next]?.nativeElement.focus();
  }
}
