import { TestBed } from '@angular/core/testing';
import { StepUpService } from './step-up.service';

describe('StepUpService', () => {
  let svc: StepUpService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(StepUpService);
  });

  it('shows the prompt with the action and settles true when satisfied', async () => {
    const p = svc.challenge('Banning a user');
    expect(svc.request()).toEqual({ action: 'Banning a user' });
    svc.resolve(true);
    expect(await p).toBeTrue();
    expect(svc.request()).toBeNull();
  });

  it('settles false when dismissed', async () => {
    const p = svc.challenge('Banning a user');
    svc.resolve(false);
    expect(await p).toBeFalse();
    expect(svc.request()).toBeNull();
  });

  it('a second challenge while one is open shares the SAME answer and does not stack a prompt', async () => {
    const first = svc.challenge('Granting Tube access');
    const second = svc.challenge('Banning a user');
    expect(second).toBe(first);
    expect(svc.request()).toEqual({ action: 'Granting Tube access' });
    svc.resolve(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
  });

  it('can prompt again after the previous prompt closed', async () => {
    const a = svc.challenge('one');
    svc.resolve(false);
    await a;
    const b = svc.challenge('two');
    expect(svc.request()).toEqual({ action: 'two' });
    svc.resolve(true);
    expect(await b).toBeTrue();
  });

  it('resolve with nothing pending is a harmless no-op', () => {
    expect(() => svc.resolve(true)).not.toThrow();
    expect(svc.request()).toBeNull();
  });
});
