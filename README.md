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
chart as the recovered string fills in. Section 2 also lets you measure both
implementations against your own demo secret and guess. Controls include the target
implementation, the timing channel, the number of measurements per byte, and a
"New secret" button. There is no encrypt/decrypt — the demo is about how a comparison
leaks, not about a cipher.

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

> One of 60+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
