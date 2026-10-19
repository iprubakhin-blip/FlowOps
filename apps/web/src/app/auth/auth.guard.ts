import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';
import { safeReturnUrl } from './auth.session';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const decide = () => {
    if (auth.authenticated()) return true;
    const returnUrl = safeReturnUrl(state.url);
    return router.createUrlTree(
      ['/login'],
      returnUrl === '/' ? undefined : { queryParams: { returnUrl } },
    );
  };
  if (auth.initialized()) return decide();
  return auth.whenReady().pipe(map(decide));
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const decide = () => (auth.authenticated() ? router.createUrlTree(['/']) : true);
  if (auth.initialized()) return decide();
  return auth.whenReady().pipe(map(decide));
};
