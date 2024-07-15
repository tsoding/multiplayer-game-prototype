import {WebSocket} from 'ws';
import * as common from './common.mjs';
import type {Player, AmmaMoving, Direction} from './common.mjs'

const EPS = 10;
const BOT_FPS = 30;

interface Bot {
    ws: WebSocket,
    me: Player | undefined,
    goalX: number,
    goalY: number,
    timeoutBeforeTurn: undefined | number,
}

function createBot(): Bot {
    const bot: Bot = {
        ws: new WebSocket(`ws://localhost:${common.SERVER_PORT}/`),
        me: undefined,
        goalX: common.WORLD_WIDTH*0.5,
        goalY: common.WORLD_HEIGHT*0.5,
        timeoutBeforeTurn: undefined,
    };

    bot.ws.addEventListener("message", (event) => {
        if (bot.me === undefined) {
            const message = JSON.parse(event.data.toString())
            if (common.isHello(message)) {
                bot.me = {
                    id: message.id,
                    x: message.x,
                    y: message.y,
                    moving: {
                        'left': false,
                        'right': false,
                        'up': false,
                        'down': false,
                    },
                    style: message.style,
                };
                turn();
                setTimeout(tick, 1000/BOT_FPS);
                console.log(`Connected as player ${bot.me.id}`);
            } else {
                console.log("Received bogus-amogus message from server", message)
                bot.ws.close();
            }
        } else {
            const message = JSON.parse(event.data.toString())
            if (common.isPlayerMoving(message)) {
                if (message.id == bot.me.id) {
                    bot.me.x = message.x;
                    bot.me.y = message.y;
                    bot.me.moving[message.direction] = message.start;
                }
            }
        }
    })

    function turn() {
        if (bot.me !== undefined) {
            let direction: Direction;
            for (direction in bot.me.moving) {
                if (bot.me.moving[direction]) {
                    bot.me.moving[direction] = false;
                    common.sendMessage<AmmaMoving>(bot.ws, {
                        kind: 'AmmaMoving',
                        start: false,
                        direction
                    })
                }
            }

            bot.timeoutBeforeTurn = undefined
            do {
                const dx = bot.goalX - bot.me.x;
                const dy = bot.goalY - bot.me.y;

                if (Math.abs(dx) > EPS) {
                    if (dx > 0) {
                        common.sendMessage<AmmaMoving>(bot.ws, {
                            kind: 'AmmaMoving',
                            start: true,
                            direction: 'right'
                        })
                    } else {
                        common.sendMessage<AmmaMoving>(bot.ws, {
                            kind: 'AmmaMoving',
                            start: true,
                            direction: 'left'
                        })
                    }
                    bot.timeoutBeforeTurn = Math.abs(dx)/common.PLAYER_SPEED;
                } else if (Math.abs(dy) > EPS) {
                    if (dy > 0) {
                        common.sendMessage<AmmaMoving>(bot.ws, {
                            kind: 'AmmaMoving',
                            start: true,
                            direction: 'down'
                        })
                    } else {
                        common.sendMessage<AmmaMoving>(bot.ws, {
                            kind: 'AmmaMoving',
                            start: true,
                            direction: 'up'
                        })
                    }
                    bot.timeoutBeforeTurn = Math.abs(dy)/common.PLAYER_SPEED;
                }

                if (bot.timeoutBeforeTurn === undefined) {
                    bot.goalX = Math.random()*common.WORLD_WIDTH;
                    bot.goalY = Math.random()*common.WORLD_HEIGHT;
                }
            } while (bot.timeoutBeforeTurn === undefined);
        }
    }

    function tick() {
        const deltaTime = 1/BOT_FPS;
        if (bot.timeoutBeforeTurn !== undefined) {
            bot.timeoutBeforeTurn -= deltaTime;
            if (bot.timeoutBeforeTurn <= 0) turn();
        }
        if (bot.me !== undefined) {
            common.updatePlayer(bot.me, deltaTime)
        }
        setTimeout(tick, 1000/BOT_FPS);
    }

    return bot
}

let bots: Array<Bot> = []
for (let i = 0; i < 20; ++i) bots.push(createBot())
