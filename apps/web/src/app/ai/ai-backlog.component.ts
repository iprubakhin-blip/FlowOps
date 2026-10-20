import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError, finalize, take } from 'rxjs';
import { MAX_DESCRIPTION_LENGTH } from '../models/task';
import { TasksService } from '../services/tasks.service';
import { AiClient } from './ai.client';
import {
  buildBulkBody,
  buildGenerateBody,
  draftsFromResponse,
  emptyLocalDraft,
  firstInvalidDraftError,
  validateRequirements,
  validateTeam,
} from './ai.drafts';
import { aiGenerateErrorMessage, bulkCreateErrorMessage } from './ai.errors';
import { MIN_REQUIREMENTS_LENGTH, SUGGESTED_TEAMS, type AiCapabilities, type AiDraftResponse, type LocalAiDraft } from './ai.models';

@Component({
  selector: 'app-ai-backlog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-backlog.component.html',
  styleUrl: './ai-backlog.component.css',
})
export class AiBacklogComponent {
  readonly store = inject(TasksService);
  private readonly ai = inject(AiClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly capabilities = signal<AiCapabilities | null>(null);
  readonly capsError = signal<string | null>(null);
  readonly generateError = signal<string | null>(null);
  readonly persistError = signal<string | null>(null);
  readonly persistSuccess = signal<string | null>(null);
  readonly generating = signal(false);
  readonly drafts = signal<LocalAiDraft[]>([]);
  readonly warnings = signal<string[]>([]);
  readonly lastResponse = signal<AiDraftResponse | null>(null);
  readonly consentChecked = signal(false);
  readonly maxDescription = MAX_DESCRIPTION_LENGTH;
  readonly minRequirements = MIN_REQUIREMENTS_LENGTH;
  readonly suggestedTeams = SUGGESTED_TEAMS;
  readonly requirements = signal('');
  readonly team = signal('Frontend');

  readonly mockMode = computed(() => this.capabilities()?.provider === 'mock');
  readonly consentRequired = computed(() => this.capabilities()?.externalProcessingRequired === true);
  readonly canGenerate = computed(() => {
    const caps = this.capabilities();
    if (!caps?.enabled || this.generating() || this.store.saving()) return false;
    if (this.consentRequired() && !this.consentChecked()) return false;
    if (validateRequirements(this.requirements(), caps.maxRequirementsChars)) return false;
    if (validateTeam(this.team())) return false;
    return true;
  });
  readonly createBlockedReason = computed(() => firstInvalidDraftError(this.team(), this.drafts()));
  readonly canCreate = computed(() => !this.store.saving() && !this.generating() && this.createBlockedReason() === null);

  constructor() {
    this.reloadCapabilities();
  }

  reloadCapabilities(): void {
    this.capsError.set(null);
    this.ai.capabilities().pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef),
      catchError((error: unknown) => {
        this.capabilities.set(null);
        this.capsError.set(aiGenerateErrorMessage(error));
        return EMPTY;
      }),
    ).subscribe((caps) => {
      this.capabilities.set(caps);
      if (!caps.externalProcessingRequired) this.consentChecked.set(false);
    });
  }

  generate(): void {
    if (!this.canGenerate()) return;
    const caps = this.capabilities();
    if (!caps) return;
    const inputError = validateRequirements(this.requirements(), caps.maxRequirementsChars);
    if (inputError) {
      this.generateError.set(inputError);
      return;
    }
    const teamError = validateTeam(this.team());
    if (teamError) {
      this.generateError.set(teamError);
      return;
    }
    this.generating.set(true);
    this.generateError.set(null);
    this.persistError.set(null);
    this.persistSuccess.set(null);
    const body = buildGenerateBody(this.requirements(), this.team(), this.consentRequired() && this.consentChecked());
    this.ai.generateDrafts(body).pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.generating.set(false)),
    ).subscribe({
      next: (response) => {
        this.lastResponse.set(response);
        this.warnings.set(response.warnings);
        this.drafts.set(draftsFromResponse(response));
        this.team.set(response.team || this.team());
      },
      error: (error: unknown) => this.generateError.set(aiGenerateErrorMessage(error)),
    });
  }

  updateDraft(localId: string, patch: Partial<LocalAiDraft>): void {
    this.drafts.update((rows) => rows.map((row) => (row.localId === localId ? { ...row, ...patch, localId: row.localId } : row)));
  }

  removeDraft(localId: string): void {
    this.drafts.update((rows) => rows.filter((row) => row.localId !== localId));
  }

  addDraft(): void {
    const max = this.capabilities()?.maxDrafts ?? 10;
    if (this.drafts().length >= max) return;
    this.drafts.update((rows) => [...rows, emptyLocalDraft()]);
  }

  discardDrafts(): void {
    this.drafts.set([]);
    this.warnings.set([]);
    this.lastResponse.set(null);
    this.persistSuccess.set(null);
    this.persistError.set(null);
  }

  createTasks(): void {
    if (!this.canCreate() || this.store.saving()) return;
    const body = buildBulkBody(this.team(), this.drafts());
    if ('error' in body) {
      this.persistError.set(body.error);
      return;
    }
    this.persistError.set(null);
    this.persistSuccess.set(null);
    this.store.createBulk(body, (createdCount) => {
      this.persistSuccess.set(createdMessage(createdCount, this.store.query().search, this.store.query().status));
      this.drafts.set([]);
      this.warnings.set([]);
      this.lastResponse.set(null);
    }, (error) => {
      this.persistError.set(bulkCreateErrorMessage(error));
    });
  }
}

export function createdMessage(createdCount: number, search?: string, status?: string): string {
  const base = `Created ${createdCount} task${createdCount === 1 ? '' : 's'}.`;
  if (search || status) {
    return `${base} They may be hidden by the current search or filters.`;
  }
  return base;
}
