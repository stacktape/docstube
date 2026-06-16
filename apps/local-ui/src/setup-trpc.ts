import type { AppRouter } from '@docstube/core';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { SetupWizardSaveInput } from './setup-wizard.tsx';

export const createSetupWizardSaver = (sessionToken: string) => {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers: () => ({ 'x-docstube-session': sessionToken })
      })
    ]
  });

  return async (input: SetupWizardSaveInput): Promise<void> => {
    await client.config.write.mutate(input.config);
    await client.theme.writeTokens.mutate(input.themeTokens);
  };
};
