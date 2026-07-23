# Card + Apple Pay setup (Stripe)

Apple Pay on the web is **not** a separate Apple developer product you bolt on alone.
It runs through **Stripe** (already wired on the pay page). Buyers never type a card into Ougi when they use Apple Pay.

## 1. Stripe account
1. Create/login at https://dashboard.stripe.com
2. Put keys in project-root `.env`:
   ```
   STRIPE_PUBLISHABLE_KEY=pk_live_...   # or pk_test_ for testing
   STRIPE_SECRET_KEY=sk_live_...
   ```
3. Restart `npm run site`

## 2. Enable Apple Pay in Stripe
1. Dashboard → **Settings → Payment methods**
2. Turn on **Apple Pay** (and Cards)
3. Under Apple Pay → **Add domain** → add your live site domain (HTTPS required)
4. Download the domain association file Stripe gives you
5. Place it here so it’s served at the Apple URL:
   `website/public/.well-known/apple-developer-merchantid-domain-association`
   (no file extension)
6. Verify the domain in Stripe until it shows as verified

## 3. Requirements for buyers to see Apple Pay
- Site served over **HTTPS** (not only `127.0.0.1`)
- **Safari** on Mac/iPhone, or other Apple Pay–capable browsers/devices
- A card in the buyer’s Apple Wallet
- Your Stripe account approved for live payments (test mode uses Stripe test cards)

## 4. Gift cards (no Stripe / no Apple ID verify needed)
- Buyers pick Roblox / Amazon / Steam / etc.
- Site opens the **official buy link**
- They pay **plan + fee** (default **15%** in `config.js` → `giftCardFeePercent`)
- They paste the code → support chat opens for you to redeem

Suggested gift-card denominations are fixed per plan in `website/public/config.js` (not a %).
Example: Robux Starter $10 / Pro $20 / Lifetime $50; Discord Nitro 1 / 2 / 4 months.
