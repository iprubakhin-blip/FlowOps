import {
  HttpBackend,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';
import { sharedRefresh } from './auth.refresh';
import { AuthService } from './auth.service';
import { needsCsrfHeader, safeReturnUrl, shouldAttemptRefresh } from './auth.session';

export const AUTH_RETRIED = new HttpContextToken(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const backend = inject(HttpBackend);
  const auth = inject(AuthService, { optional: true });
  const router = inject(Router, { optional: true });
  let outgoing = req.clone({ withCredentials: true });
  if (needsCsrfHeader(outgoing.method, outgoing.url) && !outgoing.headers.has(CSRF_HEADER)) {
    outgoing = outgoing.clone({ setHeaders: { [CSRF_HEADER]: CSRF_HEADER_VALUE } });
  }

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      if (!shouldAttemptRefresh(outgoing.url, outgoing.context.get(AUTH_RETRIED))) {
        return throwError(() => error);
      }
      return sharedRefresh(backend).pipe(
        catchError((refreshError: unknown) => {
          if (isDefinitiveRefreshFailure(refreshError)) {
            expireSession(auth, router);
          }
          return throwError(() => refreshError);
        }),
        switchMap(() => next(outgoing.clone({ context: outgoing.context.set(AUTH_RETRIED, true) }))),
      );
    }),
  );
};

export function isDefinitiveRefreshFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function expireSession(auth: AuthService | null, router: Router | null): void {
  if (!auth?.initialized()) return;
  auth.clearSession();
  if (!router || router.url.startsWith('/login')) return;
  void router.navigate(['/login'], {
    queryParams: { returnUrl: safeReturnUrl(router.url) },
  });
}
