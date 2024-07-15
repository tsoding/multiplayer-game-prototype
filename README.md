# Multiplayer Game Prototype

Proof-of-concept of a Simple Multiplayer Game. The Server is written for Node.js, the Client is written for a Modern Browser. Communication is happening over WebSockets. The Server serves the Client over HTTP.

Right now the player is just a simple color rectangle that is controled by arrows. This project is used as a playground for potential ideas to integrate into https://github.com/tsoding/raycasting

## Quick Start

```console
$ npm install
$ npm run build
$ npm run serve
```

Afterwards open http://localhost:6969/ in several browsers and control your player with arrows.
