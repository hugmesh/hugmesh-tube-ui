import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { isStepUpRequiredError, STEP_UP_SIGNAL_HEADER } from './step-up-error';

function res(status: number, headers: Record<string, string> = {}, body: unknown = null): HttpErrorResponse {
  return new HttpErrorResponse({ status, headers: new HttpHeaders(headers), error: body });
}

describe('isStepUpRequiredError (the gateway X-Step-Up-Required signal)', () => {
  it('names the header the gateway sends', () => {
    expect(STEP_UP_SIGNAL_HEADER).toBe('X-Step-Up-Required');
  });

  it('recognises a 403 carrying the gateway value X-Mfa-StepUp', () => {
    expect(isStepUpRequiredError(res(403, { 'X-Step-Up-Required': 'X-Mfa-StepUp' }))).toBeTrue();
  });

  it('recognises any well-formed X-<flavour>-StepUp value (the platform shape)', () => {
    expect(isStepUpRequiredError(res(403, { 'X-Step-Up-Required': 'X-ImageGen-StepUp' }))).toBeTrue();
  });

  it('matches the header name case-insensitively, as HTTP does', () => {
    expect(isStepUpRequiredError(res(403, { 'x-step-up-required': 'X-Mfa-StepUp' }))).toBeTrue();
  });

  it('an ordinary 403 (role denial, X-Route-Denied only) is NOT a step-up', () => {
    expect(isStepUpRequiredError(res(403, { 'X-Route-Denied': 'hugmesh-fe-gateway:/bff/tube/admin/access/grant' }))).toBeFalse();
  });

  it('the header on a status other than 403 is ignored', () => {
    for (const status of [200, 401, 404, 428, 500, 503]) {
      expect(isStepUpRequiredError(res(status, { 'X-Step-Up-Required': 'X-Mfa-StepUp' })))
        .withContext(`status ${status}`).toBeFalse();
    }
  });

  it('a malformed or hostile value is ignored rather than trusted', () => {
    for (const bad of ['', 'true', 'Mfa', 'X-Mfa', 'X--StepUp', 'X-Mfa-StepUp, X-Other-StepUp', 'X-Mfa StepUp', 'x-mfa-stepup', 'X-' + 'a'.repeat(61) + '-StepUp']) {
      expect(isStepUpRequiredError(res(403, { 'X-Step-Up-Required': bad })))
        .withContext(`value ${JSON.stringify(bad)}`).toBeFalse();
    }
  });

  it('the legacy free-text phrase alone is NOT a signal (Tube has no such BFF)', () => {
    expect(isStepUpRequiredError(res(403, {}, { error: 'grant requires step-up re-authentication' }))).toBeFalse();
  });

  it('anything that is not an HttpErrorResponse is not a step-up', () => {
    expect(isStepUpRequiredError(new Error('requires step-up'))).toBeFalse();
    expect(isStepUpRequiredError(null)).toBeFalse();
    expect(isStepUpRequiredError(undefined)).toBeFalse();
    expect(isStepUpRequiredError({ status: 403 })).toBeFalse();
  });
});
