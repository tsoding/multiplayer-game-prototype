import {WebSocket} from 'ws'
import * as common from './common.mjs';
import type {Player} from './common.mjs'

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
            if (common.HelloStruct.verify(view)) {
                bot.me = {
                    id: common.HelloStruct.id.read(view),
                    x: common.HelloStruct.x.read(view),
                    y: common.HelloStruct.y.read(view),
                    moving: 0,
                    hue: common.HelloStruct.hue.read(view)/256*360,
                }
                turn();
                setTimeout(tick, 1000/BOT_FPS);
                console.log(`Connected as player ${bot.me.id}`);
            } else {
                console.error("Received bogus-amogus message from server. Incorrect `Hello` message.", view)
                bot.ws.close();
            }
        } else {
            if (common.PlayerMovingStruct.verify(view)) {
                const id = common.PlayerMovingStruct.id.read(view);
                if (id === bot.me.id) {
                    bot.me.moving = common.PlayerMovingStruct.moving.read(view);
                    bot.me.x = common.PlayerMovingStruct.x.read(view);
                    bot.me.y = common.PlayerMovingStruct.y.read(view);
                }
            }
        }
    })

    function turn() {
        if (bot.me !== undefined) {
            const view = new DataView(new ArrayBuffer(common.AmmaMovingStruct.size));
            common.AmmaMovingStruct.kind.write(view, common.MessageKind.AmmaMoving);

            // Full stop
            for (let direction = 0; direction < common.Direction.Count; ++direction) {
                if ((bot.me.moving>>direction)&1) {
                    common.AmmaMovingStruct.direction.write(view, direction);
                    common.AmmaMovingStruct.start.write(view, 0);
                    bot.ws.send(view);
                }
            }

            // New direction
            const direction = Math.floor(Math.random()*common.Direction.Count);
            bot.timeoutBeforeTurn = Math.random()*common.WORLD_WIDTH*0.5/common.PLAYER_SPEED;

            // Sync
            common.AmmaMovingStruct.direction.write(view, direction);
            common.AmmaMovingStruct.start.write(view, 1);
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
