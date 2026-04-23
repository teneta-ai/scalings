import { UserContext, UserContextService } from '../interfaces/types.js';
/**
 * Anonymous-by-default user context. Returns null until an authenticated
 * implementation is wired in. Exists so UI components can depend on the
 * UserContextService interface today and get real identity — id, email,
 * team — later for free, enabling future team and permission scoping.
 */
export declare class LocalUserContextService implements UserContextService {
    getCurrentUser(): UserContext | null;
}
