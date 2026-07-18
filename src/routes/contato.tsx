import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { getSettings } from "@/lib/products.functions";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { formatPhoneBR, onlyDigits } from "@/lib/format";

const settingsQO = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettings(),
});

export const Route = createFileRoute("/contato")({
  head: () => ({
    meta: [
      { title: "Contato — Vitra" },
      {
        name: "description",
        content:
          "Fale direto no WhatsApp para tirar dúvidas, entender como funciona e reservar suas peças favoritas.",
      },
      { property: "og:title", content: "Contato — Vitra" },
      {
        property: "og:description",
        content: "Atendimento pessoal via WhatsApp, antes e depois da compra.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(settingsQO);
  },
  component: Contato,
});

function Contato() {
  const { data: settings } = useSuspenseQuery(settingsQO);
  const waUrl = `https://wa.me/${onlyDigits(settings.whatsapp_phone)}?text=${encodeURIComponent(
    "Olá! Vim pelo site da Vitra e gostaria de tirar uma dúvida.",
  )}`;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader storeName={settings.store_name.toLowerCase()} />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">Contato</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight text-balance md:text-5xl">
          Vamos conversar antes da sua reserva.
        </h1>
        <p className="mt-4 max-w-[52ch] text-base text-ink-muted md:text-lg text-pretty">
          Se quiser entender como funciona, saber detalhes de uma peça ou combinar entrega, chama no
          WhatsApp — atendimento pessoal, sem robô.
        </p>

        <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6 md:p-8">
          <p className="text-xs uppercase tracking-widest text-ink-muted">WhatsApp</p>
          <p className="mt-2 font-serif text-2xl text-ink">
            {formatPhoneBR(settings.whatsapp_phone)}
          </p>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--whatsapp)] px-5 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.01] active:scale-[0.98]"
          >
            <MessageCircle size={18} />
            Abrir WhatsApp
          </a>
        </div>
      </main>

      <SiteFooter storeName={settings.store_name} />
    </div>
  );
}
