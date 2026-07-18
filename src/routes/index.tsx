import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listProducts, getSettings, type Product } from "@/lib/products.functions";
import { formatBRL } from "@/lib/format";
import { imageForSlug } from "@/lib/product-images";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { useCart } from "@/lib/cart";

const productsQO = queryOptions({
  queryKey: ["products", "public"],
  queryFn: () => listProducts(),
});
const settingsQO = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettings(),
});

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(productsQO),
      context.queryClient.ensureQueryData(settingsQO),
    ]);
  },
  component: Index,
});

function Index() {
  const { data: products } = useSuspenseQuery(productsQO);
  const { data: settings } = useSuspenseQuery(settingsQO);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader storeName={settings.store_name.toLowerCase()} />

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="mb-16 max-w-2xl space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">Vitrine</p>
          <h1 className="font-serif text-4xl leading-tight text-balance md:text-5xl">
            Peças selecionadas, prontas para uma casa nova.
          </h1>
          <p className="max-w-[48ch] text-base text-ink-muted md:text-lg text-pretty">
            Reserve sua favorita e finalize o atendimento diretamente pelo WhatsApp.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-x-8 gap-y-16 md:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
          {products.length === 0 && (
            <p className="col-span-full text-center text-ink-muted">
              Nenhuma peça na vitrine ainda.
            </p>
          )}
        </section>

        <section id="como-funciona" className="mt-24 scroll-mt-24 border-t border-border/60 pt-16">
          <div className="mb-10 max-w-2xl space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">
              Como funciona
            </p>
            <h2 className="font-serif text-3xl leading-tight text-balance md:text-4xl">
              Três passos até a sua peça favorita.
            </h2>
          </div>
          <ol className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {[
              {
                n: "01",
                title: "Monte sua seleção",
                body: "Adicione ao carrinho as peças que você quer — elas ficam reservadas assim que você confirma.",
              },
              {
                n: "02",
                title: "Confirme pelo WhatsApp",
                body: "Ao finalizar, o WhatsApp abre com sua seleção já pronta para envio.",
              },
              {
                n: "03",
                title: "Pague e combine",
                body: "Pix na hora e combinamos juntas a entrega ou retirada.",
              },
            ].map((s) => (
              <li key={s.n} className="space-y-3">
                <span className="font-serif italic text-3xl text-brand">{s.n}</span>
                <h3 className="font-serif text-xl text-ink">{s.title}</h3>
                <p className="text-sm text-ink-muted text-pretty">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <SiteFooter storeName={settings.store_name} />
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const soldOut = product.stock <= 0;
  const last = product.stock === 1;
  const img = imageForSlug(product.slug, product.image_url);
  const { add, open } = useCart();

  function handleAdd() {
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
    <article className="group flex flex-col">
      <Link
        to="/produto/$slug"
        params={{ slug: product.slug }}
        className="relative mb-4 block overflow-hidden rounded-md ring-1 ring-black/5"
      >
        <img
          src={img}
          alt={product.name}
          width={1024}
          height={1280}
          loading="lazy"
          className={`aspect-[4/5] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] ${soldOut ? "opacity-70 grayscale-[0.4]" : ""}`}
        />
        {soldOut ? (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/40 backdrop-blur-[2px]">
            <span className="animate-stamp -rotate-12 border-2 border-brand px-4 py-1 font-serif text-xl font-medium uppercase tracking-tight text-brand">
              Reservado
            </span>
          </div>
        ) : last ? (
          <span className="absolute right-3 top-3 rounded-sm bg-white/90 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-brand shadow-sm ring-1 ring-black/5">
            Última peça
          </span>
        ) : null}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-medium text-ink truncate">{product.name}</h3>
          {product.subtitle && (
            <p className="text-sm text-ink-muted truncate">{product.subtitle}</p>
          )}
        </div>
        <p className="text-base font-medium text-ink whitespace-nowrap">
          {formatBRL(product.price_cents)}
        </p>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={soldOut}
        className={`mt-4 flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium ring-1 transition-transform ${
          soldOut
            ? "cursor-not-allowed bg-secondary text-ink-muted ring-border"
            : "bg-brand text-brand-foreground ring-brand hover:scale-[1.01] active:scale-[0.98]"
        }`}
      >
        {soldOut ? "Indisponível" : "Adicionar ao carrinho"}
      </button>
    </article>
  );
}
