import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  adminListProducts,
  adminListReservations,
  adminUpdateStock,
  adminReleaseReservation,
  adminConfirmReservation,
  checkIsAdmin,
} from "@/lib/products.functions";
import { formatBRL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Painel · Vitra" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAdmin = useServerFn(checkIsAdmin);
  const fetchProducts = useServerFn(adminListProducts);
  const fetchReservations = useServerFn(adminListReservations);
  const updateStock = useServerFn(adminUpdateStock);
  const release = useServerFn(adminReleaseReservation);
  const confirm = useServerFn(adminConfirmReservation);

  const adminQ = useQuery({ queryKey: ["admin", "self"], queryFn: () => fetchAdmin() });

  const productsQ = useQuery({
    queryKey: ["admin", "products"],
    queryFn: () => fetchProducts(),
    enabled: adminQ.data?.isAdmin === true,
  });
  const reservationsQ = useQuery({
    queryKey: ["admin", "reservations"],
    queryFn: () => fetchReservations(),
    enabled: adminQ.data?.isAdmin === true,
  });

  const stockMut = useMutation({
    mutationFn: (v: { product_id: string; stock: number }) => updateStock({ data: v }),
    onSuccess: () => {
      toast.success("Estoque atualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const releaseMut = useMutation({
    mutationFn: (id: string) => release({ data: { reservation_id: id } }),
    onSuccess: () => {
      toast.success("Reserva liberada. Estoque restaurado.");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const confirmMut = useMutation({
    mutationFn: (id: string) => confirm({ data: { reservation_id: id } }),
    onSuccess: () => {
      toast.success("Venda confirmada.");
      queryClient.invalidateQueries({ queryKey: ["admin", "reservations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (adminQ.isLoading) {
    return (
      <div className="min-h-screen bg-canvas">
        <SiteHeader />
        <div className="mx-auto max-w-6xl px-6 py-16 text-ink-muted">Carregando…</div>
      </div>
    );
  }

  const isAdmin = adminQ.data?.isAdmin === true;
  const pendingReservations = (reservationsQ.data ?? []).filter((r) => r.status === "pending");
  const activeCount = pendingReservations.length;
  const productCount = productsQ.data?.length ?? 0;
  const oosCount = (productsQ.data ?? []).filter((p) => p.stock === 0).length;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ink-muted">
              Painel de controle
            </p>
            <h1 className="mt-1 font-serif text-3xl">Gestão da vitrine</h1>
          </div>
          <button
            onClick={handleSignOut}
            className="rounded-md px-3 py-2 text-xs font-medium tracking-wide ring-1 ring-border hover:bg-secondary"
          >
            Sair
          </button>
        </div>

        {!isAdmin && (
          <div className="rounded-xl bg-card p-6 ring-1 ring-border">
            <p className="text-sm text-ink-muted">
              Sua conta ainda não tem permissão de administradora. Peça a uma admin para te conceder
              acesso — o papel é concedido manualmente no banco de dados, não existe mais criação
              automática de admin.
            </p>
          </div>
        )}

        {isAdmin && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCard label="Reservas ativas" value={activeCount} accent />
              <StatCard label="Produtos" value={productCount} hint={`${oosCount} sem estoque`} />
              <StatCard
                label="Última atualização"
                value={new Date().toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            </div>

            {/* Reservations */}
            <section className="mt-10 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-serif text-xl">Reservas</h2>
                <p className="text-xs uppercase tracking-widest text-ink-muted">
                  Pendentes primeiro
                </p>
              </div>
              <div className="divide-y divide-border">
                {(reservationsQ.data ?? []).length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-ink-muted">
                    Nenhuma reserva ainda.
                  </p>
                )}
                {(reservationsQ.data ?? []).map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-xs text-brand">
                          #{r.code}
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {r.reservation_items.map((it) => (
                          <p key={it.id} className="text-sm text-ink">
                            {it.products?.name ?? "—"}
                            {it.quantity > 1 ? ` (x${it.quantity})` : ""}
                            <span className="ml-2 text-xs text-ink-muted">
                              {formatBRL(it.price_at_reservation_cents * it.quantity)}
                            </span>
                          </p>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {r.customer_name} · {r.customer_phone} ·{" "}
                        {new Date(r.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {r.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => confirmMut.mutate(r.id)}
                          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                        >
                          Confirmar venda
                        </button>
                        <button
                          onClick={() => releaseMut.mutate(r.id)}
                          className="rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-secondary"
                        >
                          Liberar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Products */}
            <section className="mt-10 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-serif text-xl">Produtos & estoque</h2>
              </div>
              <div className="divide-y divide-border">
                {(productsQ.data ?? []).map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onSave={(stock) => stockMut.mutate({ product_id: p.id, stock })}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">{label}</p>
      <p className={`mt-2 font-serif text-3xl ${accent ? "text-brand" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-brand-soft text-brand" },
    confirmed: { label: "Confirmada", cls: "bg-emerald-100 text-emerald-800" },
    cancelled: { label: "Cancelada", cls: "bg-secondary text-ink-muted" },
    expired: { label: "Expirada", cls: "bg-secondary text-ink-muted" },
  };
  const m = map[status] ?? { label: status, cls: "bg-secondary text-ink-muted" };
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function ProductRow({
  product,
  onSave,
}: {
  product: { id: string; name: string; slug: string; stock: number; price_cents: number };
  onSave: (stock: number) => void;
}) {
  const [stock, setStock] = useState(product.stock);
  useEffect(() => setStock(product.stock), [product.stock]);
  const dirty = stock !== product.stock;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{product.name}</p>
        <p className="text-xs text-ink-muted">{formatBRL(product.price_cents)}</p>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs uppercase tracking-widest text-ink-muted">Estoque</label>
        <input
          type="number"
          min={0}
          max={9999}
          value={stock}
          onChange={(e) => setStock(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          onClick={() => onSave(stock)}
          disabled={!dirty}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-40"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
