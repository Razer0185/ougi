// Site config — edit before uploading
window.OUGI_SITE = {
  notifyEmail: 'YOUR_EMAIL@example.com',
  discordInvite: 'https://discord.gg/DgGNBzXCcq',
  // Card + Apple Pay (wallet): Stripe keys in .env — see website/PAYMENTS.md
  // Gift cards: buyer buys the denomination below on G2A, pastes code in chat.
  // Live chat: npm run site → /admin-chat.html

  plans: [
    {
      id: 'starter',
      name: 'Starter',
      price: 10,
      period: 'month',
      blurb: 'One server · full panel · chat support',
      features: ['1 Discord server', 'Control panel', 'Moderation + tickets', 'Live chat + Discord support'],
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 20,
      period: 'month',
      blurb: 'Best value for active communities',
      features: ['Up to 3 servers', 'Everything in Starter', 'Aesthetic templates', 'Priority chat support'],
      featured: true,
    },
    {
      id: 'lifetime',
      name: 'Lifetime',
      price: 50,
      period: 'once',
      blurb: 'Pay once · keep Ougi on one server forever',
      features: ['1 Discord server', 'Lifetime updates', 'All features', 'Priority support'],
    },
  ],

  /**
   * Gift card methods — same face value for every type:
   * Starter $10 · Pro $20 · Lifetime $50
   * buyUrls point at the exact G2A product page for that denomination.
   */
  giftCards: [
    {
      id: 'discord',
      label: 'Discord Nitro',
      buyUrl: 'https://www.g2a.com/discord-nitro-gift-card-10-usd-by-rewarble-key-global-i10000506755002',
      buyUrls: {
        starter: 'https://www.g2a.com/discord-nitro-gift-card-10-usd-by-rewarble-key-global-i10000506755002',
        pro: 'https://www.g2a.com/discord-nitro-gift-card-20-usd-by-rewarble-key-global-i10000506755003',
        lifetime: 'https://www.g2a.com/discord-nitro-gift-card-50-usd-by-rewarble-key-global-i10000506755004',
      },
      note: 'Buy the matching Discord Nitro gift card on G2A, then paste the code.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Discord gift / Nitro',
        pro: '$20 Discord gift / Nitro',
        lifetime: '$50 Discord gift / Nitro',
      },
    },
    {
      id: 'robux',
      label: 'Robux',
      buyUrl: 'https://www.g2a.com/roblox-card-10-usd-roblox-key-global-i10000036816012',
      buyUrls: {
        starter: 'https://www.g2a.com/roblox-card-10-usd-roblox-key-global-i10000036816012',
        pro: 'https://www.g2a.com/roblox-card-20-usd-roblox-key-global-i10000036816013',
        lifetime: 'https://www.g2a.com/roblox-card-50-usd-roblox-key-global-i10000036816014',
      },
      note: 'Buy the matching Roblox gift card on G2A, then paste the code.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Roblox gift card',
        pro: '$20 Roblox gift card',
        lifetime: '$50 Roblox gift card',
      },
    },
    {
      id: 'steam',
      label: 'Steam',
      buyUrl: 'https://www.g2a.com/steam-gift-card-10-usd-steam-key-global-i10000000258127',
      buyUrls: {
        starter: 'https://www.g2a.com/steam-gift-card-10-usd-steam-key-global-i10000000258127',
        pro: 'https://www.g2a.com/steam-gift-card-20-usd-steam-key-global-i10000000258091',
        lifetime: 'https://www.g2a.com/steam-gift-card-50-usd-steam-key-global-i10000000258118',
      },
      note: 'Buy the matching Steam Wallet USD card on G2A, then paste the code.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Steam gift card',
        pro: '$20 Steam gift card',
        lifetime: '$50 Steam gift card',
      },
    },
    {
      id: 'visa',
      label: 'Visa / Mastercard gift card',
      buyUrl: 'https://www.g2a.com/rewarble-visa-gift-card-10-usd-by-rewarble-key-global-i10000502992001',
      buyUrls: {
        starter: 'https://www.g2a.com/rewarble-visa-gift-card-10-usd-by-rewarble-key-global-i10000502992001',
        pro: 'https://www.g2a.com/rewarble-visa-gift-card-20-usd-by-rewarble-key-global-i10000502992006',
        lifetime: 'https://www.g2a.com/rewarble-visa-gift-card-50-usd-by-rewarble-key-global-i10000502992004',
      },
      note: 'Buy the matching Rewarble Visa gift card on G2A. Paste code + PIN if needed.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Visa/MC gift card',
        pro: '$20 Visa/MC gift card',
        lifetime: '$50 Visa/MC gift card',
      },
    },
    {
      id: 'amazon',
      label: 'Amazon',
      buyUrl: 'https://www.g2a.com/amazon-gift-card-10-usd-amazon-key-united-states-i10000001698108',
      buyUrls: {
        starter: 'https://www.g2a.com/amazon-gift-card-10-usd-amazon-key-united-states-i10000001698108',
        pro: 'https://www.g2a.com/amazon-gift-card-20-usd-amazon-united-states-i10000001698003',
        lifetime: 'https://www.g2a.com/amazon-gift-card-50-usd-amazon-united-states-i10000001698084',
      },
      note: 'Buy the matching US Amazon gift card on G2A, then paste the code.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Amazon gift card',
        pro: '$20 Amazon gift card',
        lifetime: '$50 Amazon gift card',
      },
    },
    {
      id: 'apple',
      label: 'Apple Gift Card',
      buyUrl: 'https://www.g2a.com/apple-gift-card-10-usd-apple-key-united-states-i10000338397027',
      buyUrls: {
        starter: 'https://www.g2a.com/apple-gift-card-10-usd-apple-key-united-states-i10000338397027',
        pro: 'https://www.g2a.com/apple-gift-card-20-usd-apple-key-united-states-i10000338397026',
        lifetime: 'https://www.g2a.com/apple-gift-card-50-usd-apple-key-united-states-i10000338397025',
      },
      note: 'Buy the matching US Apple Gift Card on G2A — not the same as Apple Pay.',
      amounts: { starter: 10, pro: 20, lifetime: 50 },
      requirement: {
        starter: '$10 Apple Gift Card',
        pro: '$20 Apple Gift Card',
        lifetime: '$50 Apple Gift Card',
      },
    },
  ],

  crypto: [
    {
      id: 'btc',
      label: 'Bitcoin',
      symbol: 'BTC',
      network: 'Bitcoin',
      address: 'bc1qdjhg6v0zjw9lepx02504tt4ta0sg04g703plcl',
    },
    {
      id: 'eth',
      label: 'Ethereum',
      symbol: 'ETH',
      network: 'Ethereum (ERC-20)',
      address: '0x584029a2fc432B80b12F97c6ef5155C90c9cbC28',
    },
    {
      id: 'usdt',
      label: 'Tether',
      symbol: 'USDT',
      network: 'Ethereum (ERC-20)',
      address: '0x584029a2fc432B80b12F97c6ef5155C90c9cbC28',
    },
    {
      id: 'sol',
      label: 'Solana',
      symbol: 'SOL',
      network: 'Solana',
      address: '37NLEoKbhZwQ4EYprArALJgDGgXQirPXs9Zq9KUozPWk',
    },
    {
      id: 'ltc',
      label: 'Litecoin',
      symbol: 'LTC',
      network: 'Litecoin',
      address: 'LhWHm2yowZnMmxSyAfPFAgvCLbb68ix7DY',
    },
  ],
};
