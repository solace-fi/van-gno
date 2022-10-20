# Van Gno
A tool for deploying vanity gnosis safes.

## Motivation

Crypto is becoming increasingly multichain. It is no longer enough to ensure you are sending funds to the correct address, you must ensure the correct chain+address combo. This has resulted in loss of funds at least once https://rekt.news/wintermute-rekt/. This is a matter of human error, not an issue that tooling alone will solve.

However, tooling will help. Van Gno allows you to deploy gnosis safes to the same address on multiple chains. The resulting safes will have the same initial parameters.

Plus I'm the type of nerd that thinks this stuff is cool. I deployed the same safe at `0x111111d6D99e60400FB754B6ff111ba41E14eC4e` on Ethereum, Aurora, Polygon, and Fantom with one script.

## Requirements

- NodeJS >= v14

## Installation

1. Clone this repo
```sh
git clone https://github.com/solace-fi/van-gno.git
cd van-gno
```

2. Install packages
```sh
npm i
```

3. Copy example settings and modify
```sh
cp .env.example .env
cp scripts/settings.js.example scripts/settings.js
```
Most important values are `DEPLOYER_PRIVATE_KEY` in `.env` and `owners`, `threshold`, `isAcceptableVanity`, and `networks` in `settings.js`.

## Execution

```sh
node scripts/index.js
```

## INB4
- After my safe is deployed, how do I use it?  
  Use the "Load Existing Safe" interface at https://gnosis-safe.io/app. Other similar tools are available.  
- What settings should I use for my new safe?  
  See the gnosis docs and other community resources https://gnosis-safe.io/.  
- How should I set the other parameters?  
  Defaults are fine. Other questions please read the issues and or open a new one.  
- What if the factory and singleton aren't deployed on a network?  
  Ask in the gnosis community channels.  
- Why was this written in javascript?  
  Because that's what I know. If you're rust nerd and want to port this to dapptools for performance go for it.  
- How does Gnosis or Solace make money from this?  
  They don't.  
- Is this vulnerable to the Wintermute 1 exploit?  
  No. That was partially caused by the use of Safe v1.1.1. That issue was largely solved in v1.3.0, which Van Gno uses by default.  
- Is this vulnerable to the Wintermute 2 exploit?  
  No. They were searching for a private key and needed to keep it secret. Van Gno searches for a salt in order to broadcast it.  
- How long does this take to run?  
  I've found that on a single CPU searching for a vanity address with 5 characters takes about a minute. Adding or removing characters adjusts the difficulty by a factor of 16. Results will vary as its a random search.  
