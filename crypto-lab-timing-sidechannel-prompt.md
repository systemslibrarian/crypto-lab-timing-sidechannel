# Prompt: Create "crypto-lab-timing-sidechannel-prompt" Demo

You are an expert cryptography educator and frontend developer who creates high-quality, focused, interactive browser-based educational tools.

## Project Goal
Create a new standalone browser demo called **Timing Side-Channel** that helps students understand why constant-time programming matters in cryptography by showing a measurable timing difference between a vulnerable implementation and a constant-time one.

## Why This Is Valuable for Students
Timing side-channel attacks are a classic and practical way real cryptographic implementations can be broken, even when the underlying math is sound. Many students understand the concept in theory but have never seen it demonstrated with actual measurable timing differences in a browser.

This demo should make the danger of non-constant-time code tangible and memorable. It is especially valuable because:
- It bridges theory and real-world implementation security
- It shows why “it works on my machine” is not enough
- It helps students appreciate the difficulty (and importance) of writing constant-time cryptographic code

## Learning Objectives
By using this demo, a student should be able to:
- Explain what a timing side-channel attack is
- See how small timing differences can leak secret information
- Understand why constant-time code is necessary for cryptographic implementations
- Recognize common patterns that introduce timing leaks (e.g., early returns, array indexing based on secret data)
- Appreciate that even “small” leaks can be exploited with enough measurements

## Required Sections & Flow

### 1. What is a Timing Side-Channel?
- Clear, accessible explanation of timing attacks.
- Simple real-world analogy (e.g., guessing a password by how long it takes the system to reject it).
- Brief mention of famous real attacks (e.g., on RSA, AES cache timing, etc.).

### 2. Vulnerable vs Constant-Time Comparison (Core Interactive Feature)
- Show two implementations side-by-side:
  - A **vulnerable** implementation (e.g., password comparison that exits early on mismatch, or a simple modular exponentiation with early exit)
  - A **constant-time** implementation of the same function
- User can input different values and measure the execution time of both versions.
- Visualize or clearly display the timing difference.

### 3. Attack Simulation
- Allow the user to act as an attacker trying to recover a secret byte or password character by character using timing information.
- Show how multiple measurements can be used to statistically extract the secret.
- Keep the example simple enough to be educational but realistic enough to be convincing.

### 4. Why Constant-Time Is Hard
- Brief discussion of why writing constant-time code is difficult in practice (compiler optimizations, hardware effects, etc.).
- Show that even small deviations can create measurable leaks.

### 5. Defenses and Best Practices
- High-level guidance on how constant-time code is written in real libraries.
- Mention of constant-time libraries, hardware support, and testing tools.
- Connection to real cryptographic libraries (e.g., how libsodium, OpenSSL, etc. approach this).

## Technical Preferences
- Browser-native (HTML + TypeScript/JavaScript). Use `performance.now()` or WebAssembly for more precise timing measurements.
- The timing difference should be clearly measurable in the browser (even if not as dramatic as in native code).
- Keep the vulnerable example simple but realistic (e.g., string comparison or simple exponentiation).
- Clean, focused, educational aesthetic consistent with Crypto Lab demos.
- Balance realism with clarity — the goal is to make the concept intuitive.

## Relationship to Existing Work
- This would complement existing attack demos (e.g., `Timing Oracle`, `Padding Oracle`, `Nonce Lattice`) by focusing specifically on **implementation-level timing leaks** rather than protocol or mathematical attacks.
- It helps students connect “theory of attacks” with “secure implementation.”

## Output Requested
Please provide:
1. A recommended final display title for the demo page
2. High-level architecture and component breakdown
3. Key interactive elements (how timing is measured and displayed)
4. Suggested vulnerable example to use (e.g., password check, modular exponentiation)
5. How to make the timing difference visible and educational in a browser environment
6. Any important security or pedagogical notes

Start with the proposed structure, then we can iterate on implementation details.
