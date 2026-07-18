import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCart } from "@/lib/cart";
import { formatBRL } from "@/lib/format";
import { getSettings, reserveCart } from "@/lib/products.functions";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

export function CartDrawer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { items, isOpen, close, remove, total, clear } = useCart();
  const doReserve = useServerFn(reserveCart);
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ waUrl: string; code: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, close]);

  function handleClose() {
    close();
    setError("");
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!settings || items.length === 0) return;
    if (customerName.trim().length < 2) {
      setError("Digite seu nome completo.");
      return;
    }
    if (customerPhone.replace(/\D/g, "").length < 10) {
      setError("Digite um telefone válido, com DDD.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await doReserve({
        data: {
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          items: items.map((i) => ({ product_id: i.id, quantity: i.quantity })),
        },
      });
      const waUrl = buildWhatsAppUrl({
        phone: settings.whatsapp_phone,
        storeName: settings.store_name,
        items: items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price_cents: i.price_cents,
        })),
        totalCents: total,
        code: result.code,
        customerName: customerName.trim(),
        expiresAt: result.expires_at,
      });
      setSuccess({ waUrl, code: result.code });
      clear();
      setCustomerName("");
      setCustomerPhone("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a reserva.");
    } finally {
      setSubmitting(false);
    }
  }

  function goToReservation() {
    if (!success) return;
    handleClose();
    navigate({ to: "/reserva/$code", params: { code: success.code } });
  }

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Fechar carrinho"
          onClick={handleClose}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm animate-fade-in"
        />
      )}
      <aside
        aria-hidden={!isOpen}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-5">
          <div className="flex items-center gap-2">
            <ShoppingBag size={18} className="text-brand" />
            <h2 className="font-serif text-xl">Suas reservas</h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Fechar"
            className="rounded-full p-2 text-ink-muted hover:bg-brand-soft hover:text-brand"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {success ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="font-serif text-lg text-ink">Reserva confirmada!</p>
              <p className="mt-2 text-sm text-ink-muted">
                Suas peças ficam reservadas por 24 horas. Finalize o atendimento no WhatsApp para
                combinar pagamento e entrega.
              </p>
              <span className="mt-4 rounded-md bg-brand-soft px-3 py-1.5 font-mono text-xs text-brand">
                #{success.code}
              </span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <ShoppingBag size={32} className="text-ink-muted/60" />
              <p className="mt-4 font-serif text-lg">Carrinho vazio</p>
              <p className="mt-1 text-sm text-ink-muted">
                Adicione peças da vitrine para reservar.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((it) => (
                <li key={it.id} className="flex gap-4 py-4">
                  {it.image_url ? (
                    <img
                      src={it.image_url}
                      alt={it.name}
                      className="h-20 w-16 rounded-md object-cover ring-1 ring-black/5"
                    />
                  ) : (
                    <div className="h-20 w-16 rounded-md bg-brand-soft" />
                  )}
                  <div className="flex flex-1 flex-col">
                    <p className="text-sm font-medium leading-tight text-ink">{it.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Qtd. {it.quantity} · {formatBRL(it.price_cents)}
                    </p>
                    <div className="mt-auto flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {formatBRL(it.price_cents * it.quantity)}
                      </span>
                      <button
                        onClick={() => remove(it.id)}
                        aria-label={`Remover ${it.name}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={14} />
                        Remover
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {success && (
          <footer className="border-t border-border/60 bg-card px-6 py-5 space-y-3">
            <a
              href={success.waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={goToReservation}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--whatsapp)] py-3 text-sm font-medium text-white transition-transform hover:scale-[1.01] active:scale-[0.98]"
            >
              Finalizar no WhatsApp
            </a>
            <button
              onClick={goToReservation}
              className="w-full text-xs text-ink-muted hover:text-brand"
            >
              Ver detalhes da reserva
            </button>
          </footer>
        )}

        {!success && items.length > 0 && (
          <footer className="border-t border-border/60 bg-card px-6 py-5 space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                Total
              </span>
              <span className="font-serif text-2xl">{formatBRL(total)}</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                  Seu nome
                </span>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Como podemos te chamar"
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                  Telefone / WhatsApp
                </span>
                <input
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-medium text-brand-foreground ring-1 ring-brand transition-transform hover:scale-[1.01] active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? "Reservando…" : "Reservar e finalizar no WhatsApp"}
              </button>
            </form>

            <button
              onClick={clear}
              className="w-full text-xs text-ink-muted hover:text-destructive"
            >
              Esvaziar carrinho
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
