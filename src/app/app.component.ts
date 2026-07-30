import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the Tube remote. Only used when this remote is run on
 * its own (`ng serve tube`); in production the hugmesh.systems host federates
 * `./Tube` (TUBE_ROUTES) directly and mounts them at /tube — this shell is not
 * loaded.
 */
@Component({
  selector: 'hug-tube-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
