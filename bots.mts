import {WebSocket} from 'ws';
import * as common from './common.mjs';
import type {Player, AmmaMoving, Direction} from './common.mjs'

const BOT_FPS = 60;

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

    bot.ws.binaryType = 'arraybuffer';

    bot.ws.addEventListener("message", (event) => {
        if (bot.me === undefined) {
            if (event.data instanceof ArrayBuffer) {
                const view = new DataView(event.data);
                if (common.HelloStruct.size === view.byteLength && common.HelloStruct.kind.read(view, 0) === common.MessageKind.Hello) {
                    bot.me = {
                        id: common.HelloStruct.id.read(view, 0),
                        x: common.HelloStruct.x.read(view, 0),
                        y: common.HelloStruct.y.read(view, 0),
                        moving: {
                            'left': false,
                            'right': false,
                            'up': false,
                            'down': false,
                        },
                        hue: common.HelloStruct.hue.read(view, 0)/256*360,
                    }
                    turn();
                    setTimeout(tick, 1000/BOT_FPS);
                    console.log(`Connected as player ${bot.me.id}`);
                } else {
                    console.error("Received bogus-amogus message from server. Incorrect `Hello` message.", view)
                    bot.ws.close();
                }
            } else {
                console.error("Received bogus-amogus message from server. Expected binary data.", event)
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
            // Full stop
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

            // New direction
            const directions = Object.keys(bot.me.moving) as Direction[];
            direction = directions[Math.floor(Math.random()*directions.length)];
            bot.timeoutBeforeTurn = Math.random()*common.WORLD_WIDTH*0.5/common.PLAYER_SPEED;
            bot.me.moving[direction] = true;
            common.sendMessage<AmmaMoving>(bot.ws, {
                kind: 'AmmaMoving',
                start: true,
                direction
            })
        }
    }

    let previousTimestamp = 0;
    function tick() {
        const timestamp = performance.now();
        const deltaTime = (timestamp - previousTimestamp)/1000;
        previousTimestamp = timestamp;
        if (bot.timeoutBeforeTurn !== undefined) {
            bot.timeoutBeforeTurn -= deltaTime;
            if (bot.timeoutBeforeTurn <= 0) turn();
        }
        if (bot.me !== undefined) {
            common.updatePlayer(bot.me, deltaTime)
        }
        setTimeout(tick, Math.max(0, 1000/BOT_FPS - timestamp));
    }

    return bot
}

let bots: Array<Bot> = []
for (let i = 0; i < 30; ++i) bots.push(createBot())
