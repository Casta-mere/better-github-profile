# strip

Everything on one wide, thin line, for a profile README that already has a lot on it. It sits under a bio without taking over the page.

- **Author:** [Casta-mere](https://github.com/Casta-mere)
- **Cards:**
  - `strip`: line 1 is a pill of all-time and past-year contributions, repositories, stars and followers; line 2 is a 52-week sparkline, a language bar and the top 3 language names.
- **Size:** 820 × 76px, no card frame.
- **Design:** option J of the original mockups, kept in [`mockup.html`](mockup.html).

## Preview

Rendered from the public test fixture (`test/fixtures/snapshot-casta-mere.json`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../../../test/__snapshots__/strip/strip-strip-dark.svg">
  <img alt="strip theme" src="../../../../test/__snapshots__/strip/strip-strip-light.svg">
</picture>

## Use it

```yaml
- uses: casta-mere/better-github-profile@v1
  with:
    token: ${{ secrets.STATS_TOKEN }}
    theme: strip
```
