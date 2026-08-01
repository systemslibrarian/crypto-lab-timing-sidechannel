# crypto-lab-timing-sidechannel

## What It Is

`crypto-lab-timing-sidechannel` is a browser demo of a timing side-channel attack
against a non-constant-time secret comparison. It pairs a **vulnerable** comparison
that returns on the first mismatched byte with a **constant-time** comparison that
always examines the full width, and then lets you act as the attacker: a random
secret is generated in memory, hidden from the attack code, and recovered one
character at a time using nothing but measured execution time. The cryptographic
subject is constant-time comparison itself — the building block used to verify MACs,
password hashes, and tokens — under a side-channel threat model where the attacker
observes timing rather than output. It is an educational demonstration, not a
production library.

## When to Use It

- Use it to teach *why* constant-time comparison is mandatory for secrets, because it
  turns an abstract warning into a secret you watch get extracted from timing alone.
- Use it in secure-coding workshops alongside `crypto-lab-timing-oracle`, because this
  lab goes deep on the attacker's statistical recovery while that one tours where
  leaks live across several primitives.
- Use it to motivate code review rules against `==`/`memcmp` on secrets, because the
  early-exit pattern it attacks is exactly the one those rules forbid.
- Do NOT use it as a constant-time library, because the "constant-time" comparator
  here is the correct source-level pattern, not an engine-level guarantee in a JS JIT.
- Do NOT read a noisy "partial recovery" run as proof of safety, because the same leak
  recovers in full with more measurements or a precise timer.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-timing-sidechannel](https://systemslibrarian.github.io/crypto-lab-timing-sidechannel/)**

Generate a fresh hidden secret, choose the target (vulnerable or constant-time) and
the timing channel (live `performance.now()` or an idealised noise-free operation
count), then launch the attack and watch each character resolve in an animated bar
chart as the recovered string fills in — with a per-position "why this character won"
explanation. Section 2 lets you measure both implementations against your own demo
secret and guess, and sweep every matching-prefix length to plot the rising
vulnerable curve against the flat constant-time line. A one-click "run all four
modes" board proves the same secret is recovered only when the implementation leaks,
and that the idealised channel matches the live one in shape. Controls include the
target implementation, the timing channel, the number of measurements per byte, and a
"New secret" button. There is no encrypt/decrypt — the demo is about how a comparison
leaks, not about a cipher.

## How the Demo Is Constructed

Two choices shape what "recovered from timing alone" means here, and the page states
both:

- **Per-byte work is amplified, not faked.** Each comparator runs a small real mixing
  loop per byte examined, so examining one byte costs enough to clear a post-Spectre
  browser timer when looped. The leak comes entirely from *how many* bytes each
  comparator examines; the amplification only lifts that difference above the clock's
  resolution. The sweep table's "bytes examined" column is derived from the control
  flow with no timer at all, so you can check the timed curve against the noise-free
  count.
- **A trailing delimiter makes the last byte leak.** A bare early-exit compare does not
  leak its final character — right or wrong, it stops at the full width. The oracle
  appends a fixed sentinel to the secret and to every guess, the way real framed and
  length-prefixed formats do, so the correct final character has one more matching byte
  to extend into. Without it the attack recovers all but the last character.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-timing-sidechannel
cd crypto-lab-timing-sidechannel
npm install
npm run dev
```

There are no environment variables. `npm test` runs the Vitest suite (comparison
primitives, the recovery engine against deterministic oracles, statistics, and a
happy-dom + axe UI integration test); `npm run build` type-checks and produces `dist/`.

## Part of the Crypto-Lab Suite

> One of 170+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
