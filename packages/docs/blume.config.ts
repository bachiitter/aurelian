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
          '/provider-flows',
          '/profiles',
          '/sessions',
          '/claims',
          '/storage',
          '/custom-storage',
          '/client',
          '/routes',
        ],
        label: 'Core Concepts',
      },
      {
        items: [
          '/google',
          '/github',
          '/discord',
          '/twitch',
          '/oauth',
          '/oidc',
          '/code',
          '/credentials',
          '/passkey-provider',
        ],
        label: 'Providers',
      },
      {
        items: [
          '/mounting',
          '/runtime',
          '/account-linking',
          '/multiple-accounts',
          '/multiple-workspaces',
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
