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

// Prioriza a foto cadastrada no banco (upload real via painel admin); o mapa
// estático é só o fallback pras peças de exemplo que nunca ganharam upload.
export function imageForSlug(slug: string, dbImageUrl?: string | null): string {
  return dbImageUrl ?? map[slug] ?? vaso;
}
