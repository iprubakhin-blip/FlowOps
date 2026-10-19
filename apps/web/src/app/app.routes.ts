import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';
import { DashboardComponent } from './dashboard.component';
import { LoginComponent } from './login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
