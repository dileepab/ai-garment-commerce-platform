import { NextResponse } from 'next/server';
import { getCurrentUserScope } from '@/lib/authz';
import { getAvailableBrands } from '@/lib/available-brands';
import { getErrorMessage } from '@/lib/error-message';

export const dynamic = 'force-dynamic';

// Returns the brands the signed-in user may switch between. Used by the global
// brand switcher to populate the dropdown for owner/admin (all-brands) users.
export async function GET() {
  try {
    const scope = await getCurrentUserScope();
    if (!scope) {
      return NextResponse.json({ brands: [], error: 'Unauthorized' }, { status: 401 });
    }

    const brands = await getAvailableBrands(scope);
    return NextResponse.json({ brands });
  } catch (error: unknown) {
    return NextResponse.json({ brands: [], error: getErrorMessage(error) }, { status: 500 });
  }
}
