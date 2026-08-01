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

/**
 * Per-rule timestamps as JSON string on profile Config.
 * Survives in core DB under Config.filter.ruleEditTimesJson.
 */
export const RULE_EDIT_TIMES_KEY = 'filter/ruleEditTimesJson';

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
  /** Effective display time (unix seconds) */
  ruleEdited: number;
  /** true when time comes from per-rule stamp; false when from profile DB modified */
  hasRuleTimestamp: boolean;
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
  limit = 40;

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
          if (this.editing) {
            const still = this.rows.find((r) =>
              r.profileKey === this.editing!.profileKey
              && r.configKey === this.editing!.configKey
              && r.entity === this.editing!.entity
              && r.action === this.editing!.action,
            ) || this.rows.find((r) => r.id === this.editing!.id);
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
      const now = Math.floor(Date.now() / 1000);
      // Profile DB modified time BEFORE this save — freeze unstamped sibling rules to it.
      const prevProfileTs = profileDBTime(profile);

      const times = readRuleEditTimes(updated);
      // Freeze existing rules that have no stamp yet, so only the edited rule jumps to "now".
      freezeUnstampedRules(times, updated, prevProfileTs);
      delete times[ruleTimeKey(target.configKey, target.action, target.entity)];

      if (action === 'prompt') {
        rules.splice(at, 1);
      } else {
        const prefix = action === 'block' ? '-' : '+';
        const newRule = `${prefix} ${entity}`;
        rules.splice(at, 1);
        rules = [newRule, ...rules.filter((r) => normalizeRuleBody(r) !== normalizeRuleBody(newRule))];
        times[ruleTimeKey(target.configKey, action, entity)] = now;
      }

      setAppSetting(updated.Config, target.configKey, rules);

      // Keep only timestamps for rules that still exist.
      const alive = collectAliveRuleKeys(updated);
      for (const k of Object.keys(times)) {
        if (!alive.has(k)) {
          delete times[k];
        }
      }
      writeRuleEditTimes(updated.Config, times);

      // Ensure JSON LastEdited is also updated (some UIs read this).
      updated.LastEdited = now;

      await firstValueFrom(this.profiles.saveProfile(updated));

      this.saving = false;
      this.cancelEdit();
      this.uai.success(
        'Rules Updated',
        action === 'prompt'
          ? 'Rule removed; unmatched traffic may prompt (default action).'
          : 'Rule saved successfully.',
      );
      // watchProfiles will push updated list with new _meta.Modified + ruleEditTimesJson
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
      const source = p.Source || 'local';
      const name = p.Name || p.ID;
      const times = readRuleEditTimes(p);
      const dbTs = profileDBTime(p);

      this.collectRules(out, p, source, name, times, dbTs, 'out', 'filter/endpoints');
      this.collectRules(out, p, source, name, times, dbTs, 'in', 'filter/serviceEndpoints');
    }

    out.sort((a, b) => {
      if (b.ruleEdited !== a.ruleEdited) {
        return b.ruleEdited - a.ruleEdited;
      }
      const nameCmp = a.profileName.localeCompare(b.profileName);
      if (nameCmp !== 0) {
        return nameCmp;
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
    times: Record<string, number>,
    dbTs: number,
    direction: RuleDirection,
    configKey: 'filter/endpoints' | 'filter/serviceEndpoints',
  ) {
    const rules = getAppSetting<string[]>(p.Config, configKey) || [];
    rules.forEach((rule, ruleIndex) => {
      const parsed = parseEndpointRule(rule);
      if (!parsed) {
        return;
      }

      const key = ruleTimeKey(configKey, parsed.action, parsed.entity);
      const stamped = Number(times[key]) || parsed.timestamp || 0;
      // Prefer per-rule stamp; otherwise use profile DB modified/created time.
      const ruleEdited = stamped > 0 ? stamped : dbTs;
      const hasRuleTimestamp = stamped > 0;

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
        ruleEdited,
        hasRuleTimestamp,
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

/** Profile last-write time from core DB (PortAPI _meta) or profile fields. */
export function profileDBTime(profile: AppProfile): number {
  const metaMod = Number(profile._meta?.Modified) || 0;
  const metaCreated = Number(profile._meta?.Created) || 0;
  const lastEdited = Number(profile.LastEdited) || 0;
  const created = Number(profile.Created) || 0;
  return metaMod || lastEdited || metaCreated || created || 0;
}

export function ruleTimeKey(
  configKey: string,
  action: 'allow' | 'block',
  entity: string,
): string {
  const prefix = action === 'block' ? '-' : '+';
  return `${configKey}|${prefix}|${entity.trim()}`;
}

export function readRuleEditTimes(profile: AppProfile): Record<string, number> {
  const raw = getAppSetting<string>(profile.Config, RULE_EDIT_TIMES_KEY);
  if (!raw || typeof raw !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) {
        out[k] = n;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRuleEditTimes(config: NonNullable<AppProfile['Config']>, times: Record<string, number>) {
  setAppSetting(config, RULE_EDIT_TIMES_KEY, JSON.stringify(times || {}));
}

/** Assign prevProfileTs to every live rule that does not yet have a stamp. */
function freezeUnstampedRules(
  times: Record<string, number>,
  profile: AppProfile,
  prevProfileTs: number,
) {
  if (prevProfileTs <= 0) {
    return;
  }
  for (const ck of ['filter/endpoints', 'filter/serviceEndpoints'] as const) {
    const rules = getAppSetting<string[]>(profile.Config, ck) || [];
    for (const rule of rules) {
      const p = parseEndpointRule(rule);
      if (!p) {
        continue;
      }
      const k = ruleTimeKey(ck, p.action, p.entity);
      if (!times[k]) {
        times[k] = prevProfileTs;
      }
    }
  }
}

function collectAliveRuleKeys(profile: AppProfile): Set<string> {
  const alive = new Set<string>();
  for (const ck of ['filter/endpoints', 'filter/serviceEndpoints'] as const) {
    const rules = getAppSetting<string[]>(profile.Config, ck) || [];
    for (const rule of rules) {
      const p = parseEndpointRule(rule);
      if (p) {
        alive.add(ruleTimeKey(ck, p.action, p.entity));
      }
    }
  }
  return alive;
}

export function parseEndpointRule(rule: string): {
  action: 'allow' | 'block';
  entity: string;
  comment: string;
  timestamp: number;
} | null {
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
    timestamp: extractRuleTimestamp(comment),
  };
}

export function normalizeRuleBody(rule: string): string {
  const p = parseEndpointRule(rule);
  if (!p) {
    return (rule || '').trim();
  }
  const prefix = p.action === 'block' ? '-' : '+';
  return `${prefix} ${p.entity}`;
}

export function extractRuleTimestamp(comment: string): number {
  if (!comment) {
    return 0;
  }
  const m = comment.match(/(?:^|\s)(?:pm:)?t(?:s)?=(\d{9,12})(?:\s|$)/);
  if (!m) {
    return 0;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function toZoneDomain(entity: string): string | null {
  let host = extractHost(entity);
  if (!host) {
    return null;
  }
  host = host.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host) {
    return null;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes('/')) {
    return null;
  }
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 2) {
    return `.${labels.slice(-2).join('.')}`;
  }
  return `.${host}`;
}

export function toExactDomain(entity: string): string | null {
  let host = extractHost(entity);
  if (!host) {
    return null;
  }
  host = host.replace(/^\.+/, '').replace(/\.+$/, '').replace(/^\*+/, '').replace(/\*+$/, '');
  return host || null;
}

function extractHost(entity: string): string | null {
  if (!entity) {
    return null;
  }
  const part = entity.trim().split(/\s+/)[0];
  if (!part || part === '*' || part.startsWith('L:') || part.startsWith('AS') || part.startsWith('C:')) {
    return null;
  }
  if (['LAN', 'Internet', 'Localhost'].includes(part)) {
    return null;
  }
  return part;
}
