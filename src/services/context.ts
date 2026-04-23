// ============================================================================
// scalings.xyz — User Context Service
// ============================================================================
// Default implementation: no auth, every caller is anonymous.
// Swap for an auth-backed implementation in factory.ts when sign-in lands —
// no UI or other service needs to change.

import { UserContext, UserContextService } from '../interfaces/types.js';

/**
 * Anonymous-by-default user context. Returns null until an authenticated
 * implementation is wired in. Exists so UI components can depend on the
 * UserContextService interface today and get real identity — id, email,
 * team — later for free, enabling future team and permission scoping.
 */
export class LocalUserContextService implements UserContextService {
  getCurrentUser(): UserContext | null {
    return null;
  }
}
