/**
 * A brand template rendered exactly as a customer would receive it.
 *
 * Behind auth, unlike the per-product chart route: this is a preview for whoever
 * is editing the template, and nothing fetches it on a customer's behalf.
 */

import { NextResponse } from 'next/server';
import { accessDeniedResponse, requireApiPermission } from '@/lib/authz';
import { renderSizeChartImage } from '@/lib/size-chart-image';
import { resolveTemplate } from '@/lib/size-chart-store';
import { GARMENT_TYPES, templateLabel } from '@/lib/size-chart-templates';
import type { SizeChartCategory } from '@/lib/size-charts';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireApiPermission('settings:view');
  } catch (error) {
    return accessDeniedResponse(error);
  }

  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand')?.trim() ?? '';
  const type = searchParams.get('type') ?? '';

  if (!GARMENT_TYPES.includes(type as SizeChartCategory)) {
    return new NextResponse('Unknown garment type', { status: 400 });
  }

  const garmentType = type as SizeChartCategory;
  const chart = await resolveTemplate(brand, garmentType);

  return renderSizeChartImage({
    chart,
    brand,
    subtitle: `${templateLabel(garmentType)} — brand template`,
    headers: { 'Cache-Control': 'no-store' },
  });
}
