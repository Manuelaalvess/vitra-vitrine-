import { formatBRL, onlyDigits } from "./format";

interface WhatsAppReservationParams {
  phone: string;
  storeName: string;
  customerName: string;
  items: { name: string; quantity: number; price_cents: number }[];
  totalCents: number;
  code: string;
  expiresAt?: string;
}

// Template único da mensagem de reserva, usado tanto no checkout
// (cart-drawer) quanto na página /reserva/$code — pra cliente ver sempre a
// mesma mensagem, seja de onde clicar.
export function buildWhatsAppMessage(params: WhatsAppReservationParams): string {
  const firstName = params.customerName.trim().split(" ")[0] || params.customerName;
  const lines = params.items.map(
    (i) =>
      `• ${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""} — ${formatBRL(i.price_cents * i.quantity)}`,
  );
  const expiresLabel = params.expiresAt
    ? new Date(params.expiresAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    `Oi, ${params.storeName}! Aqui é ${firstName}. 🌿\n\n` +
    `Acabei de reservar:\n` +
    `${lines.join("\n")}\n\n` +
    `Total: ${formatBRL(params.totalCents)}\n` +
    `Código da reserva: ${params.code}\n` +
    (expiresLabel ? `Válida até ${expiresLabel} (24h)\n\n` : `Válida por 24h\n\n`) +
    `Pode me confirmar o Pix e combinarmos a entrega ou retirada? ` +
    `Vou guardar esse código pra acompanhar o pedido.`
  );
}

export function buildWhatsAppUrl(params: WhatsAppReservationParams): string {
  const phone = onlyDigits(params.phone);
  const msg = buildWhatsAppMessage(params);
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
