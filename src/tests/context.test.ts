import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LocalUserContextService } from '../services/context.js';
import { UserContextService } from '../interfaces/types.js';

describe('UserContextService — default (anonymous) implementation', () => {
  it('getCurrentUser() returns null for anonymous users', () => {
    const svc = new LocalUserContextService();
    assert.equal(svc.getCurrentUser(), null);
  });

  it('is assignable to the UserContextService contract', () => {
    const svc: UserContextService = new LocalUserContextService();
    assert.equal(typeof svc.getCurrentUser, 'function');
    assert.equal(svc.getCurrentUser(), null);
  });
});
