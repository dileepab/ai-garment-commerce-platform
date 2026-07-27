import { Prisma, type Customer } from '@prisma/client';
import prisma from '@/lib/prisma';
import { preferStoredMetaProfileName } from '@/lib/meta-profile';

interface MetaCustomerProfileInput {
  senderId: string;
  channel: string;
  brand?: string | null;
  displayName: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function updateExistingCustomer(
  customer: Customer,
  params: MetaCustomerProfileInput
): Promise<Customer> {
  const name = preferStoredMetaProfileName(customer.name, params.displayName);
  const update: Prisma.CustomerUpdateInput = {};

  if (name && name !== customer.name) update.name = name;
  if (!customer.channel) update.channel = params.channel;
  if (!customer.preferredBrand && params.brand) update.preferredBrand = params.brand;

  return Object.keys(update).length > 0
    ? prisma.customer.update({ where: { id: customer.id }, data: update })
    : customer;
}

export async function persistMetaCustomerProfile(
  params: MetaCustomerProfileInput
): Promise<Customer | null> {
  const displayName = preferStoredMetaProfileName(null, params.displayName);

  if (!params.senderId.trim() || !displayName) return null;

  const existingCustomer = await prisma.customer.findUnique({
    where: { externalId: params.senderId },
  });

  if (existingCustomer) {
    return updateExistingCustomer(existingCustomer, { ...params, displayName });
  }

  try {
    return await prisma.customer.create({
      data: {
        externalId: params.senderId,
        name: displayName,
        channel: params.channel,
        preferredBrand: params.brand || null,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const racedCustomer = await prisma.customer.findUnique({
      where: { externalId: params.senderId },
    });

    return racedCustomer
      ? updateExistingCustomer(racedCustomer, { ...params, displayName })
      : null;
  }
}
