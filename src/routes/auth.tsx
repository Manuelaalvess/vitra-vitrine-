import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Acesso — Painel Vitra" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Bem-vinda de volta.");
      navigate({ to: "/admin", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na autenticação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-brand">
          Área da vendedora
        </p>
        <h1 className="mt-2 font-serif text-3xl md:text-4xl">Entrar no painel</h1>
        <p className="mt-2 text-sm text-ink-muted">Gerencie produtos, estoque e reservas.</p>

        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-xl bg-card p-6 ring-1 ring-border"
        >
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              E-mail
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">
              Senha
            </span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-brand-foreground ring-1 ring-brand disabled:opacity-60"
          >
            {busy ? "Aguarde…" : "Entrar"}
          </button>
        </form>

        <Link
          to="/"
          className="mt-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-ink-muted hover:text-brand"
        >
          ← Voltar à vitrine
        </Link>
      </main>
    </div>
  );
}
