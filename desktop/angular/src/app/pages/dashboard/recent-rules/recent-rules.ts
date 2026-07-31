import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit, TrackByFunction, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  AppProfile,
  AppProfileService,
  deepClone,
  getAppSetting,
  setAppSetting,
} from '@safing/portmaster-api';
import { firstValueFrom } from 'rxjs';
import { ActionIndicatorService } from 'src/app/shared/action-indicator';

export type RuleDirection = 'out' | 'in';
export type RuleAction = 'allow' | 'block' | 'prompt';

export interface RecentRuleRow {
  id: string;
  profileSource: string;
  profileID: string;
  profileName: string;
  profileKey: string;
  direction: RuleDirection;
  configKey: 'filter/endpoints' | 'filter/serviceEndpoints';
  ruleIndex: number;
  rule: string;
  action: 'allow' | 'block';
  entity: string;
  comment: string;
  lastEdited: number;
}

@Component({
  selector: 'app-recent-rules',
  templateUrl: './recent-rules.html',
  styleUrls: ['./recent-rules.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentRulesComponent implements OnInit {
  private readonly profiles = inject(AppProfileService);
  private readonly uai = inject(ActionIndicatorService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  rows: RecentRuleRow[] = [];
  loading = true;
  limit = 30;

  editing: RecentRuleRow | null = null;
  editAction: RuleAction = 'allow';
  editEntity = '';
  saving = false;

  readonly trackRow: TrackByFunction<RecentRuleRow> = (_, r) => r.id;

  ngOnInit(): void {
    this.profiles.watchProfiles()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.rows = this.buildRows(list || []);
          this.loading = false;
          // Keep editor in sync if profile still exists
          if (this.editing) {
            const still = this.rows.find((r) => r.id === this.editing!.id);
            if (!still) {
              this.cancelEdit();
            } else {
              this.editing = still;
            }
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  startEdit(row: RecentRuleRow) {
    this.editing = row;
    this.editAction = row.action;
    this.editEntity = row.entity;
    this.cdr.markForCheck();
  }

  cancelEdit() {
    this.editing = null;
    this.editEntity = '';
    this.saving = false;
    this.cdr.markForCheck();
  }

  applyZoneDomain() {
    const zone = toZoneDomain(this.editEntity);
    if (zone) {
      this.editEntity = zone;
      this.cdr.markForCheck();
    }
  }

  applyExactDomain() {
    const exact = toExactDomain(this.editEntity);
    if (exact) {
      this.editEntity = exact;
      this.cdr.markForCheck();
    }
  }

  applyPrefixWildcard() {
    const v = this.editEntity.trim().replace(/^\.+/, '').replace(/\.+$/, '');
    if (!v) {
      return;
    }
    // example.com -> example.*
    const parts = v.replace(/^\*/, '').split('.').filter(Boolean);
    if (parts.length >= 1) {
      this.editEntity = `${parts[0]}.*`;
      this.cdr.markForCheck();
    }
  }

  openApp(row: RecentRuleRow) {
    this.router.navigate(['/app', row.profileSource, row.profileID], {
      queryParams: {
        setting: row.configKey,
      },
    });
  }

  async saveEdit() {
    if (!this.editing || this.saving) {
      return;
    }

    const entity = this.editEntity.trim();
    if (this.editAction !== 'prompt' && !entity) {
      this.uai.error('Invalid rule', 'Host / domain / IP cannot be empty.');
      return;
    }

    this.saving = true;
    const target = this.editing;
    const action = this.editAction;

    try {
      const profile = await firstValueFrom(
        this.profiles.getAppProfile(target.profileSource, target.profileID),
      );
      const updated = deepClone(profile) as AppProfile;
      if (!updated.Config) {
        updated.Config = {};
      }

      let rules = [...(getAppSetting<string[]>(updated.Config, target.configKey) || [])];
      const idx = rules.findIndex((r) => r === target.rule);
      if (idx < 0 && !(target.ruleIndex >= 0 && target.ruleIndex < rules.length)) {
        throw new Error('The rule may have been changed already.');
      }

      const at = idx >= 0 ? idx : target.ruleIndex;

      if (action === 'prompt') {
        // Remove explicit allow/block so default action (ask) can apply.
        rules.splice(at, 1);
      } else {
        const prefix = action === 'block' ? '-' : '+';
        const newRule = `${prefix} ${entity}`;
        rules.splice(at, 1);
        // Put updated rule at top so it takes precedence and appears as recent.
        rules = [newRule, ...rules.filter((r) => r !== newRule)];
      }

      setAppSetting(updated.Config, target.configKey, rules);
      await firstValueFrom(this.profiles.saveProfile(updated));

      this.saving = false;
      this.cancelEdit();
      this.uai.success(
        'Rules Updated',
        action === 'prompt'
          ? 'Rule removed; unmatched traffic may prompt (default action).'
          : 'Rule saved successfully.',
      );
    } catch (err) {
      this.saving = false;
      this.uai.error('Failed to update rules', this.stringifyErr(err));
      this.cdr.markForCheck();
    }
  }

  deleteRule(row: RecentRuleRow) {
    this.editing = row;
    this.editAction = 'prompt';
    this.editEntity = row.entity;
    void this.saveEdit();
  }

  private buildRows(profiles: AppProfile[]): RecentRuleRow[] {
    const out: RecentRuleRow[] = [];

    for (const p of profiles) {
      if (!p || p.Internal) {
        continue;
      }
      const lastEdited = Number(p.LastEdited) || Number(p.Created) || 0;
      const source = p.Source || 'local';
      const name = p.Name || p.ID;

      this.collectRules(out, p, source, name, lastEdited, 'out', 'filter/endpoints');
      this.collectRules(out, p, source, name, lastEdited, 'in', 'filter/serviceEndpoints');
    }

    // Prefer recently edited apps; within an app, list order is top-first (often newest).
    out.sort((a, b) => {
      if (b.lastEdited !== a.lastEdited) {
        return b.lastEdited - a.lastEdited;
      }
      return a.ruleIndex - b.ruleIndex;
    });

    return out.slice(0, this.limit);
  }

  private collectRules(
    out: RecentRuleRow[],
    p: AppProfile,
    source: string,
    name: string,
    lastEdited: number,
    direction: RuleDirection,
    configKey: 'filter/endpoints' | 'filter/serviceEndpoints',
  ) {
    const rules = getAppSetting<string[]>(p.Config, configKey) || [];
    rules.forEach((rule, ruleIndex) => {
      const parsed = parseEndpointRule(rule);
      if (!parsed) {
        return;
      }
      out.push({
        id: `${source}/${p.ID}:${configKey}:${ruleIndex}:${rule}`,
        profileSource: source,
        profileID: p.ID,
        profileName: name,
        profileKey: `${source}/${p.ID}`,
        direction,
        configKey,
        ruleIndex,
        rule,
        action: parsed.action,
        entity: parsed.entity,
        comment: parsed.comment,
        lastEdited,
      });
    });
  }

  private stringifyErr(err: any): string {
    if (!err) {
      return 'unknown error';
    }
    if (typeof err === 'string') {
      return err;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
}

export function parseEndpointRule(rule: string): { action: 'allow' | 'block'; entity: string; comment: string } | null {
  const raw = (rule || '').trim();
  if (!raw) {
    return null;
  }

  let comment = '';
  let body = raw;
  const hash = raw.indexOf('#');
  if (hash >= 0) {
    comment = raw.slice(hash + 1).trim();
    body = raw.slice(0, hash).trim();
  }

  const m = body.match(/^([+-])\s+(.+)$/);
  if (!m) {
    return null;
  }

  return {
    action: m[1] === '-' ? 'block' : 'allow',
    entity: m[2].trim(),
    comment,
  };
}

/** Convert host-like entity to zone form (.example.com) covering subdomains. */
export function toZoneDomain(entity: string): string | null {
  let host = extractHost(entity);
  if (!host) {
    return null;
  }
  host = host.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host || host.includes('/') || host.includes('*') || host.includes(':')) {
    // Keep simple: skip IP/CIDR/wildcards already set
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes('/')) {
      return null;
    }
  }
  // Take registrable-ish domain: last two labels (good enough without PSL)
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 2) {
    const base = labels.slice(-2).join('.');
    return `.${base}`;
  }
  return `.${host}`;
}

export function toExactDomain(entity: string): string | null {
  let host = extractHost(entity);
  if (!host) {
    return null;
  }
  host = host.replace(/^\.+/, '').replace(/\.+$/, '').replace(/^\*+/, '').replace(/\*+$/, '');
  if (!host) {
    return null;
  }
  return host;
}

function extractHost(entity: string): string | null {
  if (!entity) {
    return null;
  }
  // Strip optional proto/port suffix: "example.com TCP/443"
  const part = entity.trim().split(/\s+/)[0];
  if (!part || part === '*' || part.startsWith('L:') || part.startsWith('AS') || part.startsWith('C:')) {
    return null;
  }
  if (['LAN', 'Internet', 'Localhost'].includes(part)) {
    return null;
  }
  return part;
}
