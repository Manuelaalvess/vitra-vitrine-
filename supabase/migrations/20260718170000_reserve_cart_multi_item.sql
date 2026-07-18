-- Reestrutura reservas para suportar múltiplos itens (carrinho) numa única
-- reserva compartilhando código/expiração/status. Cada peça reservada vira
-- uma linha em reservation_items, com o preço travado no momento da reserva.

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_product_id_fkey;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS product_id;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS quantity;

CREATE TABLE public.reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_reservation_cents INTEGER NOT NULL CHECK (price_at_reservation_cents >= 0)
);
GRANT SELECT, INSERT ON public.reservation_items TO authenticated;
GRANT ALL ON public.reservation_items TO service_role;
ALTER TABLE public.reservation_items ENABLE ROW LEVEL SECURITY;
-- Mesma lógica de reservations: sem PII, então sem SELECT anônimo — o fluxo
-- público de confirmação usa a RPC SECURITY DEFINER get_reservation_by_code.
CREATE POLICY "Admins can view reservation items" ON public.reservation_items
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_reservation_items_reservation_id ON public.reservation_items(reservation_id);
CREATE INDEX idx_reservation_items_product_id ON public.reservation_items(product_id);

-- reserve_product (item único) sai de cena — reserve_cart cobre o caso de 1
-- item também, e o carrinho na UI sempre passa por ela.
DROP FUNCTION IF EXISTS public.reserve_product(UUID, TEXT, TEXT, INTEGER);

-- Libera de volta ao estoque as reservas pending cujo prazo já passou.
-- Chamada no início de listProducts (catálogo sempre reflete estoque real)
-- e de reserve_cart (evita competir por estoque só travado por uma reserva
-- morta). SKIP LOCKED evita bloquear se outra chamada já está processando
-- a mesma linha.
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expired_count INTEGER := 0;
  _r RECORD;
BEGIN
  FOR _r IN
    SELECT id FROM public.reservations
    WHERE status = 'pending' AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.reservations SET status = 'expired' WHERE id = _r.id;
    UPDATE public.products p SET stock = stock + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = _r.id AND p.id = ri.product_id;
    _expired_count := _expired_count + 1;
  END LOOP;
  RETURN _expired_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO anon, authenticated;

-- Reserva atômica multi-item. _items é um array JSON de
-- { "product_id": "uuid", "quantity": n }. Trava os produtos em ordem de id
-- (não a ordem em que o carrinho foi montado) — dois carrinhos concorrentes
-- que compartilham peças então travam na mesma sequência, o que evita boa
-- parte dos deadlocks entre reservas simultâneas.
CREATE OR REPLACE FUNCTION public.reserve_cart(
  _customer_name TEXT,
  _customer_phone TEXT,
  _items JSONB
)
RETURNS TABLE (
  reservation_id UUID,
  reservation_code TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code TEXT;
  _new_id UUID;
  _expires TIMESTAMPTZ;
  _product RECORD;
  _pid UUID;
  _qty INTEGER;
  _qty_by_id JSONB := '{}'::jsonb;
  _sorted_ids UUID[];
  _item JSONB;
BEGIN
  PERFORM public.expire_stale_reservations();

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;
  IF length(trim(_customer_name)) < 2 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF length(regexp_replace(_customer_phone, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  -- Consolida quantidades por produto (caso o mesmo id apareça mais de uma
  -- vez no payload) antes de decidir a ordem de lock.
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF (_item->>'product_id') IS NULL OR (_item->>'quantity') IS NULL THEN
      RAISE EXCEPTION 'invalid_item';
    END IF;
    _qty := (_item->>'quantity')::int;
    IF _qty < 1 OR _qty > 20 THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;
    _qty_by_id := jsonb_set(
      _qty_by_id,
      ARRAY[_item->>'product_id'],
      to_jsonb(COALESCE((_qty_by_id->>(_item->>'product_id'))::int, 0) + _qty)
    );
  END LOOP;

  SELECT array_agg(key::uuid ORDER BY key::uuid) INTO _sorted_ids
    FROM jsonb_object_keys(_qty_by_id) AS key;

  _new_id := gen_random_uuid();
  _code := upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
  _expires := now() + INTERVAL '24 hours';

  INSERT INTO public.reservations (id, code, customer_name, customer_phone, expires_at)
  VALUES (_new_id, _code, trim(_customer_name), _customer_phone, _expires);

  FOREACH _pid IN ARRAY _sorted_ids LOOP
    _qty := (_qty_by_id->>_pid::text)::int;

    -- Lock ordenado por id evita deadlock entre duas reservas concorrentes
    -- com as mesmas peças em ordens diferentes de carrinho.
    SELECT * INTO _product FROM public.products WHERE id = _pid AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found';
    END IF;
    IF _product.stock < _qty THEN
      RAISE EXCEPTION 'insufficient_stock:%', _product.name;
    END IF;

    UPDATE public.products SET stock = stock - _qty WHERE id = _pid;

    INSERT INTO public.reservation_items (reservation_id, product_id, quantity, price_at_reservation_cents)
    VALUES (_new_id, _pid, _qty, _product.price_cents);
  END LOOP;

  RETURN QUERY SELECT _new_id, _code, _expires;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_cart(TEXT, TEXT, JSONB) TO anon, authenticated;

-- get_reservation_by_code passa a agregar os itens da reserva num JSON só.
-- Continua case-insensitive (upper(_code)) e sem PII além do nome do
-- cliente, que já era exposto antes (necessário pra página "Quase pronto,
-- {nome}").
CREATE OR REPLACE FUNCTION public.get_reservation_by_code(_code TEXT)
RETURNS TABLE (
  code TEXT,
  customer_name TEXT,
  status public.reservation_status,
  expires_at TIMESTAMPTZ,
  total_cents BIGINT,
  items JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.code,
    r.customer_name,
    r.status,
    r.expires_at,
    COALESCE(SUM(ri.price_at_reservation_cents * ri.quantity), 0)::bigint AS total_cents,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'product_image_url', p.image_url,
          'quantity', ri.quantity,
          'price_at_reservation_cents', ri.price_at_reservation_cents
        )
        ORDER BY p.name
      ) FILTER (WHERE ri.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM public.reservations r
  LEFT JOIN public.reservation_items ri ON ri.reservation_id = r.id
  LEFT JOIN public.products p ON p.id = ri.product_id
  WHERE r.code = upper(_code)
  GROUP BY r.code, r.customer_name, r.status, r.expires_at
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_reservation_by_code(TEXT) TO anon, authenticated;

-- release_reservation devolve estoque item a item (não existe mais uma
-- única quantity/product_id direto na reserva).
CREATE OR REPLACE FUNCTION public.release_reservation(_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _item RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  SELECT * INTO _r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _r.status <> 'pending' THEN RETURN FALSE; END IF;

  UPDATE public.reservations SET status = 'cancelled' WHERE id = _reservation_id;

  FOR _item IN
    SELECT product_id, quantity FROM public.reservation_items WHERE reservation_id = _reservation_id
  LOOP
    UPDATE public.products SET stock = stock + _item.quantity WHERE id = _item.product_id;
  END LOOP;

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_reservation(UUID) TO authenticated;

-- Confirmação como RPC atômica (em vez de um UPDATE solto do lado do
-- servidor Node): valida status pending e prazo não vencido dentro da mesma
-- transação que trava a linha, evitando corrida entre a checagem e a escrita.
CREATE OR REPLACE FUNCTION public.confirm_reservation(_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _item RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  SELECT * INTO _r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _r.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF _r.expires_at < now() THEN
    -- Mesma restauração de estoque de expire_stale_reservations/release_reservation:
    -- uma reserva que só venceu agora nunca passou pela varredura de expiração,
    -- então o estoque ainda está preso nela.
    FOR _item IN
      SELECT product_id, quantity FROM public.reservation_items WHERE reservation_id = _reservation_id
    LOOP
      UPDATE public.products SET stock = stock + _item.quantity WHERE id = _item.product_id;
    END LOOP;
    UPDATE public.reservations SET status = 'expired' WHERE id = _reservation_id;
    RAISE EXCEPTION 'reservation_expired';
  END IF;

  UPDATE public.reservations SET status = 'confirmed' WHERE id = _reservation_id;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_reservation(UUID) TO authenticated;
