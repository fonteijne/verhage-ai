# Disclaimer

## What this is

This is a capability test of Claude Code Opus 5.

The entire feature development was two prompts.

### Prompt 1 — the whole application

```
https://verhage.nl/assortiment/verhage-hoofddorp/1

Build an agentic interface for this webshop.

Requirements:
- user can order through chat
- agent identifies cross-selling options and suggests them in chat.
- agent can only fill the cart
- you cannot proceed with checkout and order.
- no payments can be made
```

### Prompt 2 — provider support

A request to implement OpenRouter integration.

### What those two prompts produced

- A scraper and normaliser for the live Verhage Hoofddorp assortment
  (200 products across 17 categories).
- An ordering agent with an eight-tool surface — search the menu, read a
  product, four cart operations, and cross-sell.
- A rule-and-affinity cross-sell engine that reasons about what a meal is
  missing and explains every suggestion.
- A React chat interface with a live cart, one-tap accept/decline on
  suggestions, and an expandable trace of what the agent did.
- Three interchangeable providers — Anthropic, OpenRouter, and a
  deterministic rule-based agent that needs no credentials.
- The no-checkout guarantee, enforced in four independent places.
- 110 tests.

For honesty about the scope of the claim: the remaining exchanges in that
session were not feature work. They were choosing which OpenRouter model to
use, supplying a test key, and reporting one bug — that `.env` was never
loaded, so configuration set there was silently ignored.

## Not affiliated with Verhage

This is a demonstration, not a Verhage product, and it is not affiliated with,
endorsed by, or connected to Verhage in any way. The assortment was read from
a publicly reachable page of their storefront.

Prices and products are a snapshot taken when the catalog was generated and
will drift from the live menu. A *vanaf* price is a starting price for a
configurable item, not a final one, because the option sets that determine the
real total are loaded separately by the real storefront and are not part of
this data.

## It cannot place an order

Nothing here reaches Verhage. The application composes a basket and stops:
there is no ordering, checkout, pickup-time or payment capability anywhere in
it, by construction rather than by instruction. Any order must be placed in the
Verhage webshop or in the store.
