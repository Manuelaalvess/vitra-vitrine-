import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu, ShoppingBag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useIsAdmin } from "@/lib/use-is-admin";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader({ storeName = "vitra" }: { storeName?: string }) {
  const { count, open } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    setMenuOpen(false);
    navigate({ to: "/" });
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="flex min-w-0 items-baseline gap-2">
          <span className="font-serif italic text-2xl font-medium tracking-tight text-ink lowercase truncate">
            {storeName}
          </span>
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.2em] text-ink-muted sm:inline">
            Vitrine
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          <Link
            to="/"
            className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Catálogo
          </Link>
          <Link
            to="/"
            hash="como-funciona"
            className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Como funciona
          </Link>
          <Link
            to="/contato"
            className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Contato
          </Link>
          {isAdmin && (
            <>
              <Link
                to="/admin"
                className="rounded-full px-3 py-1.5 text-xs font-medium tracking-wide ring-1 ring-border transition-colors hover:bg-brand-soft hover:text-brand hover:ring-brand/30"
              >
                Painel
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Sair"
                className="rounded-full p-2 text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
          <CartButton count={count} onClick={open} />
        </nav>

        {/* Mobile actions */}
        <div className="flex items-center gap-2 md:hidden">
          <CartButton count={count} onClick={open} />
          <button
            type="button"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full p-2 text-ink transition-colors hover:bg-brand-soft hover:text-brand"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div className="md:hidden border-t border-border/60 bg-canvas/95 backdrop-blur-md animate-fade-in">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
            <Link
              to="/"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand"
            >
              Catálogo
            </Link>
            <Link
              to="/"
              hash="como-funciona"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand"
            >
              Como funciona
            </Link>
            <Link
              to="/contato"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand"
            >
              Contato
            </Link>
            {isAdmin && (
              <>
                <Link
                  to="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-brand-soft hover:text-brand"
                >
                  Painel
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-medium text-ink-muted hover:bg-brand-soft hover:text-brand"
                >
                  <LogOut size={16} /> Sair
                </button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

function CartButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Abrir carrinho (${count} ${count === 1 ? "item" : "itens"})`}
      className="relative rounded-full p-2 text-ink transition-colors hover:bg-brand-soft hover:text-brand"
    >
      <ShoppingBag size={20} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-brand-foreground ring-2 ring-canvas animate-scale-in">
          {count}
        </span>
      )}
    </button>
  );
}

export function SiteFooter({ storeName = "Vitra" }: { storeName?: string }) {
  return (
    <footer className="mt-24 border-t border-border/60 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
        <span className="font-serif italic text-lg text-ink">{storeName.toLowerCase()}.</span>
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">
          Reserva por WhatsApp · Atendimento personalizado
        </p>
      </div>
    </footer>
  );
}
