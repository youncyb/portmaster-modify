import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { AppBandwidthBarRow } from '@safing/portmaster-api';

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
  prepared: PreparedRow[] = [];
  maxTotal = 1;

  @Input()
  set data(value: AppBandwidthBarRow[] | null | undefined) {
    const rows = (value || [])
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

    this.maxTotal = Math.max(1, ...rows.map((r) => r.total));
    this.prepared = rows.map((row) => ({
      ...row,
      incomingPct: (row.incoming / this.maxTotal) * 100,
      outgoingPct: (row.outgoing / this.maxTotal) * 100,
    }));
  }
}
