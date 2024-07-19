import {WebSocket} from 'ws';
import * as common from './common.mjs';
import type {Player, Direction} from './common.mjs'

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
        if (!(event.data instanceof ArrayBuffer)) {
            return;
        }
        const view = new DataView(event.data);
        if (bot.me === undefined) {
            if (common.HelloStruct.verifyAt(view, 0)) {
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
            if (common.PlayerMovingStruct.verifyAt(view, 0)) {
                const id = common.PlayerMovingStruct.id.read(view, 0);
                if (id === bot.me.id) {
                    const moving = common.PlayerMovingStruct.moving.read(view, 0);
                    const x = common.PlayerMovingStruct.x.read(view, 0);
                    const y = common.PlayerMovingStruct.y.read(view, 0);
                    common.setMovingMask(bot.me.moving, moving);
                    bot.me.x = x;
                    bot.me.y = y;
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
                    const view = new DataView(new ArrayBuffer(common.AmmaMovingStruct.size));
                    common.AmmaMovingStruct.kind.write(view, 0, common.MessageKind.AmmaMoving);
                    common.AmmaMovingStruct.moving.write(view, 0, common.movingMask(bot.me.moving));
                    bot.ws.send(view);
                }
            }

            // New direction
            const directions = Object.keys(bot.me.moving) as Direction[];
            direction = directions[Math.floor(Math.random()*directions.length)];
            bot.timeoutBeforeTurn = Math.random()*common.WORLD_WIDTH*0.5/common.PLAYER_SPEED;
            bot.me.moving[direction] = true;
            const view = new DataView(new ArrayBuffer(common.AmmaMovingStruct.size));
            common.AmmaMovingStruct.kind.write(view, 0, common.MessageKind.AmmaMoving);
            common.AmmaMovingStruct.moving.write(view, 0, common.movingMask(bot.me.moving));
            bot.ws.send(view);
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
