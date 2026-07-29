import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, inject } from '@angular/core';
import { AppBandwidthBarRow, AppBandwidthTotals } from '@safing/portmaster-api';

interface PreparedRow extends AppBandwidthBarRow {
  label: string;
  total: number;
  incomingPct: number;
  outgoingPct: number;
}

@Component({
  selector: 'sfng-netquery-app-bandwidth-bar',
  templateUrl: './app-bandwidth-bar.html',
  styleUrls: ['./app-bandwidth-bar.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SfngNetqueryAppBandwidthBarComponent {
  private readonly cdr = inject(ChangeDetectorRef);

  prepared: PreparedRow[] = [];
  totals: AppBandwidthTotals = { incoming: 0, outgoing: 0 };
  maxTotal = 1;

  @Input()
  set data(value: AppBandwidthBarRow[] | null | undefined) {
    this.applyRows(value || []);
  }

  @Input()
  set periodTotals(value: AppBandwidthTotals | null | undefined) {
    this.totals = {
      incoming: Number(value?.incoming) || 0,
      outgoing: Number(value?.outgoing) || 0,
    };
    this.cdr.markForCheck();
  }

  private applyRows(value: AppBandwidthBarRow[]) {
    const rows = value
      .map((row) => {
        const incoming = Number(row.incoming) || 0;
        const outgoing = Number(row.outgoing) || 0;
        return {
          ...row,
          incoming,
          outgoing,
          label: row.profile_name || row.profile || 'Unknown',
          total: incoming + outgoing,
          incomingPct: 0,
          outgoingPct: 0,
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);

    const maxDir = Math.max(
      1,
      ...rows.map((r) => r.incoming),
      ...rows.map((r) => r.outgoing),
    );
    this.maxTotal = Math.max(1, ...rows.map((r) => r.total));
    this.prepared = rows.map((row) => ({
      ...row,
      incomingPct: Math.max(row.incoming > 0 ? 2 : 0, (row.incoming / maxDir) * 100),
      outgoingPct: Math.max(row.outgoing > 0 ? 2 : 0, (row.outgoing / maxDir) * 100),
    }));
    this.cdr.markForCheck();
  }
}
