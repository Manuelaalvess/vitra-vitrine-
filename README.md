# Vitra

Vitrine de curadoria com reserva de estoque em tempo real e checkout finalizado por WhatsApp.

## Demo

`[em breve]` (cole aqui a URL de deploy quando publicar, ex.: Vercel).

## O problema

Numa vitrine com peças únicas ou de estoque limitado, duas pessoas podem tentar reservar a mesma peça ao mesmo tempo. Sem controle atômico no banco, isso gera estoque inconsistente: duas vendas confirmadas para uma peça só, ou reservas "fantasma" que nunca liberam a peça de volta. O Vitra resolve isso no banco de dados, não na interface. A reserva só é criada se o estoque realmente permitir, dentro da mesma transação que decrementa o estoque.

## Como funciona

**Fluxo da cliente:**
1. Navega pelo catálogo e adiciona peças ao carrinho.
2. Informa nome e telefone e confirma a reserva.
3. O sistema cria a reserva e gera um código único, válido por 24 horas.
4. O WhatsApp abre automaticamente com uma mensagem pronta: itens, total e código.
5. O restante do atendimento (Pix, entrega ou retirada) acontece no WhatsApp. Não há checkout de pagamento no site.

**Fluxo da administradora:**
1. Faz login no painel. Não existe cadastro público, o acesso é concedido manualmente.
2. Acompanha os pedidos, filtra por status e avança o fluxo (aguardando pagamento, confirmado, entregue) ou cancela, com histórico de cada mudança.
3. Cadastra e edita produtos, com upload de foto, tamanho, preço e estoque.

## Destaques técnicos

**Reserva atômica multi-item.** A RPC `reserve_cart` (PostgreSQL) decrementa o estoque e cria a reserva na mesma transação. Os produtos são travados com `SELECT ... FOR UPDATE` em ordem crescente de UUID, não na ordem em que o carrinho foi montado. Assim, dois carrinhos concorrentes que disputam as mesmas peças sempre tentam travar as linhas na mesma sequência, o que evita boa parte dos deadlocks entre transações simultâneas.

**Expiração automática de reservas.** A função `expire_stale_reservations` devolve ao estoque as peças de reservas `pending` que passaram das 24 horas. Ela roda antes de listar o catálogo e antes de criar uma nova reserva, garantindo que o estoque exibido reflita a realidade sem depender de um job agendado.

**Dados sensíveis protegidos por RLS.** Row Level Security está ativo em todas as tabelas. A tabela de reservas contém dados da cliente (nome, telefone) e não tem `SELECT` anônimo direto. A consulta pública por código de reserva passa por uma RPC `SECURITY DEFINER` (`get_reservation_by_code`) que expõe só o necessário.

**Fluxo de status auditável.** As transições de pedido (`pending`, `awaiting_payment`, `confirmed`, `delivered`, ou cancelamento) são validadas no banco. Cada mudança fica registrada em `reservation_status_events`, então o histórico completo de um pedido pode ser reconstruído a qualquer momento.

**Administração sem superfície de ataque desnecessária.** Não existe cadastro público nem promoção automática a admin: o papel é concedido manualmente na tabela `user_roles`. Upload de imagens de produto usa um bucket do Supabase Storage com política restrita a admins.

**Rate limiting.** As funções públicas de reserva e consulta de código aplicam um limite best-effort por IP, para dificultar abuso automatizado.

**Mensagem de WhatsApp centralizada.** O template da mensagem vive em `src/lib/whatsapp.ts` (`buildWhatsAppMessage` / `buildWhatsAppUrl`) e é reaproveitado tanto no checkout quanto na página de confirmação da reserva. É sempre a mesma mensagem, não importa de onde a cliente clique.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | TanStack Start (React 19, SSR, server functions sobre Nitro/Vite) |
| Linguagem | TypeScript |
| Roteamento / dados | TanStack Router + TanStack Query |
| Estilo | Tailwind CSS 4 + shadcn/ui |
| Validação | Zod |
| Backend | Supabase (PostgreSQL, Auth, Storage, Row Level Security) |

## Arquitetura em alto nível

```
src/
  routes/            Páginas e rotas (file-based routing do TanStack Router)
  routes/_authenticated/  Rotas protegidas do painel admin
  lib/               Server functions, regras de negócio e helpers (products.functions.ts, whatsapp.ts, cart.tsx)
  components/        Componentes de UI (inclui shadcn/ui em components/ui)
  integrations/supabase/  Cliente Supabase, middleware de auth e tipos gerados do banco
supabase/
  migrations/        Schema do banco, versionado e aplicado em ordem
public/              Assets estáticos (favicon, robots.txt)
```

## Pré-requisitos

- Node.js 20 ou superior
- Uma conta e um projeto no [Supabase](https://supabase.com)

## Configuração local

1. Clone o repositório e instale as dependências:
   ```bash
   git clone https://github.com/Manuelaalvess/vitra-vitrine-.git
   cd vitra-vitrine-
   npm install
   ```

2. Copie o arquivo de exemplo de variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```

3. Preencha o `.env` com as credenciais do seu projeto Supabase (**Project Settings → API**). Use sempre a chave **publishable**, nunca a `service_role`:
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_URL=
   SUPABASE_PUBLISHABLE_KEY=
   ```

4. Aplique as migrations em `supabase/migrations/`, em ordem, pelo SQL Editor do Supabase ou via CLI (`supabase db push`).

5. Crie sua conta em **Authentication → Users** e conceda o papel de admin:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'seu-email@exemplo.com';
   ```

6. Atualize o nome da loja e o telefone de WhatsApp na tabela `settings`.

7. Rode o projeto:
   ```bash
   npm run dev      # ambiente de desenvolvimento
   npm run build    # build de produção
   npm run lint     # checagem de lint
   ```

## Deploy

Compatível com qualquer host que suporte TanStack Start (ex.: Vercel). Configure as mesmas variáveis de ambiente do `.env` no painel do host. **Nunca commite o arquivo `.env`.**

## Segurança

- Login restrito, sem cadastro público. Admin é concedido manualmente no banco.
- `robots.txt` bloqueia indexação de `/admin` e `/auth`.
- Row Level Security ativo em todas as tabelas.
- Rate limiting nas funções públicas de reserva e consulta.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor de desenvolvimento |
| `npm run build` | Gera o build de produção |
| `npm run lint` | Roda o ESLint |
| `npm run format` | Formata o código com Prettier |

Próximo passo natural: CI (lint + build) e alguns testes automatizados para o template de WhatsApp e a geração de slug.

---

Feito por **Manuela Alves**. [github.com/Manuelaalvess](https://github.com/Manuelaalvess)
