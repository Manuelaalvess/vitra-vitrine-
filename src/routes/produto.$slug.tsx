import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getProductBySlug, getSettings } from "@/lib/products.functions";
import { formatBRL } from "@/lib/format";
import { imageForSlug } from "@/lib/product-images";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { useCart } from "@/lib/cart";

const productQO = (slug: string) =>
  queryOptions({
    queryKey: ["product", slug],
    queryFn: () => getProductBySlug({ data: { slug } }),
  });
const settingsQO = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettings(),
});

export const Route = createFileRoute("/produto/$slug")({
  loader: async ({ context, params }) => {
    const [product] = await Promise.all([
      context.queryClient.ensureQueryData(productQO(params.slug)),
      context.queryClient.ensureQueryData(settingsQO),
    ]);
    if (!product) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { title: `Produto · Vitra` },
      {
        name: "description",
        content: `Reserve esta peça e finalize pelo WhatsApp — ${params.slug}`,
      },
    ],
  }),
  component: ProductPage,
  notFoundComponent: () => (
    <div className="min-h-screen bg-canvas">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-serif text-3xl">Peça não encontrada</h1>
        <Link to="/" className="mt-6 inline-block text-brand underline">
          Voltar à vitrine
        </Link>
      </div>
    </div>
  ),
});

function ProductPage() {
  const { slug } = Route.useParams();
  const { data: product } = useSuspenseQuery(productQO(slug));
  const { data: settings } = useSuspenseQuery(settingsQO);
  const { add, open } = useCart();

  if (!product) return null;
  const soldOut = product.stock <= 0;
  const img = imageForSlug(product.slug, product.image_url);

  function handleAdd() {
    if (!product) return;
    add({
      id: product.id,
      slug: product.slug,
      name: product.name,
      price_cents: product.price_cents,
      image_url: img,
    });
    toast.success(`${product.name} adicionado ao carrinho`);
    open();
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader storeName={settings.store_name.toLowerCase()} />

      <main className="mx-auto max-w-6xl px-6 py-12">
        <Link
          to="/"
          className="mb-8 inline-block text-xs font-medium uppercase tracking-[0.2em] text-ink-muted hover:text-brand"
        >
          ← Vitrine
        </Link>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-md ring-1 ring-black/5">
            <img
              src={img}
              alt={product.name}
              width={1024}
              height={1280}
              className={`aspect-[4/5] w-full object-cover ${soldOut ? "opacity-70 grayscale-[0.4]" : ""}`}
            />
            {soldOut && (
              <div className="absolute inset-0 flex items-center justify-center bg-canvas/40 backdrop-blur-[2px]">
                <span className="animate-stamp -rotate-12 border-2 border-brand px-6 py-2 font-serif text-2xl uppercase tracking-tight text-brand">
                  Reservado
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">
              {product.subtitle ?? "Peça selecionada"}
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight md:text-5xl">{product.name}</h1>
            <p className="mt-4 text-2xl font-medium">{formatBRL(product.price_cents)}</p>

            {product.description && (
              <p className="mt-6 text-ink-muted leading-relaxed">{product.description}</p>
            )}

            <div className="mt-4 text-xs uppercase tracking-widest text-ink-muted">
              {soldOut
                ? "Sem estoque"
                : product.stock === 1
                  ? "Última unidade"
                  : `${product.stock} disponíveis`}
            </div>

            <div className="mt-10 space-y-3 rounded-xl bg-card p-6 ring-1 ring-border">
              <h2 className="font-serif text-xl">Adicionar ao carrinho</h2>
              <p className="text-sm text-ink-muted">
                Reúna quantas peças quiser e finalize seu pedido pelo WhatsApp em um único
                atendimento.
              </p>
              <button
                type="button"
                onClick={handleAdd}
                disabled={soldOut}
                className="flex w-full items-center justify-center rounded-lg bg-brand py-3 text-sm font-medium text-brand-foreground ring-1 ring-brand transition-transform disabled:cursor-not-allowed disabled:opacity-60 hover:scale-[1.01] active:scale-[0.98]"
              >
                {soldOut ? "Indisponível" : "Adicionar ao carrinho"}
              </button>
              <p className="text-[11px] text-ink-muted">
                A finalização é feita no WhatsApp, onde combinamos pagamento e entrega.
              </p>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter storeName={settings.store_name} />
    </div>
  );
}
