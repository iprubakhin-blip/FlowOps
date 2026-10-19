import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, ReplaySubject, catchError, finalize, map, of, take, tap, throwError } from 'rxjs';
import { AuthUserResponse, PublicUser } from '../models/user';
import {
  AUTH_LOGIN_URL,
  AUTH_LOGOUT_URL,
  AUTH_ME_URL,
} from './auth.constants';
import { loginErrorMessage, logoutErrorMessage } from './auth.errors';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly currentUser = signal<PublicUser | null>(null);
  readonly loading = signal(false);
  readonly initialized = signal(false);
  readonly error = signal<string | null>(null);
  readonly authenticated = computed(() => this.currentUser() !== null);
  private logoutInFlight = false;
  private readonly ready = new ReplaySubject<boolean>(1);

  restoreSession(): Observable<PublicUser | null> {
    return this.http.get<AuthUserResponse>(AUTH_ME_URL).pipe(
      map((response) => response.user),
      tap((user) => this.currentUser.set(user)),
      catchError(() => {
        this.currentUser.set(null);
        return of(null);
      }),
      finalize(() => this.markReady()),
    );
  }

  whenReady(): Observable<boolean> {
    if (this.initialized()) return of(true);
    return this.ready.pipe(take(1));
  }

  clearSession(): void {
    this.currentUser.set(null);
  }

  login(email: string, password: string): Observable<PublicUser> {
    this.loading.set(true);
    this.error.set(null);
    return this.http.post<AuthUserResponse>(AUTH_LOGIN_URL, { email, password }).pipe(
      map((response) => response.user),
      tap((user) => this.currentUser.set(user)),
      catchError((error: unknown) => {
        this.error.set(loginErrorMessage(error));
        return throwError(() => error);
      }),
      finalize(() => this.loading.set(false)),
    );
  }

  logout(): Observable<{ ok: true }> {
    if (this.logoutInFlight) {
      return throwError(() => new Error('Logout already in progress.'));
    }
    this.logoutInFlight = true;
    this.loading.set(true);
    this.error.set(null);
    return this.http.post<{ ok: true }>(AUTH_LOGOUT_URL, {}).pipe(
      tap(() => this.currentUser.set(null)),
      catchError((error: unknown) => {
        this.error.set(logoutErrorMessage(error));
        return throwError(() => error);
      }),
      finalize(() => {
        this.logoutInFlight = false;
        this.loading.set(false);
      }),
    );
  }

  getCurrentUser(): PublicUser | null {
    return this.currentUser();
  }

  private markReady(): void {
    this.initialized.set(true);
    this.ready.next(true);
  }
}
