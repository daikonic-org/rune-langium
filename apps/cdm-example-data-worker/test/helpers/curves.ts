// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { projectFileRevision } from '@rune-langium/project-config';

export async function acquisition(raw = 'synthetic archive A', value = '4.25', captured = '2026-11-14T00:00:00.000Z') {
  return {
    snapshot: {
      schemaVersion: 1 as const,
      series: 'sonia-ois' as const,
      decoder: 'boe-ois-xlsx-v1' as const,
      window: { startDate: '2026-11-02', endDate: '2026-11-09' },
      source: {
        url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip' as const,
        sha256: await projectFileRevision(raw),
        retrievedAt: captured,
        workbooks: [
          { name: 'OIS daily data current month.xlsx', sha256: await projectFileRevision('synthetic workbook') }
        ]
      },
      points: (['instantaneous-forward', 'spot'] as const).flatMap((kind) =>
        (['monthly', 'semiannual'] as const).map((grid) => ({
          date: '2026-11-06',
          kind,
          grid,
          maturityMonths: 12,
          maturityYears: '1',
          sourceValue: value,
          workbook: 'OIS daily data current month.xlsx'
        }))
      )
    },
    archiveBase64: btoa(raw)
  };
}
