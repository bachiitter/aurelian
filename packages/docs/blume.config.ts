import { defineConfig } from 'blume';

export default defineConfig({
  content: {
    root: 'docs',
  },
  deployment: {
    output: 'static',
  },
  description: 'Small authentication primitives for apps that own users.',
  feedback: false,
  github: {
    dir: 'packages/docs',
    owner: 'bachiitter',
    repo: 'aurelian',
  },
  navigation: {
    sidebar: [
      {
        items: ['/quickstart', '/setup'],
        label: 'Getting Started',
      },
      {
        items: [
          '/architecture',
          '/profiles',
          '/provider-flows',
          '/sessions',
          '/claims',
          '/storage',
          '/client',
        ],
        label: 'Core Concepts',
      },
      {
        items: [
          '/mounting',
          '/runtime',
          '/custom-storage',
          '/account-linking',
          '/multiple-accounts',
          '/multiple-workspaces',
          '/testing',
          '/errors',
        ],
        label: 'Guides',
      },
      {
        items: [
          '/security',
          '/step-up-auth',
          '/totp',
          '/passkeys',
          '/impersonation',
          '/service-access',
        ],
        label: 'Security',
      },
      {
        items: ['/api'],
        label: 'API Reference',
      },
    ],
  },
  title: 'Aurelian',
});
