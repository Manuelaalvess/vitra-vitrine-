import { formatBRL, onlyDigits } from "./format";

export function buildWhatsAppUrl(params: {
  phone: string;
  storeName: string;
  items: { name: string; quantity: number; price_cents: number }[];
  totalCents: number;
  code: string;
  customerName: string;
}): string {
  const phone = onlyDigits(params.phone);
  const lines = params.items.map(
    (i) =>
      `• ${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""} — ${formatBRL(i.price_cents * i.quantity)}`,
  );
  const msg =
    `Olá, ${params.storeName}! Sou ${params.customerName}.\n\n` +
    `Acabei de reservar:\n` +
    `${lines.join("\n")}\n\n` +
    `Total: ${formatBRL(params.totalCents)}\n` +
    `Código da reserva: ${params.code}\n\n` +
    `Gostaria de combinar o pagamento e a entrega.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
