
-- Enums & roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.reservation_status AS ENUM ('pending', 'confirmed', 'cancelled', 'expired');

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, anon;

-- products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  subtitle TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active products" ON public.products FOR SELECT TO anon, authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- reservations
CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status public.reservation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
-- No anon SELECT: reservations contain PII. Public flow uses SECURITY DEFINER RPC.
CREATE POLICY "Admins can view reservations" ON public.reservations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update reservations" ON public.reservations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- settings (single row for seller info)
CREATE TABLE public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'Vitra',
  whatsapp_phone TEXT NOT NULL DEFAULT '5511999999999',
  tagline TEXT NOT NULL DEFAULT 'Curadoria de objetos com alma.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.settings TO anon, authenticated;
GRANT UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view settings" ON public.settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can update settings" ON public.settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic reserve function: locks row, decrements stock, creates reservation.
CREATE OR REPLACE FUNCTION public.reserve_product(
  _product_id UUID,
  _customer_name TEXT,
  _customer_phone TEXT,
  _quantity INTEGER DEFAULT 1
)
RETURNS TABLE (
  reservation_id UUID,
  reservation_code TEXT,
  product_name TEXT,
  product_price_cents INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _product RECORD;
  _code TEXT;
  _new_id UUID;
  _expires TIMESTAMPTZ;
BEGIN
  IF _quantity < 1 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  IF length(trim(_customer_name)) < 2 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF length(regexp_replace(_customer_phone, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  -- Atomic lock on product row
  SELECT * INTO _product FROM public.products WHERE id = _product_id AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;
  IF _product.stock < _quantity THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;

  UPDATE public.products SET stock = stock - _quantity WHERE id = _product_id;

  -- 6-char code
  _code := upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
  _expires := now() + INTERVAL '24 hours';

  INSERT INTO public.reservations (product_id, code, customer_name, customer_phone, quantity, expires_at)
  VALUES (_product_id, _code, trim(_customer_name), _customer_phone, _quantity, _expires)
  RETURNING id INTO _new_id;

  RETURN QUERY SELECT _new_id, _code, _product.name, _product.price_cents, _expires;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_product(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated;

-- Function to fetch a reservation by code (public, for the confirmation page)
CREATE OR REPLACE FUNCTION public.get_reservation_by_code(_code TEXT)
RETURNS TABLE (
  code TEXT,
  customer_name TEXT,
  quantity INTEGER,
  status public.reservation_status,
  expires_at TIMESTAMPTZ,
  product_name TEXT,
  product_price_cents INTEGER,
  product_image_url TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.code, r.customer_name, r.quantity, r.status, r.expires_at,
         p.name, p.price_cents, p.image_url
  FROM public.reservations r
  JOIN public.products p ON p.id = r.product_id
  WHERE r.code = upper(_code)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_reservation_by_code(TEXT) TO anon, authenticated;

-- Release a reservation (admin only) — restores stock
CREATE OR REPLACE FUNCTION public.release_reservation(_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  SELECT * INTO _r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _r.status <> 'pending' THEN RETURN FALSE; END IF;
  UPDATE public.reservations SET status = 'cancelled' WHERE id = _reservation_id;
  UPDATE public.products SET stock = stock + _r.quantity WHERE id = _r.product_id;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID) TO authenticated;

-- Seeds
INSERT INTO public.settings (id, store_name, whatsapp_phone, tagline) VALUES
  (1, 'Vitra', '5511999998888', 'Curadoria de objetos com alma.');

INSERT INTO public.products (slug, name, subtitle, description, price_cents, stock, image_url) VALUES
  ('vaso-terracota-ocre', 'Vaso Terracota Ocre', 'Cerâmica artesanal', 'Vaso torneado à mão em terracota, com acabamento ocre queimado. Peça única, pequenas variações fazem parte do processo artesanal.', 18900, 1, null),
  ('conjunto-linho-cru', 'Conjunto Linho Cru', '4 unidades', 'Guardanapos em linho cru lavado, bainhas costuradas à mão. Conjunto com 4 unidades.', 12400, 8, null),
  ('bowl-madeira-nobre', 'Bowl em Madeira Nobre', 'Peça única', 'Bowl esculpido em madeira de demolição, acabamento a óleo natural.', 34000, 0, null),
  ('vela-cedro-ambar', 'Vela Cedro e Âmbar', '200g · 40h de queima', 'Vela de cera vegetal com essência de cedro e âmbar. 200g, aproximadamente 40 horas de queima.', 8800, 12, null),
  ('colher-latao', 'Colher de Latão', 'Acabamento escovado', 'Colher de café em latão maciço com acabamento escovado. Envelhece com o uso.', 4500, 20, null),
  ('caneca-granulada', 'Caneca Granulada', 'Esmalte reativo', 'Caneca em cerâmica com esmalte reativo granulado. Cores e texturas variam entre peças.', 7200, 6, null);
