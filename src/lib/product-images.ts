import vaso from "@/assets/product-vaso.jpg";
import linho from "@/assets/product-linho.jpg";
import bowl from "@/assets/product-bowl.jpg";
import vela from "@/assets/product-vela.jpg";
import colher from "@/assets/product-colher.jpg";
import caneca from "@/assets/product-caneca.jpg";

const map: Record<string, string> = {
  "vaso-terracota-ocre": vaso,
  "conjunto-linho-cru": linho,
  "bowl-madeira-nobre": bowl,
  "vela-cedro-ambar": vela,
  "colher-latao": colher,
  "caneca-granulada": caneca,
};

export function imageForSlug(slug: string, fallback?: string | null): string {
  return map[slug] ?? fallback ?? vaso;
}
