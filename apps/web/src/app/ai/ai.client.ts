import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { AiCapabilities, AiDraftResponse } from './ai.models';

@Injectable({ providedIn: 'root' })
export class AiClient {
  private readonly http = inject(HttpClient);

  capabilities(): Observable<AiCapabilities> {
    return this.http.get<AiCapabilities>('/api/ai/capabilities');
  }

  generateDrafts(body: {
    requirements: string;
    team: string;
    allowExternalProcessing: boolean;
  }): Observable<AiDraftResponse> {
    return this.http.post<AiDraftResponse>('/api/ai/task-drafts', body);
  }
}
