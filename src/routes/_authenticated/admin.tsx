import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  adminListProducts,
  adminListReservations,
  adminUpdateStock,
  adminUpdateReservationStatus,
  adminListReservationEvents,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeactivateProduct,
  checkIsAdmin,
  type Product,
} from "@/lib/products.functions";
import { formatBRL } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

const MAX_IMAGE_MB = 5;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Formato inválido. Use JPEG, PNG ou WEBP.");
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new Error(`Arquivo muito grande. Máximo de ${MAX_IMAGE_MB}MB.`);
  }
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error("Não foi possível enviar a foto.");
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Painel · Vitra" }] }),
  component: AdminPage,
});

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendente" },
  { value: "awaiting_payment", label: "Aguardando pagamento" },
  { value: "confirmed", label: "Confirmada" },
  { value: "delivered", label: "Entregue" },
  { value: "cancelled", label: "Cancelada" },
  { value: "expired", label: "Expirada" },
] as const;

const STATUS_SORT_ORDER: Record<string, number> = {
  awaiting_payment: 0,
  pending: 1,
  confirmed: 2,
  delivered: 3,
  cancelled: 4,
  expired: 5,
};

// Próxima transição válida a partir de cada status (espelha
// update_reservation_status no banco — mantém painel e RPC em sincronia).
const NEXT_ACTIONS: Record<
  string,
  Array<{ label: string; target: string; variant: "primary" | "secondary" }>
> = {
  pending: [
    { label: "Marcar pagamento", target: "awaiting_payment", variant: "primary" },
    { label: "Cancelar", target: "cancelled", variant: "secondary" },
  ],
  awaiting_payment: [
    { label: "Confirmar venda", target: "confirmed", variant: "primary" },
    { label: "Cancelar", target: "cancelled", variant: "secondary" },
  ],
  confirmed: [{ label: "Marcar entregue", target: "delivered", variant: "primary" }],
};

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAdmin = useServerFn(checkIsAdmin);
  const fetchProducts = useServerFn(adminListProducts);
  const fetchReservations = useServerFn(adminListReservations);
  const updateStock = useServerFn(adminUpdateStock);
  const updateReservationStatus = useServerFn(adminUpdateReservationStatus);
  const fetchReservationEvents = useServerFn(adminListReservationEvents);
  const createProduct = useServerFn(adminCreateProduct);
  const updateProduct = useServerFn(adminUpdateProduct);
  const deactivateProduct = useServerFn(adminDeactivateProduct);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "status">("recent");
  const [historyFor, setHistoryFor] = useState<{ id: string; code: string } | null>(null);
  const [productForm, setProductForm] = useState<
    { mode: "create" } | { mode: "edit"; product: Product } | null
  >(null);

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
  const eventsQ = useQuery({
    queryKey: ["admin", "reservation-events", historyFor?.id],
    queryFn: () => fetchReservationEvents({ data: { reservation_id: historyFor!.id } }),
    enabled: !!historyFor,
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
  const statusMut = useMutation({
    mutationFn: (v: { reservation_id: string; new_status: string }) =>
      updateReservationStatus({
        data: { reservation_id: v.reservation_id, new_status: v.new_status as never },
      }),
    onSuccess: () => {
      toast.success("Status atualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin", "reservations"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "reservation-events"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  type ProductFormValues = {
    name: string;
    size: string | null;
    price_cents: number;
    description: string | null;
    stock: number;
    image_url: string | null;
  };
  const createProductMut = useMutation({
    mutationFn: (v: ProductFormValues) => createProduct({ data: v }),
    onSuccess: () => {
      toast.success("Peça criada.");
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setProductForm(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const updateProductMut = useMutation({
    mutationFn: (v: ProductFormValues & { id: string }) => updateProduct({ data: v }),
    onSuccess: () => {
      toast.success("Peça atualizada.");
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
      setProductForm(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const deactivateProductMut = useMutation({
    mutationFn: (id: string) => deactivateProduct({ data: { id } }),
    onSuccess: () => {
      toast.success("Peça desativada.");
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const reservations = reservationsQ.data ?? [];
  const filteredReservations = reservations
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === "status") {
        return (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
      }
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortBy === "oldest" ? diff : -diff;
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
  const activeCount = reservations.filter(
    (r) => r.status === "pending" || r.status === "awaiting_payment",
  ).length;
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-serif text-xl">Pedidos e reservas</h2>
                  <p className="text-xs uppercase tracking-widest text-ink-muted">
                    {filteredReservations.length} de {reservations.length}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                  >
                    {STATUS_FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                  >
                    <option value="recent">Mais recentes</option>
                    <option value="oldest">Mais antigas</option>
                    <option value="status">Por status</option>
                  </select>
                </div>
              </div>
              <div className="divide-y divide-border">
                {filteredReservations.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-ink-muted">
                    Nenhuma reserva encontrada.
                  </p>
                )}
                {filteredReservations.map((r) => (
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
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setHistoryFor({ id: r.id, code: r.code })}
                        className="rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-secondary"
                      >
                        Histórico
                      </button>
                      {(NEXT_ACTIONS[r.status] ?? []).map((action) => (
                        <button
                          key={action.target}
                          onClick={() =>
                            statusMut.mutate({ reservation_id: r.id, new_status: action.target })
                          }
                          disabled={statusMut.isPending}
                          className={
                            action.variant === "primary"
                              ? "rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
                              : "rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-secondary disabled:opacity-50"
                          }
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Products */}
            <section className="mt-10 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="font-serif text-xl">Produtos & estoque</h2>
                <button
                  onClick={() => setProductForm({ mode: "create" })}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                >
                  Nova peça
                </button>
              </div>
              <div className="divide-y divide-border">
                {(productsQ.data ?? []).map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onSave={(stock) => stockMut.mutate({ product_id: p.id, stock })}
                    onEdit={() => setProductForm({ mode: "edit", product: p })}
                    onDeactivate={() => deactivateProductMut.mutate(p.id)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {historyFor && (
        <ReservationHistoryModal
          code={historyFor.code}
          events={eventsQ.data}
          loading={eventsQ.isLoading}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {productForm && (
        <ProductFormModal
          initial={productForm.mode === "edit" ? productForm.product : null}
          submitting={createProductMut.isPending || updateProductMut.isPending}
          onClose={() => setProductForm(null)}
          onSubmit={(values) => {
            if (productForm.mode === "edit") {
              updateProductMut.mutate({ ...values, id: productForm.product.id });
            } else {
              createProductMut.mutate(values);
            }
          }}
        />
      )}
    </div>
  );
}

function ReservationHistoryModal({
  code,
  events,
  loading,
  onClose,
}: {
  code: string;
  events:
    | Array<{
        id: string;
        from_status: string | null;
        to_status: string;
        note: string | null;
        created_at: string;
      }>
    | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-card p-6 ring-1 ring-border">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ink-muted">
              Histórico
            </p>
            <h2 className="mt-1 font-serif text-xl">#{code}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-ink-muted hover:bg-brand-soft hover:text-brand"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {loading && <p className="text-sm text-ink-muted">Carregando…</p>}
          {!loading && (events ?? []).length === 0 && (
            <p className="text-sm text-ink-muted">Nenhum evento registrado.</p>
          )}
          {(events ?? []).map((ev) => (
            <div key={ev.id} className="rounded-lg bg-secondary/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                {ev.from_status ? <StatusBadge status={ev.from_status} /> : null}
                {ev.from_status ? <span className="text-ink-muted">→</span> : null}
                <StatusBadge status={ev.to_status} />
              </div>
              {ev.note && <p className="mt-1.5 text-xs text-ink-muted">{ev.note}</p>}
              <p className="mt-1 text-xs text-ink-muted">
                {new Date(ev.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ))}
        </div>
      </div>
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
    awaiting_payment: { label: "Aguardando pagamento", cls: "bg-amber-100 text-amber-800" },
    confirmed: { label: "Confirmada", cls: "bg-emerald-100 text-emerald-800" },
    delivered: { label: "Entregue", cls: "bg-sky-100 text-sky-800" },
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
  onEdit,
  onDeactivate,
}: {
  product: Product;
  onSave: (stock: number) => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const [stock, setStock] = useState(product.stock);
  useEffect(() => setStock(product.stock), [product.stock]);
  const dirty = stock !== product.stock;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-12 w-12 rounded-md object-cover ring-1 ring-black/5"
          />
        ) : (
          <div className="h-12 w-12 rounded-md bg-brand-soft" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">{product.name}</p>
          <p className="text-xs text-ink-muted">
            {formatBRL(product.price_cents)}
            {product.size ? ` · ${product.size}` : ""}
            {!product.is_active ? " · inativo" : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
        <button
          onClick={onEdit}
          className="rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-secondary"
        >
          Editar
        </button>
        {product.is_active && (
          <button
            onClick={onDeactivate}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-destructive/10 hover:text-destructive"
          >
            Desativar
          </button>
        )}
      </div>
    </div>
  );
}

function ProductFormModal({
  initial,
  submitting,
  onClose,
  onSubmit,
}: {
  initial: Product | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    size: string | null;
    price_cents: number;
    description: string | null;
    stock: number;
    image_url: string | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [size, setSize] = useState(initial?.size ?? "");
  const [priceReais, setPriceReais] = useState(
    initial ? (initial.price_cents / 100).toFixed(2) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [stock, setStock] = useState(initial?.stock ?? 1);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError("");
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      setImageUrl(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (name.trim().length < 2) {
      setFormError("Digite o nome da peça.");
      return;
    }
    const priceCents = Math.round(Number(priceReais.replace(",", ".")) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setFormError("Digite um preço válido.");
      return;
    }
    onSubmit({
      name: name.trim(),
      size: size.trim() || null,
      price_cents: priceCents,
      description: description.trim() || null,
      stock,
      image_url: imageUrl,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 ring-1 ring-border">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2 className="font-serif text-xl">{initial ? "Editar peça" : "Nova peça"}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-ink-muted hover:bg-brand-soft hover:text-brand"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Foto
            </span>
            <div className="mt-1.5 flex items-center gap-4">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Pré-visualização"
                  className="h-20 w-20 rounded-md object-cover ring-1 ring-black/5"
                />
              ) : (
                <div className="h-20 w-20 rounded-md bg-brand-soft" />
              )}
              <label className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-secondary">
                {uploading ? "Enviando…" : "Escolher foto"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Nome
            </span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                Tamanho
              </span>
              <input
                type="text"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="Ex.: Único, P, 20x30cm"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                Preço (R$)
              </span>
              <input
                type="text"
                inputMode="decimal"
                required
                value={priceReais}
                onChange={(e) => setPriceReais(e.target.value)}
                placeholder="0,00"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Estoque
            </span>
            <input
              type="number"
              min={0}
              max={9999}
              value={stock}
              onChange={(e) => setStock(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 block w-24 rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Observação
            </span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>

          {formError && <p className="text-xs text-destructive">{formError}</p>}

          <button
            type="submit"
            disabled={submitting || uploading}
            className="flex w-full items-center justify-center rounded-lg bg-brand py-2.5 text-sm font-medium text-brand-foreground ring-1 ring-brand disabled:opacity-60"
          >
            {submitting ? "Salvando…" : initial ? "Salvar alterações" : "Criar peça"}
          </button>
        </form>
      </div>
    </div>
  );
}
