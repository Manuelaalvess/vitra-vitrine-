-- Fluxo de status de pedido com histórico auditável. Substitui as ações
-- soltas de confirmar/liberar por uma única RPC com transições validadas.

ALTER TYPE public.reservation_status ADD VALUE IF NOT EXISTS 'awaiting_payment';
ALTER TYPE public.reservation_status ADD VALUE IF NOT EXISTS 'delivered';

CREATE TABLE public.reservation_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  from_status public.reservation_status,
  to_status public.reservation_status NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reservation_status_events TO authenticated;
GRANT ALL ON public.reservation_status_events TO service_role;
ALTER TABLE public.reservation_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view reservation status events" ON public.reservation_status_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_reservation_status_events_reservation_id ON public.reservation_status_events(reservation_id);

-- reserve_cart passa a registrar o evento inicial (nenhum -> pending) no
-- histórico, pra ele começar completo desde a criação da reserva.
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

  INSERT INTO public.reservation_status_events (reservation_id, from_status, to_status, changed_by, note)
  VALUES (_new_id, NULL, 'pending', NULL, 'Reserva criada pela cliente');

  RETURN QUERY SELECT _new_id, _code, _expires;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_cart(TEXT, TEXT, JSONB) TO anon, authenticated;

-- expire_stale_reservations passa a registrar o evento de expiração
-- automática, pra ficar visível no histórico junto com as ações manuais.
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
    SELECT id, status FROM public.reservations
    WHERE status IN ('pending', 'awaiting_payment') AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.reservations SET status = 'expired' WHERE id = _r.id;
    UPDATE public.products p SET stock = stock + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = _r.id AND p.id = ri.product_id;
    INSERT INTO public.reservation_status_events (reservation_id, from_status, to_status, changed_by, note)
    VALUES (_r.id, _r.status, 'expired', NULL, 'Expirada automaticamente');
    _expired_count := _expired_count + 1;
  END LOOP;
  RETURN _expired_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO anon, authenticated;

-- RPC única de transição de status, com validação de estado atual -> novo
-- estado, trava de linha e registro no histórico. Restaura estoque quando
-- a reserva é cancelada (mesma lógica que release_reservation tinha).
CREATE OR REPLACE FUNCTION public.update_reservation_status(
  _reservation_id UUID,
  _new_status public.reservation_status,
  _note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _allowed BOOLEAN := false;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO _r FROM public.reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF _r.status = 'pending' AND _new_status IN ('awaiting_payment', 'cancelled') THEN
    _allowed := true;
  ELSIF _r.status = 'awaiting_payment' AND _new_status IN ('confirmed', 'cancelled') THEN
    _allowed := true;
  ELSIF _r.status = 'confirmed' AND _new_status = 'delivered' THEN
    _allowed := true;
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  IF _new_status = 'cancelled' THEN
    UPDATE public.products p SET stock = stock + ri.quantity
      FROM public.reservation_items ri
      WHERE ri.reservation_id = _reservation_id AND p.id = ri.product_id;
  END IF;

  UPDATE public.reservations SET status = _new_status WHERE id = _reservation_id;

  INSERT INTO public.reservation_status_events (reservation_id, from_status, to_status, changed_by, note)
  VALUES (_reservation_id, _r.status, _new_status, auth.uid(), _note);

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_reservation_status(UUID, public.reservation_status, TEXT) TO authenticated;

-- confirm_reservation/release_reservation saem de cena — update_reservation_status
-- cobre os dois casos (e mais) de forma unificada e auditável.
DROP FUNCTION IF EXISTS public.confirm_reservation(UUID);
DROP FUNCTION IF EXISTS public.release_reservation(UUID);
