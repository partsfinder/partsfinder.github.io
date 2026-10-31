# PartsFinder

Find every part on a car by rego, VIN, model or part number. Built for Australian vehicles and parts stores.

- **Vehicle / VIN / Rego search.** Identifies the car and its engine options. Rego-to-VIN works with an optional RegCheck account; otherwise it links to each state's free rego check.
- **Whole-car parts.** Browse by category (globes, fuses, wipers, trims and clips, brakes, suspension and more) or search with trade abbreviations (H7, LCA, W/B, 15A fuse). Each part shows OEM numbers, sizes and threads, and aftermarket cross-references (Ryco, Narva, OEX, Bendix…), with search links for Repco, Supercheap, Autobarn, Burson, Sparesbox, Autopro and eBay.
- **Part-number cross-reference.** Enter an OEM or aftermarket number to get equivalents.
- **Interactive engine diagrams.** Animated cross-section, top layout and timing/belt views drawn from the engine's real layout.

## Running it

It's a static site (`index.html`, `style.css`, `diagram.js`, `app.js`), served by GitHub Pages.

Lookups use AI. Open **Settings** and paste a **free Google Gemini key** (aistudio.google.com/apikey) or an Anthropic API key. Keys are stored only in your browser and sent directly to Google or Anthropic. Turn on **Live retailer search** to check real store listings and verify cross-references on the web.

AI-generated part numbers can be wrong. Confirm by VIN before buying.
