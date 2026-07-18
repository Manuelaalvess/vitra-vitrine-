import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

// ---------- Types ----------
export interface Product {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  size: string | null;
  price_cents: number;
  stock: number;
  image_url: string | null;
  is_active: boolean;
}

export interface Settings {
  store_name: string;
  whatsapp_phone: string;
  tagline: string;
}

export interface ReservationItemDetail {
  product_name: string;
  product_image_url: string | null;
  quantity: number;
  price_at_reservation_cents: number;
}

export interface ReservationDetail {
  code: string;
  customer_name: string;
  status: string;
  expires_at: string;
  total_cents: number;
  items: ReservationItemDetail[];
}

// ---------- Public read helpers (server publishable client) ----------
function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

// ---------- Rate limit em memória por IP ----------
// Best-effort: cada instância serverless tem seu próprio contador, mas já
// barra abuso trivial (script batendo a mesma função em loop). Dois mapas
// separados pra criar reserva e consultar código não competirem pelo mesmo
// limite.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const reserveAttemptsByIp = new Map<string, { count: number; resetAt: number }>();
const lookupAttemptsByIp = new Map<string, { count: number; resetAt: number }>();

function getClientIp(): string {
  try {
    const request = getRequest();
    const forwarded = request?.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function checkRateLimit(store: Map<string, { count: number; resetAt: number }>) {
  const ip = getClientIp();
  const now = Date.now();
  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (entry.count >= RATE_LIMIT) {
    throw new Error("rate_limited");
  }
  entry.count += 1;
}

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  await supabase.rpc("expire_stale_reservations");
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, name, subtitle, description, size, price_cents, stock, image_url, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
});

export const getProductBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { data: row, error } = await supabase
      .from("products")
      .select(
        "id, slug, name, subtitle, description, size, price_cents, stock, image_url, is_active",
      )
      .eq("slug", data.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as Product | null;
  });

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("settings")
    .select("store_name, whatsapp_phone, tagline")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? {
    store_name: "Vitra",
    whatsapp_phone: "5511999999999",
    tagline: "Curadoria de objetos com alma.",
  }) as Settings;
});

// ---------- Reserva atômica (carrinho) ----------
const reserveCartSchema = z.object({
  customer_name: z.string().trim().min(2, "Nome muito curto").max(80),
  customer_phone: z.string().trim().min(10).max(20),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1, "Carrinho vazio"),
});

export const reserveCart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => reserveCartSchema.parse(d))
  .handler(async ({ data }) => {
    checkRateLimit(reserveAttemptsByIp);
    const supabase = publicClient();
    const { data: rows, error } = await supabase.rpc("reserve_cart", {
      _customer_name: data.customer_name,
      _customer_phone: data.customer_phone,
      _items: data.items,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("insufficient_stock")) {
        throw new Error("Uma das peças esgotou enquanto você finalizava. Recarregue a página.");
      }
      if (msg.includes("product_not_found"))
        throw new Error("Uma das peças não está mais disponível.");
      if (msg.includes("invalid_name")) throw new Error("Nome inválido.");
      if (msg.includes("invalid_phone")) throw new Error("Telefone inválido.");
      if (msg.includes("invalid_quantity") || msg.includes("invalid_item")) {
        throw new Error("Quantidade inválida no carrinho.");
      }
      if (msg.includes("empty_cart")) throw new Error("Carrinho vazio.");
      if (msg.includes("rate_limited")) throw new Error("Muitas tentativas. Aguarde um minuto.");
      console.error("Erro ao reservar carrinho:", error);
      throw new Error("Não foi possível criar a reserva. Tente novamente.");
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("Reserva não retornada.");
    return {
      code: row.reservation_code as string,
      expires_at: row.expires_at as string,
    };
  });

export const getReservationByCode = createServerFn({ method: "GET" })
  .inputValidator((d: { code: string }) =>
    z.object({ code: z.string().trim().min(4).max(12) }).parse(d),
  )
  .handler(async ({ data }) => {
    checkRateLimit(lookupAttemptsByIp);
    const supabase = publicClient();
    const { data: rows, error } = await supabase.rpc("get_reservation_by_code", {
      _code: data.code.toUpperCase(),
    });
    if (error) {
      if (error.message.toLowerCase().includes("rate_limited")) {
        throw new Error("Muitas tentativas. Aguarde um minuto.");
      }
      console.error("Erro ao buscar reserva:", error);
      throw new Error("Não foi possível consultar essa reserva.");
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || !row.code) return null;
    return {
      code: row.code,
      customer_name: row.customer_name,
      status: row.status,
      expires_at: row.expires_at,
      total_cents: Number(row.total_cents),
      items: (row.items ?? []) as ReservationItemDetail[],
    } as ReservationDetail;
  });

// ---------- Admin (authenticated) ----------
export const adminListReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reservations")
      .select(
        "id, code, customer_name, customer_phone, status, expires_at, created_at, reservation_items(id, quantity, price_at_reservation_cents, products(name, slug))",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      code: string;
      customer_name: string;
      customer_phone: string;
      status: string;
      expires_at: string;
      created_at: string;
      reservation_items: Array<{
        id: string;
        quantity: number;
        price_at_reservation_cents: number;
        products: { name: string; slug: string } | null;
      }>;
    }>;
  });

export const adminListProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("products")
      .select(
        "id, slug, name, subtitle, description, size, price_cents, stock, image_url, is_active",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Product[];
  });

const updateStockSchema = z.object({
  product_id: z.string().uuid(),
  stock: z.number().int().min(0).max(9999),
});
export const adminUpdateStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateStockSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso restrito.");
    const { error } = await context.supabase
      .from("products")
      .update({ stock: data.stock })
      .eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateReservationStatusSchema = z.object({
  reservation_id: z.string().uuid(),
  new_status: z.enum(["awaiting_payment", "confirmed", "delivered", "cancelled"]),
  note: z.string().trim().max(280).optional(),
});
export const adminUpdateReservationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateReservationStatusSchema.parse(d))
  .handler(async ({ data, context }) => {
    // A validação de transição acontece dentro da RPC, na mesma transação
    // que trava a linha — evita corrida entre checar o status e escrever.
    const { error } = await context.supabase.rpc("update_reservation_status", {
      _reservation_id: data.reservation_id,
      _new_status: data.new_status,
      _note: data.note ?? null,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid_transition"))
        throw new Error("Essa mudança de status não é permitida a partir do estado atual.");
      if (msg.includes("not_found")) throw new Error("Reserva não encontrada.");
      if (msg.includes("unauthorized")) throw new Error("Acesso restrito.");
      console.error("Erro ao atualizar status da reserva:", error);
      throw new Error("Não foi possível atualizar essa reserva.");
    }
    return { ok: true };
  });

export const adminListReservationEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reservation_id: string }) =>
    z.object({ reservation_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reservation_status_events")
      .select("id, from_status, to_status, note, created_at")
      .eq("reservation_id", data.reservation_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      from_status: string | null;
      to_status: string;
      note: string | null;
      created_at: string;
    }>;
  });

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Acesso restrito.");
}

const productFormSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(120),
  size: z.string().trim().max(40).optional().nullable(),
  price_cents: z.number().int().min(0),
  description: z.string().trim().max(2000).optional().nullable(),
  stock: z.number().int().min(0).max(9999).default(1),
  image_url: z.string().url().optional().nullable(),
});

export const adminCreateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => productFormSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const baseSlug = slugify(data.name) || "peca";
    let slug = baseSlug;
    for (let attempt = 1; attempt < 20; attempt++) {
      const { data: existing } = await context.supabase
        .from("products")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${attempt + 1}`;
    }
    const { error } = await context.supabase.from("products").insert({
      name: data.name,
      slug,
      size: data.size || null,
      price_cents: data.price_cents,
      description: data.description || null,
      stock: data.stock,
      image_url: data.image_url || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, slug };
  });

export const adminUpdateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => productFormSchema.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("products")
      .update({
        name: data.name,
        size: data.size || null,
        price_cents: data.price_cents,
        description: data.description || null,
        stock: data.stock,
        image_url: data.image_url || null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeactivateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: Boolean(data), userId: context.userId };
  });
