'use client';

import { useTransition } from 'react';
import { dispatchOrder, deliverOrder } from './actions';

export function OrderActionButtons({ orderId, status }: { orderId: number, status: string }) {
  const [isPending, startTransition] = useTransition();

  if (status === 'delivered' || status === 'cancelled') return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {status !== 'dispatched' && (
        <button 
          onClick={() => startTransition(() => {
            dispatchOrder(orderId);
          })}
          disabled={isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? 'Updating...' : 'Mark Dispatched'}
        </button>
      )}
      {status === 'dispatched' && (
        <button 
          onClick={() => startTransition(() => {
            deliverOrder(orderId);
          })}
          disabled={isPending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
        >
          {isPending ? 'Updating...' : 'Mark Delivered'}
        </button>
      )}
    </div>
  );
}
