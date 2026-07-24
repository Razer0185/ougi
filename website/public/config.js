// Site config — edit before uploading
window.OUGI_SITE = {
  notifyEmail: 'YOUR_EMAIL@example.com',
  discordInvite: 'https://discord.gg/AMaPQfQXGb',
  // Card: Stripe keys in .env — see website/PAYMENTS.md
  // Prefer Apple Pay via Discord for now until domain Apple Pay is fully verified.
  paypal: {
    email: 'johnportarr@gmail.com',
    note: 'IMPORTANT: You MUST send as Friends & Family (NOT Goods & Services). If you do not send Friends & Family, you will NOT receive the product and the money cannot be refunded. Send the exact plan amount, then open chat with your receipt.',
  },

  plans: [
    {
      id: 'pc',
      name: 'License Monthly',
      price: 10,
      period: 'month',
      hostMode: 'pc',
      blurb: 'Full Ougi on your PC via the Host app — you run it, no cloud hosting.',
      features: [
        'Run on your PC (Host app)',
        'All bot features',
        'Works while subscribed',
        'No source code',
        'Activate on Host after pay',
      ],
    },
    {
      id: 'starter',
      name: 'Hosted Monthly',
      price: 15,
      period: 'month',
      hostMode: 'cloud',
      blurb: 'We host Ougi for you 24/7. Activate your server on Host and invite the bot — no source download.',
      features: [
        'We run the bot 24/7',
        '1 Discord server (Activate on Host)',
        'No install / no source',
        'Expires monthly — renew anytime',
      ],
      featured: true,
    },
    {
      id: 'pc-lifetime',
      name: 'License Lifetime',
      price: 30,
      period: 'once',
      hostMode: 'pc',
      blurb: 'Pay once. Run Ougi on your PC forever via the Host app.',
      features: [
        'Lifetime PC license',
        'Ougi Host app loader',
        'All features + updates',
        'No source code',
      ],
    },
    {
      id: 'lifetime',
      name: 'Hosted Lifetime',
      price: 45,
      period: 'once',
      hostMode: 'cloud',
      blurb: 'Pay once. We keep hosting Ougi for your server — Activate on Host, invite the bot, no source.',
      features: [
        'Lifetime cloud hosting',
        '1 Discord server (Activate on Host)',
        'All features + updates',
        'No source code',
      ],
    },
  ],

  /**
   * Gift cards: monthly → ~plan+buffer · Lifetime → $50 card.
   */
  giftCards: [
    {
      id: 'discord',
      label: 'Discord Nitro',
      buyUrl: 'https://www.g2a.com/discord-nitro-gift-card-20-usd-by-rewarble-key-global-i10000506755003',
      buyUrls: {
        pc: 'https://www.g2a.com/discord-nitro-gift-card-20-usd-by-rewarble-key-global-i10000506755003',
        starter: 'https://www.g2a.com/discord-nitro-gift-card-20-usd-by-rewarble-key-global-i10000506755003',
        'pc-lifetime': 'https://www.g2a.com/discord-nitro-gift-card-50-usd-by-rewarble-key-global-i10000506755004',
        lifetime: 'https://www.g2a.com/discord-nitro-gift-card-50-usd-by-rewarble-key-global-i10000506755004',
      },
      note: 'Buy the matching Discord Nitro gift card on G2A, then paste the code.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Discord gift (License monthly)',
        starter: '$20 Discord gift (Hosted monthly)',
        'pc-lifetime': '$50 Discord gift (License lifetime)',
        lifetime: '$50 Discord gift (Hosted lifetime)',
      },
    },
    {
      id: 'robux',
      label: 'Robux',
      buyUrl: 'https://www.g2a.com/roblox-card-20-usd-roblox-key-global-i10000036816013',
      buyUrls: {
        pc: 'https://www.g2a.com/roblox-card-20-usd-roblox-key-global-i10000036816013',
        starter: 'https://www.g2a.com/roblox-card-20-usd-roblox-key-global-i10000036816013',
        'pc-lifetime': 'https://www.g2a.com/roblox-card-50-usd-roblox-key-global-i10000036816014',
        lifetime: 'https://www.g2a.com/roblox-card-50-usd-roblox-key-global-i10000036816014',
      },
      note: 'Buy the matching Roblox gift card on G2A, then paste the code.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Roblox gift (covers $10 plan)',
        starter: '$20 Roblox gift (covers $15 plan)',
        'pc-lifetime': '$50 Roblox gift (covers $30 plan)',
        lifetime: '$50 Roblox gift (covers $45 plan)',
      },
    },
    {
      id: 'steam',
      label: 'Steam',
      buyUrl: 'https://www.g2a.com/steam-gift-card-20-usd-steam-key-global-i10000000258091',
      buyUrls: {
        pc: 'https://www.g2a.com/steam-gift-card-20-usd-steam-key-global-i10000000258091',
        starter: 'https://www.g2a.com/steam-gift-card-20-usd-steam-key-global-i10000000258091',
        'pc-lifetime': 'https://www.g2a.com/steam-gift-card-50-usd-steam-key-global-i10000000258118',
        lifetime: 'https://www.g2a.com/steam-gift-card-50-usd-steam-key-global-i10000000258118',
      },
      note: 'Buy the matching Steam Wallet USD card on G2A, then paste the code.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Steam gift (covers $10 plan)',
        starter: '$20 Steam gift (covers $15 plan)',
        'pc-lifetime': '$50 Steam gift (covers $30 plan)',
        lifetime: '$50 Steam gift (covers $45 plan)',
      },
    },
    {
      id: 'visa',
      label: 'Visa / Mastercard gift card',
      buyUrl: 'https://www.g2a.com/rewarble-visa-gift-card-20-usd-by-rewarble-key-global-i10000502992006',
      buyUrls: {
        pc: 'https://www.g2a.com/rewarble-visa-gift-card-20-usd-by-rewarble-key-global-i10000502992006',
        starter: 'https://www.g2a.com/rewarble-visa-gift-card-20-usd-by-rewarble-key-global-i10000502992006',
        'pc-lifetime': 'https://www.g2a.com/rewarble-visa-gift-card-50-usd-by-rewarble-key-global-i10000502992004',
        lifetime: 'https://www.g2a.com/rewarble-visa-gift-card-50-usd-by-rewarble-key-global-i10000502992004',
      },
      note: 'Buy the matching Rewarble Visa gift card on G2A. Paste code + PIN if needed.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Visa/MC gift (covers $10 plan)',
        starter: '$20 Visa/MC gift (covers $15 plan)',
        'pc-lifetime': '$50 Visa/MC gift (covers $30 plan)',
        lifetime: '$50 Visa/MC gift (covers $45 plan)',
      },
    },
    {
      id: 'amazon',
      label: 'Amazon',
      buyUrl: 'https://www.g2a.com/amazon-gift-card-20-usd-amazon-united-states-i10000001698003',
      buyUrls: {
        pc: 'https://www.g2a.com/amazon-gift-card-20-usd-amazon-united-states-i10000001698003',
        starter: 'https://www.g2a.com/amazon-gift-card-20-usd-amazon-united-states-i10000001698003',
        'pc-lifetime': 'https://www.g2a.com/amazon-gift-card-50-usd-amazon-united-states-i10000001698084',
        lifetime: 'https://www.g2a.com/amazon-gift-card-50-usd-amazon-united-states-i10000001698084',
      },
      note: 'Buy the matching US Amazon gift card on G2A, then paste the code.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Amazon gift (covers $10 plan)',
        starter: '$20 Amazon gift (covers $15 plan)',
        'pc-lifetime': '$50 Amazon gift (covers $30 plan)',
        lifetime: '$50 Amazon gift (covers $45 plan)',
      },
    },
    {
      id: 'apple',
      label: 'Apple Gift Card',
      buyUrl: 'https://www.g2a.com/apple-gift-card-20-usd-apple-key-united-states-i10000338397026',
      buyUrls: {
        pc: 'https://www.g2a.com/apple-gift-card-20-usd-apple-key-united-states-i10000338397026',
        starter: 'https://www.g2a.com/apple-gift-card-20-usd-apple-key-united-states-i10000338397026',
        'pc-lifetime': 'https://www.g2a.com/apple-gift-card-50-usd-apple-key-united-states-i10000338397025',
        lifetime: 'https://www.g2a.com/apple-gift-card-50-usd-apple-key-united-states-i10000338397025',
      },
      note: 'Buy the matching US Apple Gift Card on G2A — not the same as Apple Pay.',
      amounts: { pc: 15, starter: 20, 'pc-lifetime': 50, lifetime: 50 },
      requirement: {
        pc: '$15 Apple Gift Card (covers $10 plan)',
        starter: '$20 Apple Gift Card (covers $15 plan)',
        'pc-lifetime': '$50 Apple Gift Card (covers $30 plan)',
        lifetime: '$50 Apple Gift Card (covers $45 plan)',
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
