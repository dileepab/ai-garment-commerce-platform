'use server';

import { revalidatePath } from 'next/cache';
import { assertBrandAccess, isAuthorizationError, requireActionPermission } from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';
import { normalizeBrandKey } from '@/lib/brand-aliases';
import { resetTemplate, saveTemplate } from '@/lib/size-chart-store';
import { GARMENT_TYPES, normalizeChartInput, templateLabel } from '@/lib/size-chart-templates';
import type { SizeChartCategory } from '@/lib/size-charts';

export interface TemplateActionResult {
  success: boolean;
  error?: string;
}

function readGarmentType(value: string): SizeChartCategory | null {
  return GARMENT_TYPES.includes(value as SizeChartCategory) ? (value as SizeChartCategory) : null;
}

export async function saveSizeChartTemplateAction(
  brand: string,
  chartInput: unknown,
): Promise<TemplateActionResult> {
  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand);

    if (!normalizeBrandKey(brand)) {
      return { success: false, error: 'Pick a brand before saving a template.' };
    }

    // Columns come from the garment type's own vocabulary, never from the
    // payload, so a form post cannot introduce or rename one.
    const chart = normalizeChartInput(chartInput);
    if (!chart) return { success: false, error: 'That size chart could not be read.' };
    if (chart.rows.length === 0) {
      return { success: false, error: 'A template needs at least one size.' };
    }

    await saveTemplate(brand, chart);
    await logAdminAudit({
      action: 'size_chart_template_save',
      summary: `Saved the ${templateLabel(chart.garmentType)} size chart template for ${brand}.`,
      brand,
    });

    revalidatePath('/settings/size-charts');
    return { success: true };
  } catch (error) {
    if (isAuthorizationError(error)) return { success: false, error: 'Access denied.' };
    return { success: false, error: 'Could not save the template. Please retry.' };
  }
}

export async function resetSizeChartTemplateAction(
  brand: string,
  garmentType: string,
): Promise<TemplateActionResult> {
  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand);

    const type = readGarmentType(garmentType);
    if (!type) return { success: false, error: 'Unknown garment type.' };

    await resetTemplate(brand, type);
    await logAdminAudit({
      action: 'size_chart_template_reset',
      summary: `Reset the ${templateLabel(type)} size chart template for ${brand} to the built-in defaults.`,
      brand,
    });

    revalidatePath('/settings/size-charts');
    return { success: true };
  } catch (error) {
    if (isAuthorizationError(error)) return { success: false, error: 'Access denied.' };
    return { success: false, error: 'Could not reset the template. Please retry.' };
  }
}
