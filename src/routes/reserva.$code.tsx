import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getReservationByCode, getSettings } from "@/lib/products.functions";
import { formatBRL } from "@/lib/format";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { SiteFooter, SiteHeader } from "@/components/site-header";

const resQO = (code: string) =>
  queryOptions({
    queryKey: ["reservation", code],
    queryFn: () => getReservationByCode({ data: { code } }),
  });
const settingsQO = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettings(),
});

export const Route = createFileRoute("/reserva/$code")({
  loader: async ({ context, params }) => {
    const [r] = await Promise.all([
      context.queryClient.ensureQueryData(resQO(params.code.toUpperCase())),
      context.queryClient.ensureQueryData(settingsQO),
    ]);
    if (!r) throw notFound();
  },
  head: () => ({ meta: [{ title: "Reserva confirmada · Vitra" }] }),
  component: ReservationPage,
  notFoundComponent: () => (
    <div className="min-h-screen bg-canvas">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-serif text-3xl">Reserva não encontrada</h1>
        <p className="mt-3 text-ink-muted">Confira o código ou volte à vitrine.</p>
        <Link to="/" className="mt-6 inline-block text-brand underline">
          Voltar à vitrine
        </Link>
      </div>
    </div>
  ),
});

const STATUS_LABEL: Record<string, { label: string; helper: string }> = {
  pending: {
    label: "Reservada",
    helper:
      "está reservada exclusivamente para você por 24 horas, enquanto combinamos pagamento e entrega no WhatsApp.",
  },
  confirmed: {
    label: "Confirmada",
    helper: "já foi confirmada pela loja. Combine os detalhes finais no WhatsApp.",
  },
  cancelled: {
    label: "Cancelada",
    helper: "foi cancelada e as peças voltaram para a vitrine.",
  },
  expired: {
    label: "Expirada",
    helper:
      "expirou e as peças voltaram para a vitrine. Faça uma nova reserva se ainda tiver interesse.",
  },
};

function ReservationPage() {
  const { code } = Route.useParams();
  const { data: r } = useSuspenseQuery(resQO(code.toUpperCase()));
  const { data: settings } = useSuspenseQuery(settingsQO);

  if (!r) return null;

  const isActive = r.status === "pending";
  const status = STATUS_LABEL[r.status] ?? { label: r.status, helper: "" };
  const whatsappUrl = buildWhatsAppUrl({
    phone: settings.whatsapp_phone,
    storeName: settings.store_name,
    items: r.items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      price_cents: i.price_at_reservation_cents,
    })),
    totalCents: r.total_cents,
    code: r.code,
    customerName: r.customer_name,
  });

  const expiresLabel = new Date(r.expires_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader storeName={settings.store_name.toLowerCase()} />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl bg-card p-8 ring-1 ring-border shadow-sm md:p-10">
          <div className="flex items-center justify-between border-b border-border pb-6">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">
                {status.label}
              </p>
              <h1 className="mt-2 font-serif text-3xl md:text-4xl">
                Olá, {r.customer_name.split(" ")[0]}.
              </h1>
            </div>
            <span className="rounded-md bg-brand-soft px-3 py-1.5 font-mono text-xs font-medium text-brand">
              #{r.code}
            </span>
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-ink-muted leading-relaxed">Sua reserva {status.helper}</p>

            <ul className="divide-y divide-border/60 rounded-lg bg-secondary/40">
              {r.items.map((item, idx) => (
                <li key={idx} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-ink">
                    {item.product_name}
                    {item.quantity > 1 ? ` (x${item.quantity})` : ""}
                  </span>
                  <span className="font-medium text-ink">
                    {formatBRL(item.price_at_reservation_cents * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between rounded-lg bg-brand-soft/60 px-4 py-3 text-sm">
              <span className="text-ink-muted">Total</span>
              <span className="font-medium text-ink">{formatBRL(r.total_cents)}</span>
            </div>
            {isActive && (
              <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-3 text-sm">
                <span className="text-ink-muted">Válido até</span>
                <span className="font-medium text-ink">{expiresLabel}</span>
              </div>
            )}
          </div>

          {isActive && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg bg-whatsapp py-4 text-sm font-semibold text-white transition-transform hover:brightness-[1.03] active:scale-[0.98]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
              </svg>
              Finalizar no WhatsApp
            </a>
          )}

          <Link
            to="/"
            className="mt-4 block text-center text-xs font-medium uppercase tracking-[0.2em] text-ink-muted hover:text-brand"
          >
            Voltar à vitrine
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Guarde o código <span className="font-mono">{r.code}</span> — é a prova da sua reserva.
        </p>
      </main>

      <SiteFooter storeName={settings.store_name} />
    </div>
  );
}
