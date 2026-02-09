# Testing and Release

## Required Local Validation

1. `npm run lint`
2. `npm run test`
3. `npm run test:e2e`
4. `npm run test:db:local`

`test:db:local` is mandatory for DB/RLS/storage/migration changes.

## DB Test Execution

Preferred deterministic command:

```bash
npm run test:db:local
```

This command:
- starts local Supabase,
- resets DB from `supabase/migrations/*`,
- exports local env,
- runs `npm run test:db`.

## Migration Deployment

After local validation passes:

```bash
npx supabase db push
```

If project is not linked:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## AI Test Cost Guardrails

- Never call live AI providers in automated tests.
- Mock/stub Gemini/provider calls and route handlers.
- Keep tests deterministic.
