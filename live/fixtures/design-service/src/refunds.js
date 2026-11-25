import { refundableCents } from './退款规则.js';

export function dispatchRefund(order, gateways) {
  const amount = refundableCents(order.paid, order.refunded);
  const gateway = gateways.get(order.channel);
  if (!gateway) throw new Error('Unknown payment channel');
  return gateway.refund(order.id, amount);
}
